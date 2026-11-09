// THE TUNERS (paper bots only, Tim 2026-11-03: "a strategy that not only learns but adapts every 10 or 20 trades").
// One tuner per paper bot (main desk, fast lane, ladder A, ladder B). The real wallet's rules never change by themselves.
//
// How a tuner decides, and why it is this careful: on 2026-11-01, 32 rules that looked profitable on past trades lost
// 10% on new ones (research/2026-11-01-pulse-data). A rule that wins on the last 20 trades is usually luck. So:
//   - It waits for 40 closed trades, then looks again after every 20 more.
//   - It replays EVERY coin the bot bought (GeckoTerminal 1-minute candles from the buy on) under the bot's current exit
//     rules and under small changes, one knob at a time (each knob x0.67 and x1.5): the stop, the first sale, the trails,
//     the break-even point, the time limit.
//   - It adopts the best change only if it beats the current rules by 0.5%+ a trade on the OLDER half of the coins AND
//     on the NEWER half, and overall. Otherwise nothing changes, and it says so.
//   - Within limits: stop 2-15%, trail gaps 0.2-15%, first sale +1% to +50%, time limit 10 min to 24 h.
//   - Every check and change is logged (desk_events, agent TUNER) and shown on the bot's tab.
// The replay is pessimistic: when one minute touches both a stop and a sale, the stop counts first; a minute that falls
// 10%+ through the stop is a crash and fills at its close; a sale fills no higher than halfway between the minute's high
// and close (a 10-second look doesn't catch the top of a spike); a time-limit sale fills at the next minute's open; a coin
// the bot really had to write off gets 0 for what's left when its candles end (a pull leaves no trade, so the last candle
// still shows the old price); 0.5% cost per sale (the buy price already includes its fee). Same fills as
// scripts/entry-test.ts since 2026-11-07. It reads at most 1,000 minutes after the buy, and can't see liquidity pulls that
// the bot survived or 10-second moves inside a minute. Buying rules are not tuned: only exits.
import { pool } from "../db";
import { RULES } from "./agents";
import { FAST } from "./fast";
import { LADDER_A, LADDER_B } from "./ladder";
import { log } from "./store";

export const TUNER = { minTrades: 40, every: 20, minGainPct: 0.5, costPct: 0.005, fetchPerTick: 6, factors: [0.67, 1.5] };

// One exit-rule shape every bot fits into. steps: sell `stepShare` of the start at each gain (the last can sell all).
export type Exit = {
  stopPct: number; steps: number[]; stepShare: number; lastStepSellsAll: boolean;
  trails: { fromPct: number; gapPct: number }[]; breakEven: null | { fromPct: number; floorPct: number }; maxMinutes: number;
};
export type BotId = "main" | "fast" | "ladder" | "ladderB";
export const BOTS: { id: BotId; name: string; runLike: string; runNotLike?: string[] }[] = [
  { id: "main", name: "main desk", runLike: "%", runNotLike: ["fast-%", "ladder%", "momo-%"] },
  { id: "fast", name: "fast lane", runLike: "fast-%" },
  { id: "ladder", name: "ladder A", runLike: "ladder-%" },
  { id: "ladderB", name: "ladder B", runLike: "ladderB-%" },
];

