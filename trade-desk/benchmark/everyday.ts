// The everyday test: how often Trade Desk raises a false alarm on ordinary transactions that really worked.
// The benchmark (cases.ts) has 9 attacks but only 1 honest transaction, so it can't say how often good transactions
// get flagged. This takes ~200 successful mainnet transactions straight from the newest blocks, in four groups, and
// hands each to check_tx (and, where the request can be read from what happened, tx_matches) the way a wallet would
// before signing: signatures blank and a fresh blockhash. Each one is checked seconds after it landed and every
// answer is recorded, so `npm run everyday` replays the same result offline and tests/everyday.test.ts pins it.
//
// A transaction that already landed can't always be replayed: the wallet may have spent what it sold, or an account
// it opened now exists. Those dry runs fail because the chain moved on, not because of Pulse, so they are counted
// apart ("couldn't replay") and never hidden. Every other BLOCK, REVIEW or MISMATCH is a false alarm candidate.
//
// Record: SOLANA_MAINNET_RPC_URL=... npm run everyday:record (reads and simulations only; nothing is signed or sent).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { VersionedTransaction } from "@solana/web3.js";
import { getBase58Decoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import { recordingContext, replayContext } from "../tests/helpers/replay";
import { runPulse, type RecordedCase } from "./score";
import { jupiterHost } from "../server/tools/lib";
import type { Request } from "./cases";

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "everyday.json.gz");
export const RESULTS = path.join(path.dirname(new URL(import.meta.url).pathname), "everyday-results.json");

export type Group = "sol_transfer" | "token_transfer" | "jupiter_swap" | "other";
// Agents mostly send and swap, so those get most of the sample; "other" is the rest of mainnet's everyday traffic.
export const QUOTA: Record<Group, number> = { sol_transfer: 40, token_transfer: 40, jupiter_swap: 50, other: 70 };
const PER_BLOCK = 3; // per group, so no one block (or moment) dominates
const PER_PROGRAM = 8; // in "other", so one busy program doesn't fill the group

const SYSTEM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMOS = ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"];
const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"; // assertions some wallets add to every transaction
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const VOTE = "Vote111111111111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
const HARMLESS = [COMPUTE_BUDGET, ...MEMOS, LIGHTHOUSE];

// One landed transaction in a form both versions share: its accounts, steps, and how to hand it over unsigned with a
// fresh blockhash. web3.js reads legacy and v0; version 1 (40% of non-vote mainnet traffic in Oct 2026) is read with kit.
type Landed = { version: string; keys: string[]; signerCount: number; payer: string; signature: string; ixs: { program: string; accounts: string[]; data: Uint8Array }[]; unsigned: (blockhash: string) => string };

function readLanded(bytes: Buffer, meta: any): Landed {
  try {
    const tx = VersionedTransaction.deserialize(bytes);
    const msg = tx.message;
    const keys = [...msg.staticAccountKeys.map(String), ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
    return {
      version: String(tx.version), keys, signerCount: msg.header.numRequiredSignatures, payer: keys[0], signature: getBase58Decoder().decode(tx.signatures[0]),
      ixs: msg.compiledInstructions.map((i) => ({ program: keys[i.programIdIndex], accounts: i.accountKeyIndexes.map((k) => keys[k]), data: i.data })),
      unsigned: (blockhash) => {
        tx.message.recentBlockhash = blockhash;
        tx.signatures = tx.signatures.map(() => new Uint8Array(64));
        return Buffer.from(tx.serialize()).toString("base64");
      },
    };
  } catch {
    const decoded = getTransactionDecoder().decode(bytes);
    const m: any = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
    const keys: string[] = m.staticAccounts.map(String);
    const signerCount = m.header.numSignerAccounts;
    return {
      version: String(m.version), keys, signerCount, payer: keys[0], signature: getBase58Decoder().decode((decoded.signatures as any)[keys[0]] ?? new Uint8Array(64)),
      ixs: m.instructionHeaders.map((h: any, i: number) => ({ program: keys[h.programAccountIndex], accounts: m.instructionPayloads[i].instructionAccountIndices.map((k: number) => keys[k]), data: m.instructionPayloads[i].instructionData })),
      unsigned: (blockhash) => {
        const messageBytes = getCompiledTransactionMessageEncoder().encode({ ...m, lifetimeToken: blockhash });
        const signatures = Object.fromEntries(keys.slice(0, signerCount).map((k) => [k, null]));
        return Buffer.from(getTransactionEncoder().encode({ messageBytes, signatures } as any)).toString("base64");
      },
    };
  }
}

export type EverydayTx = { group: Group; version: string; payer: string; signature: string; slot: number; program: string; tx: string; request: Request | null; recordedAt: string; recordings: RecordedCase["recordings"] };

const u64 = (data: Uint8Array, at: number) => Buffer.from(data).readBigUInt64LE(at);
const units = (raw: bigint, decimals: number) => {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals), frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};
const anchorTag = (name: string) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
// Jupiter's exact-in routes end with in_amount, quoted_out_amount, slippage_bps and platform_fee_bps (19 bytes), so
// the amount the swap was asked to sell is read from the instruction, as the request that built it said.
const EXACT_IN = new Set(["route", "shared_accounts_route"].map(anchorTag));

