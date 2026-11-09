// The LADDER LANE (paper, started 2026-11-03): a third desk with its own $1,000, Tim's strategy: "buy every coin with a
// goal of 10x, laddered 5 times", "anything over $1,000 volume, unless it's AVOID", "upon first sell-off tighten the
// trailing stop to 6%", "open trades checked every ten seconds".
//
// Rules:
//   BUY   every coin the scout sees with $1,000+ traded in the last hour (Pump.fun bonding-curve coins included) unless
//         Solana Pulse says AVOID or can't check it (unknown = no buy). $10 each (1% of the start), once per coin.
//         Pulse checks at most LADDER.checksPerTick new coins a minute, busiest first: each check costs Pulse RPC calls.
//   SELL  (Tim, 2026-11-03 17:30 UTC) 20% of the starting amount at +2%, then 20% more at each of 4x, 6x, 8x and 10x
//         (the last step sells what's left).
//         At every look (every 10 s), before anything else: liquidity 20% below the buy's sells everything (the pull sign
//         that got the main desk out of AODF; Tim: "definitely if liquidity is pulled").
//         Stop-loss: -4% from the entry sells everything, until the trail is on.
//         Trailing stop, tighter as the high climbs: from +2% (the first sale) 1% below the highest price, from +5% 0.6%
//         below it, from +7% 0.3% below it. After 24 hours everything is sold.
//         A coin with no price for 30 minutes is written off at 0.
// LADDER B (Tim 2026-11-03, "add the new ladder bot" + "5% sell-offs every 5%"): the same coins, bought at the same moment,
// so the two compare on equal terms: -4% stop; 5% of the starting amount sold at each of +5%, +10%, +15%, +20% (20% in
// all); from +1% the stop moves to break-even (+0.5%, above the fees) so it can't become a loss; a 3.5% trail from +5%
// and 7% from +10% (wider as the gain grows, so a runner like USOE, +135% under the old 6% trail, isn't sold at +7%
// by a 0.3% trail).
// What to expect (research, 2026-11-03): of the 25 coins the desk bought on Nov 1-3, none reached 5x after the buy and
// 4 reached 2x. This lane measures the strategy; it isn't expected to be profitable.
// Same paper fills as the other lanes (swap fee plus price impact). Paper trading only: nothing here signs anything.
import { pool } from "../db";
import { exitFill, RULES, type Candidate } from "./agents";
import { fastPrices } from "./fast";
import { log, type Run } from "./store";
import { isRetired } from "./retired";