// The bot's live rules as an Exit, and back.
export function exitOf(bot: BotId): Exit {
  if (bot === "fast") return { stopPct: FAST.stopPct, steps: [FAST.takeProfitPct], stepShare: 1, lastStepSellsAll: true, trails: [], breakEven: null, maxMinutes: FAST.maxMinutes };
  if (bot === "main") return { stopPct: RULES.stopLossPct, steps: [], stepShare: 0, lastStepSellsAll: false, trails: [{ fromPct: RULES.trailStartPct, gapPct: RULES.trailPct }], breakEven: null, maxMinutes: 24 * 60 };
  const r = (bot === "ladder" ? LADDER_A : LADDER_B).rules;
  return { stopPct: r.stopPct, steps: [...r.steps], stepShare: r.stepShare, lastStepSellsAll: r.lastStepSellsAll, trails: r.trails.map((t) => ({ ...t })), breakEven: r.breakEven ? { ...r.breakEven } : null, maxMinutes: r.maxHours * 60 };
}
export function applyExit(bot: BotId, e: Exit) {
  if (bot === "fast") Object.assign(FAST, { stopPct: e.stopPct, takeProfitPct: e.steps[0], maxMinutes: e.maxMinutes });
  else if (bot === "main") Object.assign(RULES, { stopLossPct: e.stopPct, trailStartPct: e.trails[0].fromPct, trailPct: e.trails[0].gapPct });
  // The ladder bots pick the first trail whose start the high has reached, so the list stays highest start first.
  else Object.assign((bot === "ladder" ? LADDER_A : LADDER_B).rules, { stopPct: e.stopPct, steps: e.steps, trails: [...e.trails].sort((x, y) => y.fromPct - x.fromPct), breakEven: e.breakEven, maxHours: e.maxMinutes / 60 });
}

// The rules as written in the code, kept for a reset. A cloud server that hasn't seen a change yet follows them too.
const BASE = Object.fromEntries(BOTS.map((b) => [b.id, exitOf(b.id)])) as Record<BotId, Exit>;

