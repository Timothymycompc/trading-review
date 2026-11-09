// Base rate: how often trace flags ordinary active wallets (README, Tests). Run: RPC=<url> npx tsx benchmark/trace-everyday.ts [count] [file of wallets to include]. Wallets = fee payers of successful non-vote transactions
// that moved SOL or tokens, in one recent mainnet block. Prints each flag's rate and every flagged wallet.
import { Connection, PublicKey } from "@solana/web3.js";
import { TOOLS_BY_NAME } from "../server/tools";
const conn = new Connection(process.env.RPC!, "confirmed");
const ctx: any = { connection: () => conn, fetchJson: async (u: string) => (await fetch(u)).json() };
const N = Number(process.argv[2] ?? 40);
const slot = (await conn.getSlot("finalized")) - 50;
// Raw RPC: web3.js can't read blocks that contain version 1 transactions.
const block: any = (await (await fetch(process.env.RPC!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlock",
  params: [slot, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, transactionDetails: "full", rewards: false }] }) })).json()).result;
const VOTE = "Vote111111111111111111111111111111111111111";
const payers = [...new Set(block.transactions.filter((t: any) => !t.meta?.err && !t.transaction.message.instructions.some((i: any) => i.programId === VOTE)
  && t.transaction.message.instructions.some((i: any) => ["system", "spl-token"].includes(i.program) && /transfer/i.test(i.parsed?.type ?? "")))
  .map((t: any) => t.transaction.message.accountKeys[0].pubkey))] as string[];
import fs from "fs";
const prior = process.argv[3] && fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], "utf8").split("\n").filter(Boolean) : [];
const sample = [...prior, ...payers.filter((p) => !prior.includes(p)).sort(() => Math.random() - 0.5).slice(0, N)];
fs.writeFileSync("benchmark/trace-sample.txt", sample.join("\n") + "\n");
console.log(`block ${slot}: ${payers.length} candidate wallets, sampled ${sample.length}`);
const counts: Record<string, number> = {}; let done = 0;
for (const wallet of sample) {
  try {
    const r: any = await TOOLS_BY_NAME.get("trace")!.run({ wallet, how_many: 25, network: "mainnet-beta" }, ctx);
    done++;
    for (const f of r.flags) counts[f.name] = (counts[f.name] ?? 0) + 1;
    if (r.flags.length) console.log(`  ${wallet}  ${r.flags.map((f: any) => `${f.name}(${f.level})`).join(", ")}  | ${r.flows.length} tx`);
    for (const f of r.flags) counts[`${f.name}:${f.level}`] = (counts[`${f.name}:${f.level}`] ?? 0) + 1;
  } catch (e: any) { console.log(`  ${wallet} ERROR ${e.message.slice(0, 80)}`); }
}
console.log(`\nread ${done} of ${sample.length}`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v} of ${done} (${Math.round(v / done * 100)}%)`);