// Sorts one landed transaction into a group and reads the request it was built from, or returns null to skip it.
function classify({ keys, ixs, signerCount }: Landed, meta: any): { group: Group; program: string; request: Request | null } | null {
  const programs = [...new Set(ixs.map((i) => i.program))];
  if (programs.includes(VOTE) || signerCount > 2) return null;
  const payer = keys[0];
  const owners = new Map<string, { owner: string; mint: string; decimals: number }>();
  for (const b of [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])]) owners.set(keys[b.accountIndex], { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount.decimals });
  const main = ixs.filter((i) => !HARMLESS.includes(i.program));

  // One plain SOL transfer and nothing else that moves money.
  if (main.length === 1 && main[0].program === SYSTEM && main[0].data.length === 12 && Buffer.from(main[0].data).readUInt32LE(0) === 2) {
    const [from, to] = main[0].accounts;
    return { group: "sol_transfer", program: SYSTEM, request: { action: "transfer", token: "SOL", amount: units(u64(main[0].data, 4), 9), to, from } };
  }
  // One token transfer, maybe opening the recipient's token account first.
  const tokenIxs = main.filter((i) => i.program === TOKEN || i.program === TOKEN_2022);
  if (tokenIxs.length === 1 && main.every((i) => i === tokenIxs[0] || i.program === ATA)) {
    const t = tokenIxs[0], kind = t.data[0];
    const dest = kind === 3 ? t.accounts[1] : kind === 12 ? t.accounts[2] : null;
    const info = dest ? owners.get(dest) : undefined;
    const from = kind === 3 ? t.accounts[2] : t.accounts[3];
    if (info && (kind === 3 || kind === 12)) return { group: "token_transfer", program: t.program, request: { action: "transfer", token: info.mint, amount: units(u64(t.data, 1), info.decimals), to: info.owner, from } };
    return null;
  }
  if (programs.includes(JUPITER)) {
    // What the payer gave up and got back, from the landed balances. SOL and wrapped SOL count as one.
    const delta = new Map<string, bigint>();
    const add = (mint: string, v: bigint) => delta.set(mint, (delta.get(mint) ?? 0n) + v);
    for (const [phase, sign] of [["preTokenBalances", -1n], ["postTokenBalances", 1n]] as const) {
      for (const b of meta[phase] ?? []) if (b.owner === payer && b.mint !== WSOL) add(b.mint, sign * BigInt(b.uiTokenAmount.amount));
    }
    // One Jupiter step only: with several, no single step says what the whole transaction was asked to sell.
    const jupiterSteps = ixs.filter((i) => i.program === JUPITER);
    const route = jupiterSteps.length === 1 && EXACT_IN.has(Buffer.from(jupiterSteps[0].data.subarray(0, 8)).toString("hex")) ? jupiterSteps[0] : undefined;
    const sold = [...delta].filter(([, v]) => v < 0n), bought = [...delta].filter(([, v]) => v > 0n);
    const solChange = BigInt(meta.postBalances[0]) - BigInt(meta.preBalances[0]) + BigInt(meta.fee);
    // Exactly one token in and one out (or SOL on one side), from an exact-in route: anything else has no one request.
    let sell: string | null = null, buy: string | null = null, decimals = 9;
    if (sold.length === 1 && bought.length === 1) { sell = sold[0][0]; buy = bought[0][0]; }
    else if (sold.length === 1 && !bought.length && solChange > 0n) { sell = sold[0][0]; buy = "SOL"; }
    else if (!sold.length && bought.length === 1 && solChange < 0n) { sell = "SOL"; buy = bought[0][0]; }
    if (sell && sell !== "SOL") decimals = [...owners.values()].find((o) => o.mint === sell)!.decimals;
    const request: Request | null = route && sell && buy ? { action: "swap", sell, buy, amount: units(u64(route.data, route.data.length - 19), decimals), from: payer } : null;
    return { group: "jupiter_swap", program: JUPITER, request };
  }
  if (!main.length) return null;
  return { group: "other", program: main[0].program, request: null };
}

