// The six desk agents. Each one takes only what the agent before it handed over and returns a plain object (the hard
// handoff); none of them reaches back into another's data. Rules are fixed here, in code, with their reasons.
// Paper trading only: nothing here signs or sends a transaction.
import { rugReport } from "../tools/lib";
import type { ToolContext } from "../tools/types";

// ---------------- the rules (all of them; changing one is a commit) ----------------
export const RULES = {
  // FILTER: at least $10k traded in the last hour (GeckoTerminal). Was $50k until 2026-11-03: that one rule turned away
  // 97% of the coins the run of Nov 2-3 rejected, so both lanes bought about once an hour, after the spike. In desk_watch
  // (43,160 coins, Nov 2-3) coins first seen at $10k-$50k were less often dead 6 hours later (12-22% down 90%+) than those
  // at $50k+ (33%), and about as often up 10%+ (27-32% vs 36%). Every safety rule after this one is unchanged.
  minVolumeH1Usd: 10_000,
  writeOffMinutes: 30, // RISK: a coin no source has priced for this long is written off at 0, as on the other lanes
  maxTop10Pct: 20, // FILTER: the 10 biggest holders own at most 20% (Jupiter holder data, via token_safety)
  minLpLockedPct: 95, // FILTER: at least 95% of the pool liquidity locked or burned, weighted by USD (RugCheck)
  // FILTER, TEST RULE (2026-11-01, from 3 coins only, so it is measured, see desk_watch): skip a coin whose total value is
  // over 300x the cash in its pool (GeckoTerminal fdv / pool reserve). XTO was 487x when bought and was dumped to zero in
  // one minute; the two AODFs (229x, 238x) were also dumped; the 5 trades that weren't were 7-56x. Known coins sit far
  // lower (BOME 3x, WIF 33x, BONK 43x). 100-300x is Pulse's rug_chance "high" territory: traded, with the ladder.
  // 2026-11-03 (Tim: buy riskier coins, let Pulse say when to get out): no longer a reject. Over 300x is bought in the
  // likely-rug tier with the ladder and the Pulse pull watch below; the ratio is still recorded (desk_watch) to measure it.
  maxValueToLiquidity: 300,
  minScore: 0.6, // ANALYST: below this, rejected
  positionPct: 0.08, // EXECUTOR: 8% of current equity per trade, never more (and never more than the cash on hand)
  stopLossPct: 0.06, // RISK: sell when price is 6% below the entry
  trailStartPct: 0.12, // RISK: once a position is up 12%, a trailing stop starts
  trailPct: 0.06, // RISK: the trailing stop sells 6% below the highest price since entry (not given in the brief; chosen here)
  // RISK, the likely-rug tier: tokens Solana Pulse gives rug_chance "high" are still traded, but sell in steps on the way
  // up, because a rug empties the pool in one transaction and no stop can sell into that (AODF, 2026-11-01: both were up
  // 79% and 111% before their insiders dumped; the trail sold what was left for a few dollars). Each step sells an equal
  // share of the starting position and one share stays on the trailing stop: 3 steps = 25% each, last 25% on the trail.
  // The stop is not moved: it can't beat a one-swap rug.
  ladderSteps: [0.5, 1.0, 1.5],
  // Two open tokens with the same ticker (both AODFs were held at once, and both rugged): both may be held, both go in
  // the likely-rug tier, and both get a finer, sooner ladder: 12.5% at every +12.5% up to +87.5%, last 12.5% on the trail.
  sameTickerLadderSteps: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
  feePct: 0.0025, // paper fills: swap fee per side, plus price impact of size / pool liquidity
  volumeRetryMinutes: 20, // a token rejected only for low volume is looked at again after this long
  maxDeepChecksPerTick: 4, // token_safety + RugCheck are slow; at most this many new tokens get the full check each minute
  // RISK, the Pulse pull watch (2026-11-03): likely-rug positions (Pulse said AVOID or rug_chance high at the buy) are
  // checked again with Solana Pulse's token_safety every 2 minutes, and sold in full when Pulse sees the pull starting
  // against what it saw at the buy (pullSignals). It can't beat a pull done in one swap (XTO, Nov 1); it is there for
  // the ones that drain over minutes. A test rule: every check is logged so the paper run measures it.
  pullWatch: { everyMinutes: 2, maxPerTick: 3, liquidityDropPct: 30, insiderDropPts: 5, top10RisePts: 10, holdersDropPct: 25 },
};