export const LADDER = {
  sizeUsd: 10,
  minVolumeH1Usd: 1_000,
  steps: [0.02, 3, 5, 7, 9], // +2%, then +300% (4x), +500% (6x), +700% (8x), +900% (10x)
  stepShare: 0.2, // of the starting amount, at each step
  stopPct: 0.04, // -4% from the entry, before the trail is on
  // The trailing stop by the highest price reached: from +2% it sits 1% below the high, from +5% 0.6%, from +7% 0.3%.
  trails: [{ fromPct: 0.07, gapPct: 0.003 }, { fromPct: 0.05, gapPct: 0.006 }, { fromPct: 0.02, gapPct: 0.01 }],
  breakEven: null as null | { fromPct: number; floorPct: number },
  lastStepSellsAll: true, // A: the 10x step sells what's left
  pullLiqDropPct: 0.2, // before the first step: liquidity 20% below the buy's
  maxHours: 24,
  writeOffMinutes: 30, // no price this long: written off at 0
  checkSeconds: 10,
  checksPerTick: 2,
  skipVerdict: "AVOID",
  // Cost on top of the desk's swap fee and price impact, per side (0 for the ladders; WAIT-5 charges Gemini's estimate
  // for young PumpSwap/Meteora pools: pool fees up to 1.25-4%, plus slippage, about 2.2% a side in all).
  extraCostPct: 0,
};
// The two ladder bots: same buys, different exits. A = Tim's rules (LADDER); B = break-even plus a widening trail.
export type Variant = { id: "ladder" | "ladderB" | "momo" | "copy"; key: string; agent: string; rules: typeof LADDER };
export const LADDER_A: Variant = { id: "ladder", key: "ladder_run", agent: "LADDER", rules: LADDER };
export const LADDER_B: Variant = {
  id: "ladderB", key: "ladderB_run", agent: "LADDER B",
  // Tim 2026-11-03: "5% sell-offs every 5%": 5% of the starting amount at +5%, +10%, +15% and +20% (20% in all).
  // "As soon as you can make it break-even do that": once the price has been +1% (enough to cover the ~0.5% of fees
  // there and back), the stop moves to +0.5%. "A 3.5% trail after 5 and a 7 after 10": 3.5% below the high from +5%,
  // 7% below it from +10%. The higher of the break-even stop and the trail is the one that counts.
  rules: { ...LADDER, steps: [0.05, 0.1, 0.15, 0.2], stepShare: 0.05, lastStepSellsAll: false,
    trails: [{ fromPct: 0.1, gapPct: 0.07 }, { fromPct: 0.05, gapPct: 0.035 }], breakEven: { fromPct: 0.01, floorPct: 0.005 } },
};
// The WAIT-5 lane (paper; buys decided in momo.ts). Exits changed 2026-11-09 (Tim: "better exits for losing trades"):
// it was 2x / -40% / 30 min with no liquidity exit, and 13 of its 23 trades were pools pulled to $0 (written off at -100%)
// with stops filling at -43% to -96%. Now: everything at +20%, -6% stop, sell all if liquidity falls 20% below the buy's,
// 10 h limit. On 1,023 WAIT-5 buys in the 23k backtest (corrected replay, 2.2%/side, research/2026-11-09-new-strategies/
// wait5_exits.py) +20%/-6%/10 h averaged -9.7% a trade (older -9.5%, newer -10.0%) against -22.3% for the old exits,
// and trades losing 90%+ fell from 44% to 9%. Still a loss: it loses slower, it does not make money.
export const MOMO_LANE: Variant = {
  id: "momo", key: "momo_run", agent: "WAIT-5",
  rules: { ...LADDER, steps: [0.2], stepShare: 1, lastStepSellsAll: true, stopPct: 0.06, trails: [], breakEven: null,
    maxHours: 10, pullLiqDropPct: 0.2, writeOffMinutes: 30, extraCostPct: 0.0195 },
};
// The REAL WALLET COPY (paper, Tim 2026-11-07; buys decided in walletCopy.ts): the lottery lane's exits on paper. Half at
// +100%, -40% before that, then a 40% trail, 24 hours at most. Never tuned, like the real wallet it copies.
export const COPY_LANE: Variant = {
  id: "copy", key: "copy_run", agent: "WALLET COPY",
  rules: { ...LADDER, steps: [1.0], stepShare: 0.5, lastStepSellsAll: false, stopPct: 0.4, trails: [{ fromPct: 1.0, gapPct: 0.4 }], breakEven: null,
    maxHours: 24, pullLiqDropPct: 1.01 /* over 100%: never fires; the real wallet has no liquidity exit */, writeOffMinutes: 30, extraCostPct: 0.0195 },
};
export const VARIANTS = [LADDER_A, LADDER_B, MOMO_LANE, COPY_LANE];