// The RPC turns away bursts (HTTP 429), so wait and try again, longer each time.
async function rpc(url: string, method: string, params: unknown[]) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429 && attempt < 6) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const body: any = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }
}

// A landed transaction whose dry run now fails because the chain moved on. Only its error is kept, to report how many.
export type NotReplayed = { group: Group; version: string; payer: string; signature: string; program: string; error: unknown };
type Sample = { replayed: EverydayTx[]; notReplayed: NotReplayed[] };

// Saves after every block and carries on from the saved file, so a dropped connection loses one block, not the run.
// The quotas count replayed transactions only. Delete benchmark/everyday.json.gz to start a new sample.
export async function record(rpcUrl: string) {
  const sample: Sample = fs.existsSync(FILE) ? loadSample() : { replayed: [], notReplayed: [] };
  const out = sample.replayed;
  const save = () => fs.writeFileSync(FILE, zlib.gzipSync(JSON.stringify(sample)));
  const have = (g: Group) => out.filter((t) => t.group === g).length;
  const payers = new Set([...out, ...sample.notReplayed].map((t) => t.payer)); // one per wallet, so one busy bot can't fill a group
  // The live server keeps Jupiter's list of exchanges for a day, but each recording starts with empty caches, and
  // Jupiter's keyless API turned away 113 of 200 lookups in the first run. So it is read once here, as the server has it.
  let dexes: unknown = null;
  for (let i = 0; !dexes && i < 10; i++) {
    dexes = await fetch(`${jupiterHost()}/swap/v1/program-id-to-label`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!dexes) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!dexes) throw new Error("Couldn't read Jupiter's list of exchanges.");
  let lastSlot = 0;
  while ((Object.keys(QUOTA) as Group[]).some((g) => have(g) < QUOTA[g])) {
    const slot: number | null = await rpc(rpcUrl, "getSlot", [{ commitment: "confirmed" }]).catch(() => null);
    if (slot === null) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    if (slot === lastSlot) { await new Promise((r) => setTimeout(r, 400)); continue; }
    lastSlot = slot;
    const block = await rpc(rpcUrl, "getBlock", [slot, { encoding: "base64", maxSupportedTransactionVersion: 1, transactionDetails: "full", rewards: false, commitment: "confirmed" }]).catch(() => null);
    if (!block) continue;
    const taken = new Map<Group, number>();
    for (const entry of block.transactions) {
      if (entry.meta?.err !== null) continue;
      let landed: Landed;
      try { landed = readLanded(Buffer.from(entry.transaction[0], "base64"), entry.meta); } catch { continue; }
      const payer = landed.payer;
      if (payers.has(payer)) continue;
      const c = classify(landed, entry.meta);
      if (!c || have(c.group) >= QUOTA[c.group] || (taken.get(c.group) ?? 0) >= PER_BLOCK) continue;
      // "other" is capped per program among replayed ones, so one busy program doesn't fill the group.
      if (c.group === "other" && out.filter((t) => t.program === c.program).length >= PER_PROGRAM) continue;
      payers.add(payer);
      taken.set(c.group, (taken.get(c.group) ?? 0) + 1);
      // As a wallet would hand it over before signing: blank signatures and a fresh blockhash.
      // A fresh blockhash for each one: checking a block's worth can take longer than a blockhash lives.
      const latest = await rpc(rpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }]).catch(() => null);
      if (!latest) { payers.delete(payer); continue; }
      const signature = landed.signature;
      const base64 = landed.unsigned(latest.value.blockhash);
      const recordings: RecordedCase["recordings"] = {};
      let verdict;
      try {
        verdict = await runPulse({ tx: base64, request: c.request ?? undefined } as any, (tool) => {
          const { ctx, recording } = recordingContext(rpcUrl);
          recordings[tool] = recording;
          const fetchJson = ctx.fetchJson;
          ctx.fetchJson = async (url, timeoutMs) => {
            if (!url.endsWith("/swap/v1/program-id-to-label")) return fetchJson(url, timeoutMs);
            recording.http[url] = dexes;
            return dexes;
          };
          return ctx;
        }, { matches: !!c.request });
      } catch (e: any) {
        console.log(`  skipped ${c.group} in slot ${slot}: ${e.message}`);
        payers.delete(payer);
        continue;
      }
      const common = { group: c.group, version: landed.version, payer, signature, program: c.program };
      if (verdict.signals.includes("simulation")) sample.notReplayed.push({ ...common, error: verdict.simulationError });
      else out.push({ ...common, slot, tx: base64, request: c.request, recordedAt: new Date().toISOString(), recordings });
    }
    save();
    console.log(`slot ${slot}: ${(Object.keys(QUOTA) as Group[]).map((g) => `${g} ${have(g)}/${QUOTA[g]}`).join(", ")}; couldn't replay ${sample.notReplayed.length}`);
  }
  save();
  return sample;
}

