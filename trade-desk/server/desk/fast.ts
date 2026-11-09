// The FAST LANE (paper, started 2026-11-02): a second desk with its own money, next to the main one, to test the replay
// in research/2026-11-02-fast-lane. There, on coins that passed the desk's safety rules and that Solana Pulse didn't call
// AVOID, "sell at +10%, stop at -6%, sell after 30 minutes" averaged +3.8% a trade, and the same rule lost 5.1% a trade
// on coins that failed the rules. That was 15 coins from one day: a lead, not proof. This lane measures it live.
//
// How it differs from the main desk: it buys every coin that passes FILTER (the same safety rules) unless Pulse's
// verdict is AVOID, with no age or score requirement (young Pump.fun coins get in), and it gets out fast. Prices are
// checked every 10 seconds (Jupiter's price API), and a position is sold at the first of: +10%, -6%, 30 minutes.
// Same paper fills as the main desk (swap fee plus price impact). Paper trading only: nothing here signs anything.
import { pool } from "../db";
import { executorPlan, exitFill, RULES, type Candidate } from "./agents";
import { log, type Run } from "./store";
import { isRetired } from "./retired";

export const FAST = {
  takeProfitPct: 0.1, // sell when the price is 10% above the entry (entry includes fee and impact)
  stopPct: 0.06, // sell when the price is 6% below the entry
  maxMinutes: 30, // sell after 30 minutes whatever the price: in the replay, holding to 60 minutes lost money
  writeOffMinutes: 30, // no price from any source this long: written off at 0, as on the ladder lanes (a dead coin must not sit open at its last price)
  checkSeconds: 10, // how often prices are checked inside each one-minute tick
  skipVerdict: "AVOID", // Pulse's verdict that keeps a coin out (AVOID coins in the replay were rugged)
};
const KEY = "fast_run";
// Jupiter's keyed API when the desk has a key (higher limits), its free one when not. Read at call time: secrets load after import.
const jupPrice = () => (process.env.JUPITER_API_KEY ? "https://api.jup.ag/price/v3?ids=" : "https://lite-api.jup.ag/price/v3?ids=");