// Replays one coin: entry = the bot's real buy price (fee included), candles = [t, o, h, l, c, volumeUsd] after the buy.
// dead: the bot had to write this coin off live, so what's left when its candles end is worth 0.
// Returns the trade's result as a fraction (+0.05 = +5%).
export function simulate(e: Exit, entry: number, openedSec: number, candles: number[][], cost = TUNER.costPct, dead = false): number {
  let qty = 1, cash = 0, peak = entry, done = 0;
  const end = openedSec + e.maxMinutes * 60;
  let last: number | null = null, afterEnd: number[] | null = null;
  for (const cand of candles) {
    const [t, o, h, l, c, v] = cand;
    if (t <= openedSec - 60) continue;
    if (t > end) { afterEnd = cand; break; }
    const gain = peak / entry - 1;
    const trail = [...e.trails].sort((a, b) => b.fromPct - a.fromPct).find((x) => gain >= x.fromPct - 1e-12);
    const trailStop = trail ? peak * (1 - trail.gapPct) : null;
    const beStop = e.breakEven && gain >= e.breakEven.fromPct - 1e-12 ? entry * (1 + e.breakEven.floorPct) : null;
    const floor = trailStop !== null || beStop !== null ? Math.max(trailStop ?? 0, beStop ?? 0) : entry * (1 - e.stopPct);
    // A minute with almost no trading: its price can't sell a step or set a peak (a $0.01 dust trade at 1,000x is not a
    // price), and it may lower the end price. Since 2026-11-04 (Claude x Gemini entry test) its CLOSE can trigger a
    // stop, filling 5% under: the live bots sell on Jupiter's price on the way down, so a coin bleeding out in thin
    // minutes no longer slips past a -6% stop in the replay.
    if (v < 1000) {
      if (c < (last ?? entry)) last = c;
      if (c <= floor) { cash += qty * Math.min(c, floor) * 0.95 * (1 - cost); qty = 0; break; }
      continue;
    }
    if (c < entry * 20) last = c; // 20x the buy price inside the replay window is a drained pool, not a price (see `real`)
    if (l <= floor) { // the stop first (pessimistic)
      // A stop sale never fills above the stop: junk candles (low near 0, close 1,000x) paid out millions of percent in
      // the entry test. A market sale after a 10-second look fills 2% under the stop.
      const fill = l < floor * 0.9 ? Math.min(c, floor) : Math.min(o, floor) * 0.98;
      cash += qty * fill * (1 - cost); qty = 0; break;
    }
    const real = h < entry * 20; // a 20x one-minute spike is an emptied pool, not a price
    while (real && done < e.steps.length && h >= entry * (1 + e.steps[done])) {
      const lastStep = done === e.steps.length - 1;
      const q = lastStep && e.lastStepSellsAll ? qty : Math.min(qty, e.stepShare);
      cash += q * Math.min(entry * (1 + e.steps[done]), (h + c) / 2) * (1 - cost); qty -= q; done++;
      if (qty <= 1e-9) break;
    }
    if (qty <= 1e-9) break;
    if (real) peak = Math.max(peak, h);
  }
  if (qty > 1e-9) {
    const next = afterEnd && afterEnd[0] <= end + 300 && afterEnd[1] < entry * 20 ? afterEnd[1] : null;
    cash += qty * (next ?? (dead ? 0 : last ?? entry)) * (1 - cost); // time limit: the next minute's open; end of data: 0 if written off, else the last price
  }
  return cash / entry - 1;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
// Every one-knob change to try, inside the limits, with a plain description.
export function candidates(e: Exit): { exit: Exit; change: string }[] {
  const out: { exit: Exit; change: string }[] = [];
  const pc = (x: number) => `${+(x * 100).toFixed(2)}%`;
  for (const f of TUNER.factors) {
    const s = r4(clamp(e.stopPct * f, 0.02, 0.15));
    if (s !== e.stopPct) out.push({ exit: { ...e, stopPct: s }, change: `stop ${pc(e.stopPct)} -> ${pc(s)}` });
    if (e.steps.length && e.steps[0] < 1) {
      const k = clamp(e.steps[0] * f, 0.01, 0.5) / e.steps[0];
      const steps = e.steps.map((x) => (x < 1 ? r4(x * k) : x));
      if (steps[0] !== e.steps[0]) out.push({ exit: { ...e, steps }, change: `first sale at +${pc(e.steps[0])} -> +${pc(steps[0])}${e.steps.filter((x) => x < 1).length > 1 ? " (all small tiers scaled)" : ""}` });
    }
    e.trails.forEach((t, i) => {
      const g = r4(clamp(t.gapPct * f, 0.002, 0.15));
      if (g !== t.gapPct) out.push({ exit: { ...e, trails: e.trails.map((x, j) => (j === i ? { ...x, gapPct: g } : x)) }, change: `trail from +${pc(t.fromPct)}: ${pc(t.gapPct)} -> ${pc(g)} below the high` });
      const fr = r4(clamp(t.fromPct * f, 0.005, 2));
      if (fr !== t.fromPct) out.push({ exit: { ...e, trails: e.trails.map((x, j) => (j === i ? { ...x, fromPct: fr } : x)) }, change: `trail starts at +${pc(t.fromPct)} -> +${pc(fr)}` });
    });
    if (e.breakEven) {
      const b = r4(clamp(e.breakEven.fromPct * f, Math.max(0.006, e.breakEven.floorPct + 0.001), 0.2));
      if (b !== e.breakEven.fromPct) out.push({ exit: { ...e, breakEven: { ...e.breakEven, fromPct: b } }, change: `break-even stop from +${pc(e.breakEven.fromPct)} -> +${pc(b)}` });
    }
    const m = Math.round(clamp(e.maxMinutes * f, 10, 24 * 60));
    if (m !== e.maxMinutes) out.push({ exit: { ...e, maxMinutes: m }, change: `time limit ${e.maxMinutes} min -> ${m} min` });
  }
  return out;
}

export type Coin = { at: number; entry: number; candles: number[][]; dead?: boolean };
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
// Scores the current rules and every candidate on all coins and on each half (older / newer). Pure: tests use it directly.
export function decide(current: Exit, coins: Coin[]) {
  const sorted = [...coins].sort((a, b) => a.at - b.at), half = Math.floor(sorted.length / 2);
  const score = (e: Exit) => {
    const r = sorted.map((c) => simulate(e, c.entry, c.at, c.candles, TUNER.costPct, !!c.dead));
    return { all: avg(r) * 100, older: avg(r.slice(0, half)) * 100, newer: avg(r.slice(half)) * 100 };
  };
  const base = score(current);
  const tried = candidates(current).map((c) => ({ ...c, score: score(c.exit) }));
  const beats = tried.filter((c) => c.score.older - base.older >= TUNER.minGainPct && c.score.newer - base.newer >= TUNER.minGainPct && c.score.all > base.all)
    .sort((a, b) => b.score.all - a.score.all);
  return { base, best: beats[0] ?? null, tried: tried.length, runnerUp: [...tried].sort((a, b) => b.score.all - a.score.all)[0] ?? null };
}

// ---------------- storage, candles, the per-tick run ----------------
export async function ensureTunerSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS desk_candles (position_id BIGINT PRIMARY KEY, pool TEXT, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), candles JSONB NOT NULL)`);
}
type BotTuning = { exit?: Exit; last_count: number; history: { at: string; trades: number; change: string | null; base: any; best: any; note: string }[] };
async function readTuning(): Promise<Record<string, BotTuning>> {
  const r = await pool.query(`SELECT value FROM desk_state WHERE key = 'tuning'`);
  return r.rows[0]?.value ?? {};
}
async function writeTuning(t: Record<string, BotTuning>) {
  await pool.query(`INSERT INTO desk_state (key, value) VALUES ('tuning', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(t)]);
}
// Puts every bot's tuned exits in force (called at the start of each tick and before the page reads the rules).
export async function applyTuning() {
  const t = await readTuning().catch(() => ({} as Record<string, BotTuning>));
  for (const b of BOTS) applyExit(b.id, t[b.id]?.exit ?? BASE[b.id]);
}
// A fresh start (deskReset): forget every tuned exit and every look so far.
export async function resetTuning() {
  await writeTuning({});
  for (const b of BOTS) applyExit(b.id, BASE[b.id]);
}
const botWhere = (b: (typeof BOTS)[number]) => `run_id LIKE '${b.runLike}'${(b.runNotLike ?? []).map((x) => ` AND run_id NOT LIKE '${x}'`).join("")}`;
// The coins a bot's tuner learns from. Ladder A and B buy the same coins, so each learns from both.
function coinWhere(bot: BotId) {
  if (bot === "ladder" || bot === "ladderB") return `(run_id LIKE 'ladder-%' OR run_id LIKE 'ladderB-%')`;
  return botWhere(BOTS.find((b) => b.id === bot)!);
}