export const loadSample = (): Sample => JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)).toString("utf8"));
export const loadEveryday = (): EverydayTx[] => loadSample().replayed;

// One transaction's result, replayed from its recording.
export async function replay(t: EverydayTx) {
  const v = await runPulse({ tx: t.tx, request: t.request ?? undefined } as any, (tool) => {
    if (!t.recordings[tool]) throw new Error(`${t.signature} has no recording for ${tool}`);
    return replayContext({ name: `${t.group}/${tool}`, recordedAt: t.recordedAt, args: {}, recording: t.recordings[tool] });
  }, { matches: !!t.request });
  const replayable = !v.signals.includes("simulation");
  return { group: t.group, version: t.version, program: t.program, signature: t.signature, replayable, checkTx: v.checkTx, txMatches: v.txMatches, signals: v.signals, simulationError: v.simulationError };
}

export async function scoreEveryday({ replayed, notReplayed } = loadSample()) {
  const rows = [];
  for (const t of replayed) rows.push(await replay(t));
  const byGroup = Object.fromEntries((Object.keys(QUOTA) as Group[]).map((g) => {
    const ok = rows.filter((r) => r.group === g && r.replayable);
    const reasons: Record<string, number> = {};
    for (const r of ok) for (const s of r.signals) reasons[s] = (reasons[s] ?? 0) + 1;
    const matched = ok.filter((r) => r.txMatches);
    return [g, {
      transactions: ok.length,
      couldntReplay: notReplayed.filter((r) => r.group === g).length,
      checkTx: { OK: ok.filter((r) => r.checkTx === "OK").length, REVIEW: ok.filter((r) => r.checkTx === "REVIEW").length, BLOCK: ok.filter((r) => r.checkTx === "BLOCK").length },
      txMatches: { checked: matched.length, MATCH: matched.filter((r) => r.txMatches === "MATCH").length, MISMATCH: matched.filter((r) => r.txMatches === "MISMATCH").length },
      alarmReasons: reasons,
    }];
  }));
  return { byGroup, rows, notReplayed };
}
