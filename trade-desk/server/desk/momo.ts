// The WAIT-5 lane (paper, 2026-11-04): the first rule from the Claude x Gemini entry test (research/collab) to pass the
// hidden day. Rule, exactly as tested (scripts/entry-test.ts, delayed(), wait 5 + GRID "g tp100 sl40 t30"):
//   wait 5 minutes after the scan; buy only if, in those 5 minutes, the coin never fell 20% below its scan price, is
//   within 10% of its high now, and traded $1,000+ in every one of the 5 minutes; then sell everything at 2x, at -40%,
//   or after 30 minutes.
// Replay results: the first replay said +14.2% a trade on the hidden day (Nov 3, 414 trades), but with Gemini's red-team
// fixes (time-limit sales at the next candle, not a stale price; 2x sales filled below a brief spike) it came to +0.9%
// at 1% cost a side and -2.1% at 2.2%: about break-even, not a proven edge. This lane MEASURES it live with Jupiter
// prices, $10 a coin from its own $1,000, the ladder lanes' 10-second watcher and paper fills charging ~2.2% a side.
// Gemini's stop rule: pause if, after 30 trades, the mean or the median is 0% or worse (momoStop, enforced since 2026-11-07).
// The replay was still too kind: it never wrote off a PumpSwap coin that went silent, while live, 6 of the first 11 trades
// ended that way at -100% (see LESSONS.md).
// Every coin the scout sees with $1,000+ 1h volume is queued (no Pulse filter: the test had none); 6 minutes after the
// scan its 1-minute candles (GeckoTerminal) are read once and the rule decides. Paper trading only.
import { pool } from "../db";
import type { Candidate } from "./agents";
import { fastPrices } from "./fast";
import { currentLadder, MOMO_LANE } from "./ladder";
export { MOMO_LANE } from "./ladder";
import { log } from "./store";

export const MOMO = { waitMin: 5, maxLowPct: -0.2, maxOffHighPct: -0.1, minMinuteUsd: 1000, minVolumeH1Usd: 1000, decidePerTick: 8, giveUpMin: 20, stopAfterTrades: 30 };

// The stop rule on the closed trades' results in percent. null = keep going.
export function momoStop(pcts: number[]) {
  if (pcts.length < MOMO.stopAfterTrades) return null;
  const s = [...pcts].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  const mean = s.reduce((t, x) => t + x, 0) / s.length, median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return mean <= 0 || median <= 0 ? { mean, median, trades: s.length } : null;
}
// Is the lane paused? Says so once in its activity feed. A reset starts a new run, and with it a new count.
export async function momoPaused() {
  const run = await currentLadder(MOMO_LANE);
  if (!run) return false;
  const rows = (await pool.query(`SELECT proceeds_usd / size_usd * 100 - 100 AS pct FROM desk_positions WHERE run_id = $1 AND closed_at IS NOT NULL`, [run.run_id])).rows;
  const stop = momoStop(rows.map((r: any) => Number(r.pct)));
  if (!stop) return false;
  const told = await pool.query(`SELECT 1 FROM desk_events WHERE run_id = $1 AND action = 'paused' LIMIT 1`, [run.run_id]);
  if (!told.rowCount) await log(run.run_id, MOMO_LANE.agent, "paused", `Paused by its stop rule: after ${stop.trades} trades the mean is ${stop.mean.toFixed(1)}% and the median ${stop.median.toFixed(1)}%. No more buys in this run.`);
  return true;
}