// Fetches candles for closed positions that have none yet (a few a tick: GeckoTerminal allows ~30 calls a minute).
export async function fetchCandles(fetchJson: (url: string) => Promise<any>, limit = TUNER.fetchPerTick) {
  const need = (await pool.query(`SELECT p.id, p.pool, EXTRACT(EPOCH FROM p.opened_at)::bigint AS at FROM desk_positions p LEFT JOIN desk_candles c ON c.position_id = p.id
    WHERE p.closed_at IS NOT NULL AND c.position_id IS NULL AND p.closed_at < NOW() - INTERVAL '20 minutes' ORDER BY p.closed_at DESC LIMIT $1`, [limit])).rows;
  let got = 0;
  for (const p of need) {
    const before = Math.min(Math.floor(Date.now() / 1000), Number(p.at) + 1000 * 60);
    try {
      const d = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p.pool}/ohlcv/minute?aggregate=1&limit=1000&before_timestamp=${before}&currency=usd`);
      const cs = (d?.data?.attributes?.ohlcv_list ?? []).map((x: any[]) => x.map(Number)).sort((a: number[], b: number[]) => a[0] - b[0]);
      await pool.query(`INSERT INTO desk_candles (position_id, pool, candles) VALUES ($1,$2,$3) ON CONFLICT (position_id) DO NOTHING`, [p.id, p.pool, JSON.stringify(cs)]);
      got++;
    } catch { /* tried again next tick */ }
  }
  return got;
}

// One tuner pass: for each bot with 20+ new closed trades (and 40+ in all), replay and maybe change one rule.
export async function tunerTick(fetchJson: (url: string) => Promise<any>, nowMs: number, currentRunIds: Partial<Record<BotId, string>>) {
  await fetchCandles(fetchJson).catch(() => 0);
  const t = await readTuning();
  const out: Record<string, string> = {};
  for (const b of BOTS) {
    // Counted in the current run, so a fresh run really waits for its own 40 trades.
    const current = currentRunIds[b.id];
    const closed = Number((await pool.query(`SELECT COUNT(*) AS n FROM desk_positions WHERE closed_at IS NOT NULL AND ${current ? "run_id = $1" : botWhere(b)}`, current ? [current] : [])).rows[0].n);
    const st: BotTuning = t[b.id] ?? { last_count: 0, history: [] };
    const due = closed >= TUNER.minTrades && closed >= st.last_count + TUNER.every;
    if (!due) { out[b.id] = `waiting: ${closed} closed, next look at ${Math.max(TUNER.minTrades, st.last_count + TUNER.every)}`; continue; }
    const rows = (await pool.query(`SELECT DISTINCT ON (p.mint) p.id, EXTRACT(EPOCH FROM p.opened_at)::bigint AS at, p.entry_price, p.exit_reason, c.candles FROM desk_positions p
      JOIN desk_candles c ON c.position_id = p.id WHERE p.closed_at IS NOT NULL AND ${coinWhere(b.id)} ORDER BY p.mint, p.opened_at`)).rows;
    if (rows.length < Math.min(closed, TUNER.minTrades) * 0.8) { out[b.id] = `fetching price history (${rows.length} of ${closed} coins so far)`; continue; }
    const coins: Coin[] = rows.map((r: any) => ({ at: Number(r.at), entry: Number(r.entry_price), candles: r.candles, dead: String(r.exit_reason ?? "").startsWith("no price") }));
    const d = decide(exitOf(b.id), coins);
    const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
    let note: string;
    if (d.best) {
      applyExit(b.id, d.best.exit); st.exit = d.best.exit;
      note = `Changed ${d.best.change}: replay of ${coins.length} coins ${f(d.base.all)} -> ${f(d.best.score.all)} a trade (older half ${f(d.base.older)} -> ${f(d.best.score.older)}, newer ${f(d.base.newer)} -> ${f(d.best.score.newer)}).`;
    } else {
      note = `No change: none of ${d.tried} one-knob changes beat the current rules by ${TUNER.minGainPct}% a trade on both halves (current ${f(d.base.all)} a trade on ${coins.length} coins${d.runnerUp ? `; closest: ${d.runnerUp.change}, ${f(d.runnerUp.score.all)}` : ""}).`;
    }
    st.last_count = closed;
    st.history = [{ at: new Date(nowMs).toISOString(), trades: closed, change: d.best?.change ?? null, base: d.base, best: d.best?.score ?? null, note }, ...st.history].slice(0, 20);
    t[b.id] = st; out[b.id] = note;
    const runId = currentRunIds[b.id];
    if (runId) await log(runId, "TUNER", d.best ? "change" : "check", note);
  }
  await writeTuning(t);
  return out;
}

// What each bot's tab shows about its tuner.
export async function tunerSummary() {
  const t = await readTuning().catch(() => ({} as Record<string, BotTuning>));
  const out: Record<string, unknown> = {};
  for (const b of BOTS) {
    const closed = Number((await pool.query(`SELECT COUNT(*) AS n FROM desk_positions WHERE closed_at IS NOT NULL AND ${botWhere(b)}`)).rows[0].n);
    const st = t[b.id] ?? { last_count: 0, history: [] };
    out[b.id] = { closed, next_look_at: Math.max(TUNER.minTrades, st.last_count + TUNER.every), tuned: !!st.exit, changes: st.history.filter((h) => h.change).length, history: st.history.slice(0, 5) };
  }
  return out;
}