// ---------------- SCOUT ----------------
export type Candidate = {
  pool: string; mint: string; symbol: string; dex: string; poolCreatedAt: string | null;
  priceUsd: number | null; liquidityUsd: number | null; fdvUsd?: number | null; volumeH1Usd: number | null; changeH1Pct: number | null;
  buysH1: number | null; sellsH1: number | null; buyersH1: number | null;
};
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export function candidateFrom(p: any): Candidate | null {
  const a = p?.attributes, base = p?.relationships?.base_token?.data?.id;
  if (!a || typeof base !== "string" || !base.startsWith("solana_")) return null;
  const tx = a.transactions?.h1 ?? {};
  return {
    pool: String(a.address), mint: base.slice(7), symbol: String(a.name ?? "").split(" / ")[0] || "?", dex: String(p.relationships?.dex?.data?.id ?? "?"),
    poolCreatedAt: a.pool_created_at ?? null, priceUsd: num(a.base_token_price_usd), liquidityUsd: num(a.reserve_in_usd), fdvUsd: num(a.fdv_usd),
    volumeH1Usd: num(a.volume_usd?.h1), changeH1Pct: num(a.price_change_percentage?.h1), buysH1: num(tx.buys), sellsH1: num(tx.sells), buyersH1: num(tx.buyers),
  };
}
// New pools (Pump.fun, PumpSwap, Raydium, Meteora...) and the pools trending in the last hour, from GeckoTerminal.
// GeckoTerminal refuses bursts (2026-11-05: 50-100% of scans every hour since Nov 3 lost a page to HTTP 429). The live
// fetchJson spaces every GeckoTerminal call (gtGate.ts); here a refused page is asked for once more after a pause.
export const SCOUT_PACE = { retryAfterMs: 4000 };
export async function scout(fetchJson: (url: string) => Promise<any>, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<{ candidates: Candidate[]; sources: string[]; errors: string[] }> {
  const base = "https://api.geckoterminal.com/api/v2/networks/solana";
  const urls = [`${base}/new_pools?page=1`, `${base}/new_pools?page=2`, `${base}/trending_pools?page=1&duration=1h`, `${base}/trending_pools?page=2&duration=1h`];
  const seen = new Map<string, Candidate>(), errors: string[] = [];
  const get = async (url: string) => {
    try { return await fetchJson(url); } catch (e: any) {
      if (!/HTTP 429/.test(String(e?.message ?? e))) throw e;
      await sleep(SCOUT_PACE.retryAfterMs);
      return fetchJson(url);
    }
  };
  for (const url of urls) {
    try {
      for (const p of (await get(url))?.data ?? []) {
        const c = candidateFrom(p);
        if (c && !c.mint.startsWith("So1111111") && !seen.has(c.mint)) seen.set(c.mint, c); // skip pools whose base is SOL itself
      }
    } catch (e: any) { errors.push(`${url.split("/solana/")[1]}: ${String(e?.message ?? e).slice(0, 80)}`); }
  }
  return { candidates: [...seen.values()], sources: urls, errors };
}

// ---------------- FILTER ----------------
export type FilterResult = { pass: boolean; stage: "volume" | "deep"; reasons: string[]; facts: Record<string, unknown> };
// Stage 1, no chain calls: volume. A Pump.fun bonding-curve token has no pool liquidity that can be locked, so it fails here too.
// Total value (price x whole supply, GeckoTerminal's fdv) over the pool's cash. null when either is missing: unknown.
export const valueToLiquidity = (c: Candidate) => (c.fdvUsd && c.liquidityUsd ? c.fdvUsd / c.liquidityUsd : null);
export function filterVolume(c: Candidate): FilterResult {
  const reasons: string[] = [];
  const ratio = valueToLiquidity(c);
  if (c.volumeH1Usd === null) reasons.push("1h volume unknown");
  else if (c.volumeH1Usd < RULES.minVolumeH1Usd) reasons.push(`1h volume $${Math.round(c.volumeH1Usd).toLocaleString("en-US")} < $${RULES.minVolumeH1Usd.toLocaleString("en-US")}`);
  if (c.dex === "pump-fun") reasons.push("still on the Pump.fun bonding curve: no pool liquidity that can be locked");
  return { pass: reasons.length === 0, stage: "volume", reasons, facts: { volumeH1Usd: c.volumeH1Usd, dex: c.dex, valueToLiquidity: ratio } };
}

// The live Solana Pulse server, so every desk check shows in Pulse's own usage log (as the owner, "You": never counted
// as an outside user, never charged). Same token_safety as Pulse's public tool, always the current version.
const PULSE = process.env.PULSE_URL ?? "https://solana-pulse-gateway-1021990235790.us-central1.run.app";
export async function pulseTokenSafety(mint: string): Promise<any> {
  const key = process.env.PULSE_OWNER_API_KEY;
  if (!key) throw new Error("PULSE_OWNER_API_KEY not loaded");
  const r = await fetch(`${PULSE}/api/tools/token_safety`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", "x-api-key": key, "user-agent": "trade-desk-desk/1 (owner)" },
    body: JSON.stringify({ token: mint, network: "mainnet-beta" }),
  });
  if (!r.ok) throw new Error(`Solana Pulse answered HTTP ${r.status}`);
  return r.json();
}