export async function ensureMomoSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS desk_momo_queue (mint TEXT PRIMARY KEY, pool TEXT NOT NULL, symbol TEXT, seen_at TIMESTAMPTZ NOT NULL,
    candidate JSONB, decided_at TIMESTAMPTZ, decision TEXT, detail JSONB)`);
}

// Queue every new coin the scout saw this minute (once per coin, ever).
export async function momoQueue(candidates: Candidate[], nowMs: number) {
  await ensureMomoSchema();
  let n = 0;
  for (const c of candidates) {
    if ((c.volumeH1Usd ?? 0) < MOMO.minVolumeH1Usd || !c.pool) continue;
    const r = await pool.query(`INSERT INTO desk_momo_queue (mint, pool, symbol, seen_at, candidate) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (mint) DO NOTHING`,
      [c.mint, c.pool, c.symbol, new Date(nowMs).toISOString(), JSON.stringify(c)]);
    n += r.rowCount ?? 0;
  }
  return n;
}

// The rule on the candles of one coin, exactly as in the entry test. cs = [t (minute start, s), o, h, l, c, volumeUsd].
export function momoRule(cs: number[][], atSec: number) {
  const before = cs.filter((x) => x[0] <= atSec), after = cs.filter((x) => x[0] > atSec);
  const tradedBefore = before.filter((x) => x[5] >= MOMO.minMinuteUsd).pop(), tradedAfter = after.find((x) => x[5] >= MOMO.minMinuteUsd);
  const scan = tradedBefore && atSec - tradedBefore[0] < 600 ? tradedBefore[4] : tradedAfter && tradedAfter[0] - atSec <= 60 ? tradedAfter[1] : NaN; // as in the replay: 60 s, never a price from later
  if (!(scan > 0)) return { pass: false, reason: "no traded price near the scan" };
  const tK = atSec + MOMO.waitMin * 60;
  const seen = cs.filter((x) => x[0] > atSec && x[0] <= tK), traded = seen.filter((x) => x[5] >= MOMO.minMinuteUsd);
  const last = traded[traded.length - 1];
  if (!last || tK - last[0] > 300) return { pass: false, reason: "no traded minute in the last 5 minutes" };
  const highs = traded.map((x) => x[2]).filter((h) => h < scan * 20);
  const hi = Math.max(scan, ...highs), lo = Math.min(scan, ...traded.map((x) => x[3]));
  const f = { low_since_scan: lo / scan - 1, off_high: last[4] / hi - 1, traded_minutes: traded.length, price: last[4], scan, high: hi };
  const fails: string[] = [];
  if (!(f.low_since_scan > MOMO.maxLowPct)) fails.push(`fell ${(-f.low_since_scan * 100).toFixed(0)}% below the scan price`);
  if (!(f.off_high > MOMO.maxOffHighPct)) fails.push(`${(-f.off_high * 100).toFixed(0)}% below its high`);
  if (f.traded_minutes < MOMO.waitMin) fails.push(`traded $1,000+ in only ${f.traded_minutes} of ${MOMO.waitMin} minutes`);
  return { pass: fails.length === 0, reason: fails.length ? fails.join("; ") : "held, near its high, traded every minute", features: f };
}

// Each minute: decide on the coins whose 5 minutes are over (6 minutes after the scan, so the 5th minute's candle is
// complete), at most MOMO.decidePerTick (GeckoTerminal allows 30 calls a minute; the scout uses 4).
export async function momoDecide(fetchJson: (url: string) => Promise<any>, nowMs: number, buy: (c: Candidate, live: { price: number; liq: number | null; source?: string } | undefined, why: string) => Promise<boolean>, paused: () => Promise<boolean> = async () => false) {
  await ensureMomoSchema();
  const now = new Date(nowMs).toISOString();
  // Give up on stale coins in one statement, so they never take a decision slot (2026-11-05: 3,171 of 3,293 queued coins
  // expired this way because stale and chart-less rows filled every tick's slots).
  await pool.query(`UPDATE desk_momo_queue SET decided_at = $1, decision = 'too late', detail = $2 WHERE decided_at IS NULL AND seen_at < $3`,
    [now, JSON.stringify({ reason: `not decided within ${MOMO.giveUpMin} minutes` }), new Date(nowMs - MOMO.giveUpMin * 60_000).toISOString()]);
  if (await paused()) return { decided: 0, bought: 0, busy: false, paused: true };
  // Newest due coins first: the replay bought at the 5th minute's close, so a fresh decision matches the test best. Within
// one scan (same seen_at), graduated pools before curve coins, busiest first: graduated pools were 96% of the replay's trades.
  const due = (await pool.query(`SELECT * FROM desk_momo_queue WHERE decided_at IS NULL AND seen_at <= $1 ORDER BY seen_at DESC, (candidate->>'dex' = 'pump-fun') ASC, COALESCE((candidate->>'volumeH1Usd')::float8, 0) DESC LIMIT $2`,
    [new Date(nowMs - (MOMO.waitMin + 1) * 60_000).toISOString(), MOMO.decidePerTick])).rows;
  let bought = 0, decided = 0, busy = false;
  for (const q of due) {
    const atSec = Math.floor(new Date(q.seen_at).getTime() / 1000);
    const mark = (decision: string, detail: unknown) => pool.query(`UPDATE desk_momo_queue SET decided_at = $2, decision = $3, detail = $4 WHERE mint = $1`, [q.mint, now, decision, JSON.stringify(detail)]);
    let cs: number[][];
    try {
      const d = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${q.pool}/ohlcv/minute?aggregate=1&limit=30&before_timestamp=${atSec + (MOMO.waitMin + 1) * 60}&currency=usd`);
      cs = (d?.data?.attributes?.ohlcv_list ?? []).map((x: any[]) => x.map(Number)).sort((a: number[], b: number[]) => a[0] - b[0]);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // GeckoTerminal has no chart for this pool: it never will in time, so decide now instead of retrying for 20 minutes.
      if (/HTTP 404/.test(msg)) { decided++; await mark("skip", { pass: false, reason: "GeckoTerminal has no candles for this pool" }); continue; }
      // Rate limited (429) or down: stop for this tick; more calls now only get refused and slow the other lanes.
      busy = true; break;
    }
    decided++;
    const r = momoRule(cs, atSec);
    if (!r.pass) { await mark("skip", r); continue; }
    let live: { price: number; liq: number | null; source?: string } | undefined;
    try { live = (await fastPrices(fetchJson, [q.mint])).get(q.mint); } catch {}
    // The rule read the candles of the first 5 minutes; the buy happens later, at the live price. That price must still
    // pass, or the lane buys a coin that has already fallen, which is not what the replay tested.
    const f = (r as any).features;
    if (live && f && (!(live.price / f.scan - 1 > MOMO.maxLowPct) || !(live.price / f.high - 1 > MOMO.maxOffHighPct))) {
      await mark("skip", { ...r, pass: false, reason: `moved since its 5 minutes: live $${live.price} against scan $${f.scan}, high $${f.high}`, live });
      continue;
    }
    const ok = await buy(q.candidate as Candidate, live, r.reason);
    await mark(ok ? "bought" : "not bought", { ...r, live: live ?? null });
    if (ok) bought++;
  }
  return { decided, bought, busy };
}
