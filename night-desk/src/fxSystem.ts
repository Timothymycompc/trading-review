// The EUR/USD "everything" system as a reusable module: indicators computed ONCE per candle set (prepare), then any
// stop / breakeven / trail / take-profit setting simulated cheaply on top (simulate). Same rules as scripts/fx-combo.ts:
// EMA 35/68 trend + 5/16 cross (≤3 candles ago) + Bollinger(20,2) between middle and outer band + ATR(14) above its
// 100-candle mean + strong candle (body ≥ half the range, in trend direction). Signal on close, fill at next open.
// Stops fill at the stop price, or at the open if price gaps through. If stop and take-profit are both touched in one
// candle, the stop is assumed first (conservative). Cost 1.4 pips per round trip. Overnight financing NOT included.

export interface Candle { t: string; o: number; h: number; l: number; c: number }
export interface Trade { entryT: string; exitT: string; pips: number; riskPips: number; maePips: number } // riskPips = initial stop distance; maePips = worst open loss during the trade
export interface Mgmt {
  initK: number;          // initial stop distance, × ATR at entry (0 = NO stop loss, no breakeven, no trail)
  beK: number;            // move stop to breakeven once the close is this many ATR in profit
  trailK: number;         // after breakeven, trail this many ATR behind the best close (0 = no trailing)
  tpK: number;            // take-profit, × ATR at entry (0 = none: let it run)
  trendExit: boolean;     // also exit on a close past EMA 68
  session?: [number, number]; // entries only when the fill hour (UTC) is in [start, end)
}

const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map((x) => (e = x * k + e * (1 - k))); };
function rollMean(xs: number[], n: number): number[] {
  const out: number[] = []; let s = 0;
  for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= n) s -= xs[i - n]; out.push(i >= n - 1 ? s / n : NaN); }
  return out;
}
function rollSd(xs: number[], n: number, m: number[]): number[] {
  const out: number[] = []; let s2 = 0;
  for (let i = 0; i < xs.length; i++) { s2 += xs[i] * xs[i]; if (i >= n) s2 -= xs[i - n] * xs[i - n]; out.push(i >= n - 1 ? Math.sqrt(Math.max(0, s2 / n - m[i] * m[i])) : NaN); }
  return out;
}

export interface Prepared { cs: Candle[]; e68: number[]; atr: number[]; signal: Int8Array; fillHour: Int8Array; pip: number; costRt: number }
// pip: 0.0001 (0.01 for JPY pairs). costRt: round-trip cost in pips (use the pair's measured median spread).
export function prepare(cs: Candle[], pip = 0.0001, costRt = 1.4, opts: { bollinger?: boolean } = {}): Prepared {
  const useBB = opts.bollinger ?? true;
  const cl = cs.map((b) => b.c), e5 = ema(cl, 5), e16 = ema(cl, 16), e35 = ema(cl, 35), e68 = ema(cl, 68);
  const mid = rollMean(cl, 20), sd = rollSd(cl, 20, mid);
  const tr = cs.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - cs[i - 1].c), Math.abs(b.l - cs[i - 1].c)) : b.h - b.l));
  const atr = ema(tr, 14), atrAvg = rollMean(atr, 100);
  const signal = new Int8Array(cs.length), fillHour = new Int8Array(cs.length);
  let dir = 0, crossAt = -1;
  for (let i = 0; i < cs.length - 1; i++) {
    fillHour[i] = new Date(cs[i + 1].t).getUTCHours();
    const d = e5[i] > e16[i] ? 1 : -1;
    if (d !== dir) { dir = d; crossAt = i; }
    if (i < 140) continue;
    const b = cs[i], trend = e35[i] > e68[i] ? 1 : -1;
    const crossOk = dir === trend && i - crossAt <= 3;
    const bbOk = !useBB || (trend > 0 ? b.c > mid[i] && b.c < mid[i] + 2 * sd[i] : b.c < mid[i] && b.c > mid[i] - 2 * sd[i]);
    const volOk = atr[i] > atrAvg[i];
    const r = b.h - b.l, candleOk = r > 0 && Math.abs(b.c - b.o) >= 0.5 * r && Math.sign(b.c - b.o) === trend;
    if (crossOk && bbOk && volOk && candleOk) signal[i] = trend;
  }
  return { cs, e68, atr, signal, fillHour, pip, costRt };
}

export interface OpenPos { dir: number; entryT: string; entry: number; stop: number | null; tp: number | null; atrE: number }
export const simulate = (p: Prepared, m: Mgmt): Trade[] => simulateFull(p, m).trades;
/** Same as simulate, but also returns the position still open after the last candle (for live paper trading). */
export function simulateFull(p: Prepared, m: Mgmt): { trades: Trade[]; open: OpenPos | null } {
  const { cs, e68, atr, signal, fillHour, pip, costRt } = p;
  const trades: Trade[] = [];
  let pos = 0, entry = 0, stop = 0, atrE = 0, best = 0, beHit = false, entryT = "", mae = 0;
  const exit = (px: number, t: string) => { trades.push({ entryT, exitT: t, pips: (pos * (px - entry)) / pip - costRt, riskPips: (m.initK * atrE) / pip, maePips: Math.min(mae, pos * (px - entry)) / pip - costRt }); pos = 0; };
  for (let i = 140; i < cs.length - 1; i++) {
    const b = cs[i];
    if (pos !== 0) {
      const hasStop = m.initK > 0;
      if (hasStop && (pos > 0 ? b.o <= stop : b.o >= stop)) { exit(b.o, b.t); continue; }
      if (hasStop && (pos > 0 ? b.l <= stop : b.h >= stop)) { exit(stop, b.t); continue; }
      mae = Math.min(mae, pos > 0 ? b.l - entry : entry - b.h);
      if (m.tpK > 0) {
        const tp = entry + pos * m.tpK * atrE;
        if (pos > 0 ? b.o >= tp : b.o <= tp) { exit(b.o, b.t); continue; }
        if (pos > 0 ? b.h >= tp : b.l <= tp) { exit(tp, b.t); continue; }
      }
      best = pos > 0 ? Math.max(best, b.c) : Math.min(best, b.c);
      if (hasStop && !beHit && pos * (b.c - entry) >= m.beK * atrE) { beHit = true; stop = pos > 0 ? Math.max(stop, entry) : Math.min(stop, entry); }
      if (beHit && m.trailK > 0) stop = pos > 0 ? Math.max(stop, best - m.trailK * atr[i]) : Math.min(stop, best + m.trailK * atr[i]);
      if (m.trendExit && (pos > 0 ? b.c < e68[i] : b.c > e68[i])) { exit(cs[i + 1].o, cs[i + 1].t); continue; }
    }
    if (pos === 0 && signal[i] !== 0 && (!m.session || (fillHour[i] >= m.session[0] && fillHour[i] < m.session[1]))) {
      pos = signal[i]; entry = cs[i + 1].o; atrE = atr[i]; stop = entry - pos * m.initK * atrE; best = entry; beHit = false; entryT = cs[i + 1].t; mae = 0;
    }
  }
  const open = pos === 0 ? null : { dir: pos, entryT, entry, stop: m.initK > 0 ? stop : null, tp: m.tpK > 0 ? entry + pos * m.tpK * atrE : null, atrE };
  return { trades, open };
}