// Stage 2: the safety rules, from Solana Pulse's token_safety and RugCheck. Anything that can't be verified fails.
export async function filterDeep(ctx: ToolContext, c: Candidate, deps = { safety: pulseTokenSafety, rug: (mint: string) => rugReport(ctx, mint) }): Promise<FilterResult> {
  const reasons: string[] = [];
  let s: any = null;
  try { s = await deps.safety(c.mint); } catch (e: any) { reasons.push(`token_safety failed: ${String(e?.message ?? e).slice(0, 100)}`); }
  const check = (name: string) => (s?.checks ?? []).find((k: any) => k.name === name);
  const facts: Record<string, unknown> = { verdict: s?.verdict ?? null, rugChance: s?.rug_chance ?? null };
  // Measured, not ruled on here (Pulse's rug_chance already counts them): the creator splitting supply after launch.
  facts.creatorSplit = (s?.checks ?? []).find((k: any) => k.name === "creator_split")?.result ?? null;
  // What Pulse saw at the buy, so the pull watch can tell what changed since.
  if (s) facts.pull = pullSnapshot(s);
  if (s) {
    // Mint authority revoked.
    const mint = check("mint_authority");
    facts.mintAuthority = s.about?.who_can_mint ?? null;
    if (!mint) reasons.push("mint authority: not verified");
    else if (s.about?.who_can_mint) reasons.push(`mint authority NOT revoked (${s.about.who_can_mint})`);
    // Freeze authority revoked: a frozen token can't be sold (capital preservation; not in the brief's list).
    if (s.about?.who_can_freeze) reasons.push(`freeze authority NOT revoked (${s.about.who_can_freeze})`);
    else if (!check("freeze_authority")) reasons.push("freeze authority: not verified");
    // Top 10 holders at most 20%.
    const top10 = s.about?.top10_share_pct;
    facts.top10Pct = top10 ?? null;
    if (typeof top10 !== "number") reasons.push("top 10 holders: not verified");
    else if (top10 > RULES.maxTop10Pct) reasons.push(`top 10 holders own ${top10}% > 20%`);
    // Developer wallet not connected to previous rugs.
    const creator = check("creator_history");
    facts.creator = s.about?.creator ?? null;
    if (!creator) reasons.push("creator history: not verified");
    else if (creator.result === "fail") reasons.push(`creator: ${creator.detail}`);
    else if (creator.result !== "pass") reasons.push(`creator not clean: ${creator.detail}`);
    // AVOID is a reject again (2026-11-04, Tim: "apply what we've learned from Gemini"). From 2026-11-03 the main desk
    // bought AVOID coins in the likely-rug tier; the Nov 3 verdict check found 82% of AVOID coins dead (-90% or no
    // price) and 5% up (research/2026-11-03-verdict-outcomes), and Gemini's review flagged it independently.
    if (s.verdict === "AVOID") reasons.push(`Pulse says AVOID${s.summary ? `: ${String(s.summary).slice(0, 120)}` : ""}`);
    // A real holder must be able to sell it (honeypot check; capital preservation, not in the brief's list).
    const sell = check("sell_test");
    if (!sell || sell.result !== "pass") reasons.push(`sell test: ${sell ? sell.detail : "not verified"}`);
  }
  // LP locked: USD-weighted share of pool liquidity that is locked or burned.
  try {
    const { report, ok } = await deps.rug(c.mint);
    if (!ok || !report) reasons.push("LP lock: RugCheck unavailable, not verified");
    else {
      if (report.rugged) reasons.push("RugCheck marks this token as rugged");
      const markets = (report.markets ?? []).map((m) => ({ usd: (m.lp?.quoteUSD ?? 0) + (m.lp?.baseUSD ?? 0), locked: m.lp?.lpLockedPct }));
      const total = markets.reduce((t, m) => t + m.usd, 0);
      if (!markets.length || total <= 0 || markets.some((m) => typeof m.locked !== "number")) reasons.push("LP lock: not verified");
      else {
        const locked = markets.reduce((t, m) => t + m.usd * Math.min(100, Math.max(0, m.locked as number)), 0) / total;
        facts.lpLockedPct = Math.round(locked * 10) / 10;
        if (locked < RULES.minLpLockedPct) reasons.push(`LP only ${locked.toFixed(1)}% locked < 95%`);
      }
    }
  } catch { reasons.push("LP lock: not verified"); }
  return { pass: reasons.length === 0, stage: "deep", reasons, facts };
}