export async function currentFast(): Promise<Run | null> {
  const r = await pool.query(`SELECT value FROM desk_state WHERE key = $1`, [KEY]);
  return r.rows[0]?.value ?? null;
}
export async function startFast(balance = 1000): Promise<Run> {
  const at = new Date().toISOString();
  const run: Run = { run_id: `fast-${at.replace(/[:.]/g, "-")}`, mode: "paper", started_at: at, start_balance: balance, cash: balance };
  await pool.query(`INSERT INTO desk_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, JSON.stringify(run)]);
  return run;
}
// Cash moves in one statement, so a buy (main tick) and a sale (price watcher) running at the same time can't lose either.
async function addCash(delta: number): Promise<Run> {
  const r = await pool.query(`UPDATE desk_state SET value = jsonb_set(value, '{cash}', to_jsonb((value->>'cash')::float8 + $2::float8)) WHERE key = $1 RETURNING value`, [KEY, delta]);
  return r.rows[0].value;
}
async function equityOf(run: Run) {
  const r = await pool.query(`SELECT COALESCE(SUM(qty * COALESCE(last_price, entry_price)), 0) AS v FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL`, [run.run_id]);
  return Number(run.cash) + Number(r.rows[0].v);
}

// Live prices (and pool liquidity, for the price impact of a sale) from Jupiter, up to 50 tokens a call. A token Jupiter
// doesn't price is left out: unknown, never guessed.
export async function fastPrices(fetchJson: (url: string) => Promise<any>, mints: string[]) {
  const out = new Map<string, { price: number; liq: number | null; source?: string }>();
  for (let i = 0; i < mints.length; i += 50) {
    const data = await fetchJson(jupPrice() + mints.slice(i, i + 50).join(","));
    for (const m of mints.slice(i, i + 50)) {
      const p = Number(data?.[m]?.usdPrice), l = Number(data?.[m]?.liquidity), source = data?.[m]?.source === "dexscreener" ? "dexscreener" : "jupiter";
      // DexScreener's liquidity is one pool's, Jupiter's is all of them. Compared with the buy's Jupiter number it looks like
      // a pull when nothing moved, so it is left out and that look's pull check is skipped.
      if (Number.isFinite(p) && p > 0) out.set(m, { price: p, liq: source === "jupiter" && Number.isFinite(l) && l > 0 ? l : null, source });
    }
  }
  return out;
}

// Called by the main tick for every coin that passed FILTER (before the ANALYST's score, which this lane ignores).
export async function fastBuy(c: Candidate, facts: Record<string, unknown>, fetchJson: (url: string) => Promise<any>, nowMs: number) {
  if (isRetired("fast")) return { bought: false, why: "retired" };
  const run = await currentFast();
  if (!run) return { bought: false, why: "no fast run" };
  const verdict = facts.verdict as string | null;
  if (!verdict || verdict === FAST.skipVerdict) {
    await log(run.run_id, "FAST", "skip", `${c.symbol}: passed the desk's safety rules, but Pulse says ${verdict ?? "nothing"}; the fast lane only buys coins Pulse doesn't call AVOID.`, { mint: c.mint, symbol: c.symbol });
    return { bought: false, why: "verdict" };
  }
  if ((await pool.query(`SELECT 1 FROM desk_positions WHERE run_id = $1 AND mint = $2`, [run.run_id, c.mint])).rowCount) return { bought: false, why: "already traded" };
  // The live price at the moment of the buy if Jupiter has one; GeckoTerminal's (up to a minute old) if not.
  let live: { price: number; liq: number | null; source?: string } | undefined;
  try { live = (await fastPrices(fetchJson, [c.mint])).get(c.mint); } catch {}
  // Only at a live Jupiter price: GeckoTerminal's can be minutes old (see ladder.ts, MARTIN).
  if (!live) { await log(run.run_id, "FAST", "skip", `${c.symbol}: no live Jupiter price; not bought at GeckoTerminal's (can be minutes old).`, { mint: c.mint, symbol: c.symbol }); return { bought: false, why: "no live price" }; }
  const at = { ...c, priceUsd: live.price, liquidityUsd: live.liq ?? c.liquidityUsd };
  const plan = executorPlan(at, await equityOf(run), Number(run.cash));
  if (!plan.ok) { await log(run.run_id, "FAST", "skip", `${c.symbol}: ${plan.reason}.`, { mint: c.mint, symbol: c.symbol }); return { bought: false, why: plan.reason }; }
  await pool.query(`INSERT INTO desk_positions (run_id, mint, symbol, pool, opened_at, entry_price, size_usd, qty, peak_price, last_price, last_liq, entry_detail)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$9,$10,$11)`,
    [run.run_id, c.mint, c.symbol, c.pool, new Date(nowMs).toISOString(), plan.fill, plan.size, plan.qty, at.priceUsd, at.liquidityUsd, JSON.stringify({ candidate: c, filter: facts, price_source: live.source ?? "jupiter" })]);
  await addCash(-plan.size);
  await log(run.run_id, "FAST", "buy", `Paper buy ${c.symbol}: $${plan.size.toFixed(2)} (8% of the lane) at $${plan.fill.toPrecision(6)} incl. fee and ${(plan.impact * 100).toFixed(2)}% impact. Pulse: ${verdict}. Sells at +${FAST.takeProfitPct * 100}%, -${FAST.stopPct * 100}% or after ${FAST.maxMinutes} min.`,
    { mint: c.mint, symbol: c.symbol, detail: { ...plan, verdict, price_source: live.source ?? "jupiter" } });
  return { bought: true };
}

// What to do with an open fast-lane position at the latest price.
export function fastDecision(p: { entry_price: number; opened_at: string | Date }, price: number, nowMs: number) {
  const up = price / p.entry_price - 1, mins = (nowMs - new Date(p.opened_at).getTime()) / 60_000;
  if (up >= FAST.takeProfitPct) return { exit: true, reason: `take profit: +${(up * 100).toFixed(1)}%` };
  if (up <= -FAST.stopPct) return { exit: true, reason: `stop-loss: ${(up * 100).toFixed(1)}%` };
  if (mins >= FAST.maxMinutes) return { exit: true, reason: `time limit: ${Math.floor(mins)} min, ${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}%` };
  return { exit: false, reason: "holding" };
}

// One look at every open fast-lane position.
export async function fastCheck(fetchJson: (url: string) => Promise<any>, nowMs: number) {
  const run = await currentFast();
  if (!run) return { open: 0, exits: 0 };
  const open = (await pool.query(`SELECT * FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY id`, [run.run_id])).rows;
  if (!open.length) return { open: 0, exits: 0 };
  let prices = new Map<string, { price: number; liq: number | null }>();
  // No answer from any price source says nothing about these coins, so it doesn't count toward a write-off.
  try { prices = await fastPrices(fetchJson, open.map((p: any) => p.mint)); } catch { return { open: open.length, exits: 0 }; }
  let exits = 0;
  for (const p of open) {
    const now = prices.get(p.mint);
    if (!now) {
      if ((p.misses + 1) * FAST.checkSeconds < FAST.writeOffMinutes * 60) { await pool.query(`UPDATE desk_positions SET misses = misses + 1 WHERE id = $1`, [p.id]); continue; }
      const reason = `no price for ${FAST.writeOffMinutes} min: written off`;
      const gone = await pool.query(`UPDATE desk_positions SET closed_at = $2, exit_price = 0, proceeds_usd = 0, exit_reason = $3, misses = misses + 1 WHERE id = $1 AND closed_at IS NULL`, [p.id, new Date(nowMs).toISOString(), reason]);
      if (gone.rowCount) { exits++; await log(run.run_id, "FAST", "exit", `${p.symbol}: ${reason}. In $${Number(p.size_usd).toFixed(2)}, out $0.00, -100.0%.`, { mint: p.mint, symbol: p.symbol }); }
      continue;
    }
    const d = fastDecision(p, now.price, nowMs);
    if (!d.exit) {
      await pool.query(`UPDATE desk_positions SET last_price = $2, last_liq = COALESCE($3, last_liq), peak_price = GREATEST(peak_price, $2), misses = 0 WHERE id = $1`, [p.id, now.price, now.liq]);
      continue;
    }
    // Claim the row first, so two watchers can never sell the same position twice.
    const fill = exitFill(now.price, p.qty * p.entry_price, now.liq ?? p.last_liq), proceeds = Math.max(0, p.qty * fill);
    const done = await pool.query(`UPDATE desk_positions SET closed_at = $2, exit_price = $3, proceeds_usd = $4, exit_reason = $5, last_price = $6, peak_price = GREATEST(peak_price, $6)
      WHERE id = $1 AND closed_at IS NULL`, [p.id, new Date(nowMs).toISOString(), fill, proceeds, d.reason, now.price]);
    if (!done.rowCount) continue;
    await addCash(proceeds); exits++;
    await log(run.run_id, "FAST", "exit", `${p.symbol}: ${d.reason}. Sold for $${proceeds.toFixed(2)} after fee and impact: in $${Number(p.size_usd).toFixed(2)}, out $${proceeds.toFixed(2)}, ${((proceeds / p.size_usd - 1) * 100).toFixed(1)}%.`,
      { mint: p.mint, symbol: p.symbol, detail: { price: now.price, fill } });
  }
  return { open: open.length, exits };
}

// The price watcher: inside each one-minute tick, looks every 10 seconds until `forMs` has passed, then records the lane's
// equity. Runs next to the main tick (its own lock), so a slow safety check never delays a fast-lane sale.
const LOCK = 7_331_002;
export async function fastWatch(fetchJson: (url: string) => Promise<any>, now: () => number, forMs: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const got = await pool.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
  if (!got.rows[0]?.ok) return { skipped: "another price watcher is running" };
  try {
    const t0 = now(), out = { checks: 0, exits: 0, errors: [] as string[] };
    for (;;) {
      try { const r = await fastCheck(fetchJson, now()); out.checks++; out.exits += r.exits; }
      catch (e: any) { out.errors.push(String(e?.message ?? e).slice(0, 100)); }
      if (now() - t0 + FAST.checkSeconds * 1000 > forMs) break;
      await sleep(FAST.checkSeconds * 1000);
    }
    const run = await currentFast();
    if (run) await pool.query(`INSERT INTO desk_equity (run_id, cash, equity) VALUES ($1,$2,$3)`, [run.run_id, run.cash, await equityOf(run)]);
    return out;
  } finally { await pool.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
}

// What the desk page shows for the lane.
export async function fastState() {
  const run = await currentFast();
  if (!run) return null;
  const id = run.run_id;
  const [open, closed, events, curve] = await Promise.all([
    pool.query(`SELECT symbol, mint, pool, opened_at, entry_price, size_usd, qty, peak_price, last_price FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY opened_at`, [id]),
    pool.query(`SELECT symbol, mint, pool, opened_at, closed_at, entry_price, exit_price, size_usd, proceeds_usd, exit_reason FROM desk_positions WHERE run_id = $1 AND closed_at IS NOT NULL ORDER BY closed_at DESC`, [id]),
    pool.query(`SELECT at, agent, action, symbol, reason FROM desk_events WHERE run_id = $1 ORDER BY id DESC LIMIT 12`, [id]),
    pool.query(`SELECT at, equity FROM desk_equity WHERE run_id = $1 ORDER BY at`, [id]),
  ]);
  const positions = open.rows.map((p: any) => {
    const value = p.qty * (p.last_price ?? p.entry_price);
    return { ...p, value, pnl_pct: ((p.last_price ?? p.entry_price) / p.entry_price - 1) * 100, minutes: (Date.now() - new Date(p.opened_at).getTime()) / 60_000 };
  });
  const equity = Number(run.cash) + positions.reduce((t: number, p: any) => t + p.value, 0);
  const trades = closed.rows.map((t: any) => ({ ...t, pnl_pct: (t.proceeds_usd / t.size_usd - 1) * 100 }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pts = curve.rows, step = Math.max(1, Math.ceil(pts.length / 240));
  return {
    run_id: id, started_at: run.started_at, start_balance: run.start_balance, cash: Number(run.cash), equity, return_pct: (equity / run.start_balance - 1) * 100,
    rules: { ...FAST, positionPct: RULES.positionPct }, positions, recent_trades: trades.slice(0, 12), activity: events.rows,
    trades_closed: trades.length, goal_trades: 50, wins: trades.filter((t: any) => t.pnl_pct > 0).length, avg_trade_pct: avg(trades.map((t: any) => t.pnl_pct)),
    exits: Object.fromEntries(["take profit", "stop-loss", "time limit", "no price"].map((k) => [k, trades.filter((t: any) => String(t.exit_reason).startsWith(k)).length])),
    equity_curve: pts.filter((_: any, i: number) => i % step === 0 || i === pts.length - 1).map((p: any) => [p.at, Number(p.equity)]),
  };
}
