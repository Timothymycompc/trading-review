// What the live terminal shows (state) and the morning recap, both read straight from the desk tables.
import { pool } from "../db";
import { RULES } from "./agents";
import { currentRun, startRun } from "./store";
import { fastState, startFast } from "./fast";
import { COPY_LANE, LADDER_B, ladderState, MOMO_LANE, startLadder } from "./ladder";
import { applyTuning, resetTuning, tunerSummary } from "./tuner";
import { deskHealth } from "./health";

export async function deskState() {
  await applyTuning(); // the rules shown are the ones in force, tuned or not
  const run = await currentRun();
  if (!run) return { running: false };
  const id = run.run_id;
  const [open, closed, events, curve, counts] = await Promise.all([
    pool.query(`SELECT symbol, mint, pool, opened_at, entry_price, size_usd, qty, peak_price, last_price, trail_active, ladder, ladder_done, realized_usd FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY opened_at`, [id]),
    pool.query(`SELECT symbol, mint, pool, opened_at, closed_at, entry_price, exit_price, size_usd, proceeds_usd, exit_reason FROM desk_positions WHERE run_id = $1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 12`, [id]),
    pool.query(`SELECT at, agent, action, symbol, reason FROM desk_events WHERE run_id = $1 ORDER BY id DESC LIMIT 18`, [id]),
    pool.query(`SELECT at, equity FROM desk_equity WHERE run_id = $1 ORDER BY at`, [id]),
    pool.query(`SELECT agent, action, COUNT(*)::int AS n FROM desk_events WHERE run_id = $1 GROUP BY 1, 2`, [id]),
  ]);
  // value is what's still held (the ladder's sales are already cash); pnl_pct is the price move; total_pnl_pct counts both.
  const positions = open.rows.map((p: any) => {
    const value = p.qty * (p.last_price ?? p.entry_price);
    return { ...p, value, pnl_pct: ((p.last_price ?? p.entry_price) / p.entry_price - 1) * 100, total_pnl_pct: ((value + Number(p.realized_usd ?? 0)) / p.size_usd - 1) * 100 };
  });
  const equity = run.cash + positions.reduce((t: number, p: any) => t + p.value, 0);
  // At most ~240 points for the curve, evenly spaced.
  const pts = curve.rows, step = Math.max(1, Math.ceil(pts.length / 240));
  return {
    running: true, mode: run.mode, run_id: id, started_at: run.started_at, start_balance: run.start_balance, cash: run.cash, equity,
    return_pct: (equity / run.start_balance - 1) * 100, rules: RULES, positions, recent_trades: closed.rows, activity: events.rows,
    equity_curve: pts.filter((_: any, i: number) => i % step === 0 || i === pts.length - 1).map((p: any) => [p.at, Number(p.equity)]),
    counts: counts.rows, fast: await fastState(), ladder: await ladderState(), ladderB: await ladderState(LADDER_B), momo: await ladderState(MOMO_LANE), copy: await ladderState(COPY_LANE), tuner: await tunerSummary(), health: await deskHealth(),
  };
}

export async function deskRecap() {
  const run = await currentRun();
  if (!run) return { running: false };
  const id = run.run_id;
  const state: any = await deskState();
  const trades = (await pool.query(`SELECT symbol, size_usd, proceeds_usd, exit_reason, opened_at, closed_at, score FROM desk_positions WHERE run_id = $1 AND closed_at IS NOT NULL ORDER BY closed_at`, [id])).rows
    .map((t: any) => ({ ...t, pnl: t.proceeds_usd - t.size_usd, pnl_pct: (t.proceeds_usd / t.size_usd - 1) * 100, minutes: (Date.parse(t.closed_at) - Date.parse(t.opened_at)) / 60000 }));
  const wins = trades.filter((t: any) => t.pnl > 0), losses = trades.filter((t: any) => t.pnl <= 0);
  const curve = (await pool.query(`SELECT equity FROM desk_equity WHERE run_id = $1 ORDER BY at`, [id])).rows.map((r: any) => Number(r.equity));
  let peak = run.start_balance, mdd = 0;
  for (const e of curve) { peak = Math.max(peak, e); mdd = Math.max(mdd, 1 - e / peak); }
  const rejects = (await pool.query(`SELECT reason FROM desk_events WHERE run_id = $1 AND action = 'reject'`, [id])).rows;
  const why = new Map<string, number>();
  for (const r of rejects) for (const part of String(r.reason).replace(/^[^:]*: /, "").split("; ")) {
    const key = part.replace(/\$[\d,.]+/g, "$X").replace(/[\d.]+%/g, "X%").replace(/\(.*\)/g, "").replace(/score [\d.]+/, "score X").trim().slice(0, 70);
    why.set(key, (why.get(key) ?? 0) + 1);
  }
  const tokens = (await pool.query(`SELECT status, COUNT(*)::int AS n FROM desk_tokens WHERE run_id = $1 GROUP BY 1`, [id])).rows;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    mode: run.mode, run_id: id, started_at: run.started_at, hours: (Date.now() - Date.parse(run.started_at)) / 3_600_000,
    start_balance: run.start_balance, equity: state.equity, return_pct: state.return_pct, max_drawdown_pct: mdd * 100,
    tokens_seen: tokens, trades_closed: trades.length, open_positions: state.positions,
    win_rate_pct: trades.length ? (wins.length / trades.length) * 100 : null,
    avg_win_pct: avg(wins.map((t: any) => t.pnl_pct)), avg_loss_pct: avg(losses.map((t: any) => t.pnl_pct)),
    best: trades.slice().sort((a: any, b: any) => b.pnl_pct - a.pnl_pct)[0] ?? null, worst: trades.slice().sort((a: any, b: any) => a.pnl_pct - b.pnl_pct)[0] ?? null,
    exits: Object.fromEntries(["stop-loss", "trailing stop"].map((k) => [k, trades.filter((t: any) => String(t.exit_reason).startsWith(k)).length])),
    rejection_reasons: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    trades,
  };
}

// A fresh start for every paper lane, each with the same balance, and every exit rule back to the one written in the code:
// a tuner's changes came from the old run's trades. Old runs stay in the tables. The real lottery wallet isn't touched.
export async function deskReset(balance?: number) {
  await resetTuning();
  const run = await startRun(balance);
  const fast = await startFast(balance);
  const ladder = await startLadder(balance);
  const ladderB = await startLadder(balance, LADDER_B);
  const momo = await startLadder(balance, MOMO_LANE);
  const copy = await startLadder(balance, COPY_LANE);
  return { started: run, fast, ladder, ladderB, momo, copy };
}