// ---------------- the Pulse pull watch (used by RISK) ----------------
// The numbers from one token_safety answer that move when insiders start selling or liquidity starts leaving. Missing = null.
export type PullSnapshot = { liquidityUsd: number | null; holders: number | null; top10Pct: number | null; insiderPct: number | null; fails: string[] };
export function pullSnapshot(s: any): PullSnapshot {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ins = (s?.checks ?? []).find((k: any) => k.name === "insiders");
  const m = /hold ([\d.]+)% of the supply/.exec(String(ins?.detail ?? ""));
  return {
    liquidityUsd: n(s?.about?.liquidity_usd), holders: n(s?.about?.holders), top10Pct: n(s?.about?.top10_share_pct),
    insiderPct: m ? Number(m[1]) : ins?.result === "pass" ? 0 : null,
    fails: (s?.checks ?? []).filter((k: any) => k.result === "fail").map((k: any) => String(k.name)),
  };
}
// Why to sell now, comparing Pulse's answer now with its answer at the buy. Empty = hold. A number either side doesn't
// know is skipped, never guessed. Pulse's own history (its 2-hourly watch) counts too when it has seen a pull or crash.
export function pullSignals(then: PullSnapshot | null | undefined, now: PullSnapshot, history?: any): string[] {
  const w = RULES.pullWatch, out: string[] = [];
  for (const c of history?.changes ?? []) if (["liquidity_pulled", "price_crashed", "liquidity_halved", "holders_halved"].includes(c?.what)) out.push(`Pulse history: ${c.what.replace("_", " ")}`);
  if (!then) return out;
  if (then.liquidityUsd && now.liquidityUsd !== null && now.liquidityUsd <= then.liquidityUsd * (1 - w.liquidityDropPct / 100))
    out.push(`liquidity down ${Math.round((1 - now.liquidityUsd / then.liquidityUsd) * 100)}% since the buy ($${Math.round(then.liquidityUsd).toLocaleString("en-US")} -> $${Math.round(now.liquidityUsd).toLocaleString("en-US")})`);
  if (then.insiderPct !== null && now.insiderPct !== null && then.insiderPct - now.insiderPct >= w.insiderDropPts)
    out.push(`linked insider wallets selling: ${then.insiderPct}% -> ${now.insiderPct}% of the supply`);
  if (then.top10Pct !== null && now.top10Pct !== null && now.top10Pct - then.top10Pct >= w.top10RisePts)
    out.push(`top 10 holders gathering supply: ${then.top10Pct}% -> ${now.top10Pct}%`);
  if (then.holders && now.holders !== null && now.holders <= then.holders * (1 - w.holdersDropPct / 100))
    out.push(`holders down ${Math.round((1 - now.holders / then.holders) * 100)}% (${then.holders} -> ${now.holders})`);
  const newFails = now.fails.filter((f) => !then.fails.includes(f));
  if (newFails.length) out.push(`new failing Pulse check: ${newFails.join(", ")}`);
  return out;
}
// Positions the pull watch looks after: Pulse said AVOID or rug_chance high at the buy, or a same-ticker pair (ladder).
export const pullWatched = (p: { ladder: unknown; entry_detail: any }) =>
  !!p.ladder || p.entry_detail?.filter?.verdict === "AVOID" || p.entry_detail?.filter?.rugChance?.level === "high";