export async function currentLadder(v: Variant = LADDER_A): Promise<Run | null> {
  const r = await pool.query(`SELECT value FROM desk_state WHERE key = $1`, [v.key]);
  return r.rows[0]?.value ?? null;
}
export async function startLadder(balance = 1000, v: Variant = LADDER_A): Promise<Run> {
  const at = new Date().toISOString();
  const run: Run = { run_id: `${v.id}-${at.replace(/[:.]/g, "-")}`, mode: "paper", started_at: at, start_balance: balance, cash: balance };
  await pool.query(`INSERT INTO desk_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v.key, JSON.stringify(run)]);
  return run;
}
async function addCash(delta: number, v: Variant): Promise<Run> {
  const r = await pool.query(`UPDATE desk_state SET value = jsonb_set(value, '{cash}', to_jsonb((value->>'cash')::float8 + $2::float8)) WHERE key = $1 RETURNING value`, [v.key, delta]);
  return r.rows[0].value;
}

// One paper buy of a coin for one ladder bot.
export async function buyInto(v: Variant, c: Candidate, verdict: string, live: { price: number; liq: number | null; source?: string } | undefined, nowMs: number) {
  if (isRetired(v.id)) return false; // retired.ts: no new buys, open positions still exit
  const run = (await currentLadder(v)) ?? (await startLadder(1000, v));
  // Paper buys only at a live Jupiter price. GeckoTerminal's can be a minute or more old: MARTIN (2026-11-03 18:40) was
  // "bought" at its 18:39 price after it had already fallen 70%, and the next look recorded a -64% "loss" that a real
  // buy could never have had.
  if (!live) { await log(run.run_id, v.agent, "skip", `${c.symbol}: no live Jupiter price; not bought at GeckoTerminal's (can be minutes old).`, { mint: c.mint, symbol: c.symbol }); return false; }
  const price = live.price, liq = live.liq ?? c.liquidityUsd!;
  const cash = Number(run.cash), size = Math.min(LADDER.sizeUsd, cash);
  if (size < 1) { await log(run.run_id, v.agent, "skip", `${c.symbol}: out of cash ($${cash.toFixed(2)}).`, { mint: c.mint, symbol: c.symbol }); return false; }
  if ((await pool.query(`SELECT 1 FROM desk_positions WHERE run_id = $1 AND mint = $2`, [run.run_id, c.mint])).rowCount) return false;
  const impact = size / liq, fill = price * (1 + RULES.feePct + impact + (v.rules.extraCostPct ?? 0));
  await pool.query(`INSERT INTO desk_positions (run_id, mint, symbol, pool, opened_at, entry_price, size_usd, qty, peak_price, last_price, last_liq, entry_detail, ladder)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$9,$10,$11,$12)`,
    [run.run_id, c.mint, c.symbol, c.pool, new Date(nowMs).toISOString(), fill, size, size / fill, price, liq,
      JSON.stringify({ candidate: c, verdict, liq0: live.liq ?? null, price_source: live.source ?? "jupiter" }), JSON.stringify(v.rules.steps)]);
  await addCash(-size, v);
  await log(run.run_id, v.agent, "buy", `Paper buy ${c.symbol}: $${size.toFixed(2)} at $${fill.toPrecision(6)} incl. fee and ${(impact * 100).toFixed(2)}% impact. Pulse: ${verdict}. $${Math.round(c.volumeH1Usd ?? 0).toLocaleString("en-US")} 1h volume${c.dex === "pump-fun" ? ", still on the Pump.fun curve" : ""}. ${describeExits(v.rules)}`,
    { mint: c.mint, symbol: c.symbol, detail: { fill, size, impact, verdict } });
  return true;
}
const pc = (f: number) => `${+(f * 100).toFixed(2)}%`;
export const describeExits = (r: typeof LADDER) =>
  `Sells ${pc(r.stepShare)} at ${r.steps.slice(0, 4).map((x) => (x < 1 ? `+${pc(x)}` : `${x + 1}x`)).join(", ")}${r.breakEven ? `, then the stop moves to break-even (+${pc(r.breakEven.floorPct)})` : ""}; trail ${[...r.trails].reverse().map((t) => `${pc(t.gapPct)} from +${pc(t.fromPct)}`).join(", ")}.`;

// Called by the main tick with everything the scout found this minute. Pulse checks run side by side.
// onPass: also told about every coin Pulse didn't call AVOID (the REAL lottery lane buys from the same checks, so Pulse
// is asked once per coin).
export async function ladderScan(candidates: Candidate[], safety: ((mint: string) => Promise<any>) | undefined, fetchJson: (url: string) => Promise<any>, nowMs: number,
  onPass?: (c: Candidate, verdict: string) => Promise<unknown>) {
  if (!safety) return { bought: 0, checked: 0 };
  const run = (await currentLadder()) ?? (await startLadder());
  const id = run.run_id; // bot A keeps the list of coins already checked; bot B buys the same coins
  const done = new Set((await pool.query(`SELECT mint FROM desk_tokens WHERE run_id = $1`, [id])).rows.map((r: any) => r.mint));
  const queue = candidates
    .filter((c) => !done.has(c.mint) && (c.volumeH1Usd ?? 0) >= LADDER.minVolumeH1Usd && c.priceUsd && c.liquidityUsd)
    .sort((a, b) => (b.volumeH1Usd ?? 0) - (a.volumeH1Usd ?? 0))
    .slice(0, LADDER.checksPerTick);
  const verdicts = await Promise.all(queue.map((c) => safety(c.mint).then((s) => (s?.verdict as string) ?? null).catch(() => null)));
  let bought = 0;
  for (const [i, c] of queue.entries()) {
    const verdict = verdicts[i];
    const mark = (status: string, reason: string) => pool.query(`INSERT INTO desk_tokens (run_id, mint, symbol, pool, status, reason) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (run_id, mint) DO NOTHING`, [id, c.mint, c.symbol, c.pool, status, reason]);
    if (!verdict || verdict === LADDER.skipVerdict) {
      await mark("rejected", verdict ? "Pulse AVOID" : "Pulse couldn't check it");
      await log(id, "LADDER", "skip", `${c.symbol}: ${verdict ? "Pulse says AVOID" : "Pulse couldn't check it (unknown = no buy)"}.`, { mint: c.mint, symbol: c.symbol });
      continue;
    }
    if (onPass) await onPass(c, verdict).catch(() => null);
    let live: { price: number; liq: number | null } | undefined;
    try { live = (await fastPrices(fetchJson, [c.mint])).get(c.mint); } catch {}
    await mark("traded", `Pulse ${verdict}`);
    if (await buyInto(LADDER_A, c, verdict, live, nowMs)) bought++;
    await buyInto(LADDER_B, c, verdict, live, nowMs);
  }
  return { bought, checked: queue.length };
}

// The trail for the highest gain so far (0.08 = +8%), or null below the first tier (the -4% stop applies then).
export const trailFor = (peakGain: number, r: typeof LADDER = LADDER) => r.trails.find((t) => peakGain >= t.fromPct - 1e-12) ?? null;

type Pos = { entry_price: number; size_usd: number; qty: number; peak_price: number; ladder_done: number; opened_at: string | Date; misses: number; liq0: number | null };
// What to do with an open position at the latest price and liquidity (null = Jupiter had none this look).
export function ladderDecision(p: Pos, price: number | null, liq: number | null, nowMs: number, R: typeof LADDER = LADDER) {
  const LADDER = R;
  const mins = (nowMs - new Date(p.opened_at).getTime()) / 60_000;
  if (price === null) return (p.misses + 1) * LADDER.checkSeconds >= LADDER.writeOffMinutes * 60 ? { sell: "writeoff" as const, reason: `no price for ${LADDER.writeOffMinutes} min: written off` } : { sell: "none" as const, reason: "no price this look" };
  const x = price / p.entry_price, peak = Math.max(p.peak_price, price);
  // Tim: "definitely if liquidity is pulled". Checked first, at every look, before or after a step: a pulled pool's
  // price is meaningless, so no step may sell at it.
  if (p.liq0 && liq !== null && liq <= p.liq0 * (1 - LADDER.pullLiqDropPct)) return { sell: "all" as const, reason: `liquidity pulled: down ${Math.round((1 - liq / p.liq0) * 100)}% since the buy, ${((x - 1) * 100).toFixed(1)}%` };
  let steps = 0;
  for (let i = p.ladder_done; i < LADDER.steps.length && price >= p.entry_price * (1 + LADDER.steps[i]); i++) steps++;
  if (steps) return { sell: "steps" as const, steps, reason: R.lastStepSellsAll && p.ladder_done + steps >= LADDER.steps.length ? `10x reached (${x.toFixed(2)}x): last step` : `${x.toFixed(2)}x: step ${p.ladder_done + steps} of ${LADDER.steps.length}` };
  const gain = peak / p.entry_price - 1, trail = trailFor(gain, R);
  const trailStop = trail ? peak * (1 - trail.gapPct) : null;
  const beStop = R.breakEven && gain >= R.breakEven.fromPct - 1e-12 ? p.entry_price * (1 + R.breakEven.floorPct) : null;
  if (trailStop === null && beStop === null && price <= p.entry_price * (1 - LADDER.stopPct)) return { sell: "all" as const, reason: `stop-loss: ${((x - 1) * 100).toFixed(1)}%` };
  if (trailStop !== null && price <= trailStop && (beStop === null || trailStop >= beStop)) return { sell: "all" as const, reason: `trailing stop: ${((price / peak - 1) * 100).toFixed(1)}% from the high (${(peak / p.entry_price).toFixed(2)}x at best)` };
  if (beStop !== null && price <= beStop) return { sell: "all" as const, reason: `break-even stop: ${((x - 1) * 100).toFixed(1)}% (${(peak / p.entry_price).toFixed(2)}x at best)` };
  if (mins >= LADDER.maxHours * 60) return { sell: "all" as const, reason: `time limit: ${LADDER.maxHours} h, ${((x - 1) * 100).toFixed(1)}%` };
  return { sell: "none" as const, reason: "holding" };
}

// One look at every open ladder position.
export async function ladderCheck(fetchJson: (url: string) => Promise<any>, nowMs: number, v: Variant = LADDER_A) {
  const LADDER = v.rules;
  const run = await currentLadder(v);
  if (!run) return { open: 0, sales: 0 };
  const open = (await pool.query(`SELECT * FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY id`, [run.run_id])).rows;
  if (!open.length) return { open: 0, sales: 0 };
  let prices = new Map<string, { price: number; liq: number | null }>();
  // No answer from any price source says nothing about these coins, so it doesn't count toward a write-off.
  try { prices = await fastPrices(fetchJson, open.map((p: any) => p.mint)); } catch { return { open: open.length, sales: 0 }; }
  let sales = 0;
  for (const p of open) {
    const now = prices.get(p.mint) ?? null;
    // The pull check compares Jupiter's liquidity with Jupiter's (GeckoTerminal measures one pool, Jupiter all of them):
    // when the buy had no Jupiter number, the first one seen becomes the reference.
    if (p.entry_detail?.liq0 == null && now?.liq) {
      await pool.query(`UPDATE desk_positions SET entry_detail = jsonb_set(COALESCE(entry_detail, '{}'::jsonb), '{liq0}', to_jsonb($2::float8)) WHERE id = $1`, [p.id, now.liq]);
      p.entry_detail = { ...(p.entry_detail ?? {}), liq0: now.liq };
    }
    const d = ladderDecision({ ...p, liq0: p.entry_detail?.liq0 ?? null }, now?.price ?? null, now?.liq ?? null, nowMs, v.rules);
    if (!now) await pool.query(`UPDATE desk_positions SET misses = misses + 1 WHERE id = $1`, [p.id]);
    else await pool.query(`UPDATE desk_positions SET last_price = $2, last_liq = COALESCE($3, last_liq), peak_price = GREATEST(peak_price, $2), misses = 0 WHERE id = $1`, [p.id, now.price, now.liq]);
    if (d.sell === "none") continue;
    const start = p.size_usd / p.entry_price;
    let qty = d.sell === "steps" ? Math.min(p.qty, start * LADDER.stepShare * d.steps!) : p.qty;
    const doneAfter = d.sell === "steps" ? p.ladder_done + d.steps! : p.ladder_done;
    if (d.sell === "steps" && LADDER.lastStepSellsAll && doneAfter >= LADDER.steps.length) qty = p.qty; // A's 10x step sells what's left
    const fill = d.sell === "writeoff" ? 0 : exitFill(now!.price, qty * p.entry_price, now!.liq ?? p.last_liq) * (1 - (LADDER.extraCostPct ?? 0)), got = Math.max(0, qty * fill);
    const closing = qty >= p.qty - 1e-12;
    // Claim the row (ladder_done / closed_at unchanged since we read it), so two watchers can't sell the same shares.
    const done = closing
      ? await pool.query(`UPDATE desk_positions SET qty = 0, ladder_done = $3, realized_usd = realized_usd + $4, closed_at = $5, exit_price = $6, proceeds_usd = realized_usd + $4, exit_reason = $7
          WHERE id = $1 AND closed_at IS NULL AND ladder_done = $2`, [p.id, p.ladder_done, doneAfter, got, new Date(nowMs).toISOString(), fill, d.reason])
      : await pool.query(`UPDATE desk_positions SET qty = qty - $3, ladder_done = $4, realized_usd = realized_usd + $5 WHERE id = $1 AND closed_at IS NULL AND ladder_done = $2`,
          [p.id, p.ladder_done, qty, doneAfter, got]);
    if (!done.rowCount) continue;
    await addCash(got, v); sales++;
    const total = Number(p.realized_usd) + got;
    await log(run.run_id, v.agent, closing ? "exit" : "step", `${p.symbol}: ${d.reason}. Sold ${closing ? "the rest" : `${Math.round((qty / start) * 100)}%`} for $${got.toFixed(2)}.${closing ? ` In $${Number(p.size_usd).toFixed(2)}, out $${total.toFixed(2)}, ${((total / p.size_usd - 1) * 100).toFixed(1)}%.` : ""}`,
      { mint: p.mint, symbol: p.symbol, detail: { price: now?.price ?? null, fill } });
  }
  return { open: open.length, sales };
}

// The price watcher: every 10 seconds for forMs inside each one-minute tick, then an equity point. Own lock.
const LOCK = 7_331_004;
export async function ladderWatch(fetchJson: (url: string) => Promise<any>, now: () => number, forMs: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const got = await pool.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
  if (!got.rows[0]?.ok) return { skipped: "another ladder watcher is running" };
  try {
    const t0 = now(), out = { checks: 0, sales: 0, errors: [] as string[] };
    for (;;) {
      for (const v of VARIANTS) {
        try { const r = await ladderCheck(fetchJson, now(), v); out.sales += r.sales; }
        catch (e: any) { out.errors.push(`${v.id}: ${String(e?.message ?? e).slice(0, 100)}`); }
      }
      out.checks++;
      if (now() - t0 + LADDER.checkSeconds * 1000 > forMs) break;
      await sleep(LADDER.checkSeconds * 1000);
    }
    for (const vr of VARIANTS) {
      const run = await currentLadder(vr);
      if (!run) continue;
      const v = await pool.query(`SELECT COALESCE(SUM(qty * COALESCE(last_price, entry_price)), 0) AS v FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL`, [run.run_id]);
      await pool.query(`INSERT INTO desk_equity (run_id, cash, equity) VALUES ($1,$2,$3)`, [run.run_id, run.cash, Number(run.cash) + Number(v.rows[0].v)]);
    }
    return out;
  } finally { await pool.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
}

// What the desk page shows for the lane: the same numbers as the fast lane's card.
export async function ladderState(v: Variant = LADDER_A) {
  const LADDER = v.rules;
  const run = await currentLadder(v);
  if (!run) return null;
  const id = run.run_id;
  const [open, closed, events, curve, seen] = await Promise.all([
    pool.query(`SELECT symbol, mint, pool, opened_at, entry_price, size_usd, qty, peak_price, last_price, ladder_done, realized_usd FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY opened_at`, [id]),
    pool.query(`SELECT symbol, mint, pool, opened_at, closed_at, entry_price, exit_price, size_usd, proceeds_usd, exit_reason, ladder_done FROM desk_positions WHERE run_id = $1 AND closed_at IS NOT NULL ORDER BY closed_at DESC`, [id]),
    pool.query(`SELECT at, agent, action, symbol, reason FROM desk_events WHERE run_id = $1 ORDER BY id DESC LIMIT 12`, [id]),
    pool.query(`SELECT at, equity FROM desk_equity WHERE run_id = $1 ORDER BY at`, [id]),
    pool.query(`SELECT status, COUNT(*)::int AS n FROM desk_tokens WHERE run_id = $1 GROUP BY 1`, [id]),
  ]);
  const positions = open.rows.map((p: any) => {
    const px = p.last_price ?? p.entry_price, value = p.qty * px;
    return { ...p, value, x: px / p.entry_price, pnl_pct: ((value + Number(p.realized_usd)) / p.size_usd - 1) * 100, minutes: (Date.now() - new Date(p.opened_at).getTime()) / 60_000 };
  });
  const equity = Number(run.cash) + positions.reduce((t: number, p: any) => t + p.value, 0);
  const trades = closed.rows.map((t: any) => ({ ...t, pnl_pct: (t.proceeds_usd / t.size_usd - 1) * 100 }));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pts = curve.rows, step = Math.max(1, Math.ceil(pts.length / 240));
  const all = [...positions, ...trades];
  return {
    run_id: id, started_at: run.started_at, start_balance: run.start_balance, cash: Number(run.cash), equity, return_pct: (equity / run.start_balance - 1) * 100,
    rules: LADDER, positions, recent_trades: trades.slice(0, 12), activity: events.rows,
    trades_closed: trades.length, wins: trades.filter((t: any) => t.pnl_pct > 0).length, avg_trade_pct: avg(trades.map((t: any) => t.pnl_pct)),
    reached: Object.fromEntries(LADDER.steps.map((s, i) => [s < 1 ? `+${s * 100}%` : `${s + 1}x`, all.filter((p: any) => p.ladder_done > i).length])),
    exits: Object.fromEntries(["liquidity pulled", "stop-loss", "break-even stop", "trailing stop", "time limit", "no price", "10x reached"].map((k) => [k, trades.filter((t: any) => String(t.exit_reason).includes(k)).length])),
    coins_checked: Object.fromEntries(seen.rows.map((r: any) => [r.status, r.n])),
    equity_curve: pts.filter((_: any, i: number) => i % step === 0 || i === pts.length - 1).map((p: any) => [p.at, Number(p.equity)]),
  };
}