// ---------------- ANALYST ----------------
// A 0-1 score from market facts. The weights are a starting point, not a proven model: the paper run measures them.
// Age carries the most weight because Pulse's own 100-token test found 40 of 45 tokens under 1 hour old lost 90%+.
export function analyst(c: Candidate, nowMs = Date.now()) {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const ageH = c.poolCreatedAt ? (nowMs - Date.parse(c.poolCreatedAt)) / 3_600_000 : null;
  const parts: Record<string, { value: number; weight: number; why: string }> = {
    age: { weight: 0.25, value: ageH === null ? 0 : ageH < 1 ? 0 : ageH < 6 ? 0.3 : ageH < 24 ? 0.6 : ageH < 72 ? 0.85 : 1, why: ageH === null ? "pool age unknown" : `pool ${ageH.toFixed(1)}h old` },
    liquidity: { weight: 0.2, value: clamp((c.liquidityUsd ?? 0) / 250_000), why: `liquidity $${Math.round(c.liquidityUsd ?? 0).toLocaleString("en-US")}` },
    buyPressure: { weight: 0.15, value: (() => { const b = c.buysH1 ?? 0, s = c.sellsH1 ?? 0; return b + s ? clamp((b / (b + s) - 0.4) / 0.3) : 0; })(), why: `${c.buysH1 ?? "?"} buys / ${c.sellsH1 ?? "?"} sells in 1h` },
    breadth: { weight: 0.15, value: clamp((c.buyersH1 ?? 0) / 400), why: `${c.buyersH1 ?? "?"} distinct buyers in 1h` },
    momentum: { weight: 0.15, value: (() => { const m = c.changeH1Pct; if (m === null) return 0; if (m < -5) return 0.2; if (m <= 40) return 1; if (m <= 100) return 0.5; return 0.1; })(), why: `price ${c.changeH1Pct ?? "?"}% in 1h (steady rise best, parabolic worst)` },
    turnover: { weight: 0.1, value: (() => { const l = c.liquidityUsd ?? 0, v = c.volumeH1Usd ?? 0; if (!l) return 0; const r = v / l; return r < 0.2 ? 0.3 : r <= 3 ? 1 : r <= 8 ? 0.5 : 0.2; })(), why: "1h volume relative to liquidity" },
  };
  const score = Object.values(parts).reduce((t, p) => t + p.value * p.weight, 0);
  return { score: Math.round(score * 1000) / 1000, pass: score >= RULES.minScore, parts };
}

// ---------------- EXECUTOR (paper) ----------------
// Size: 8% of current equity, never more, and never more than the cash on hand. Tokens with the same ticker share one
// 8%: a second one gets only what the first still holds at cost leaves free (twinCost). Fill: price plus fee and impact.
export function executorPlan(c: Candidate, equity: number, cash: number, twinCost = 0) {
  const room = equity * RULES.positionPct - twinCost;
  const size = Math.min(room, cash);
  if (!c.priceUsd || !c.liquidityUsd) return { ok: false as const, reason: "no live price or liquidity" };
  if (twinCost > 0 && room < 1) return { ok: false as const, reason: `another ${c.symbol} already uses the 8% the same ticker shares ($${twinCost.toFixed(2)} still held at cost)` };
  if (size < 1) return { ok: false as const, reason: `not enough cash ($${cash.toFixed(2)})` };
  const impact = size / c.liquidityUsd;
  const fill = c.priceUsd * (1 + RULES.feePct + impact);
  return { ok: true as const, size, fill, qty: size / fill, impact };
}

// ---------------- RISK ----------------
export type Open = { entry_price: number; peak_price: number; trail_active: boolean; qty: number };
// What to do with an open position at the latest price. Never adds to a position, never re-enters (EXECUTOR checks that).
export function riskDecision(p: Open, price: number) {
  const peak = Math.max(p.peak_price, price);
  const trail = p.trail_active || peak >= p.entry_price * (1 + RULES.trailStartPct);
  if (price <= p.entry_price * (1 - RULES.stopLossPct)) return { exit: true, reason: `stop-loss: ${((price / p.entry_price - 1) * 100).toFixed(1)}% from entry`, peak, trail };
  if (trail && price <= peak * (1 - RULES.trailPct)) return { exit: true, reason: `trailing stop: ${((price / peak - 1) * 100).toFixed(1)}% from peak (${((peak / p.entry_price - 1) * 100).toFixed(1)}% up at best)`, peak, trail };
  return { exit: false, reason: trail ? "holding, trailing stop active" : "holding", peak, trail };
}
// Which ladder a new position gets: none for a normal token; the ladder when Pulse says rug_chance "high"; the finer
// same-ticker ladder when another token with the same ticker is already held (whatever Pulse said about either).
export function ladderFor(rugHigh: boolean, sameTickerHeld: boolean): number[] | null {
  if (sameTickerHeld) return [...RULES.sameTickerLadderSteps];
  return rugHigh ? [...RULES.ladderSteps] : null;
}
// The share of the starting position each step sells: one equal share per step, plus one left for the trailing stop.
export const ladderSellShare = (ladder: number[]) => 1 / (ladder.length + 1);
// How many ladder steps to sell now: every step not yet sold whose price the current price has reached.
export function ladderSells(p: { entry_price: number; ladder: number[] | null; ladder_done: number }, price: number) {
  if (!p.ladder) return 0;
  let n = 0;
  for (let i = p.ladder_done; i < p.ladder.length && price >= p.entry_price * (1 + p.ladder[i]); i++) n++;
  return n;
}
export const exitFill = (price: number, size: number, liquidity: number | null) => price * (1 - RULES.feePct - (liquidity ? size / liquidity : 0.05));
