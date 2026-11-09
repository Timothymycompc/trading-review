// The backtest engine: does a rule actually make money out of sample, after costs? No lookahead (a signal on day i is
// entered at day i+1's OPEN), realistic costs (a per-side fraction for spread/slippage — Alpaca is commission-free but a
// fill still costs the spread), and a walk-forward split so we judge a rule on data it was NOT chosen on. It never
// flatters a rule; if it loses out of sample, that is the answer.
import type { Bar } from "./alpaca.js";

export interface Rule {
  name: string;
  warmup: number;                       // bars needed before the rule can fire
  enter: (bars: Bar[], i: number, symbol?: string) => boolean; // may read bars[0..i] only (no future)
  holdDays: number;                     // exit at the close this many sessions after entry
  stopPct?: number;                     // intrabar stop (fraction, e.g. 0.05)
  exit?: (bars: Bar[], i: number, symbol?: string) => boolean; // optional: leave at day i+1's OPEN when true (reads bars[0..i] only)
  slots?: number;                       // optional: max positions held at once (capital split equally); default = all symbols
}

export interface Trade { entryDate: string; exitDate: string; ret: number; }

// One symbol through one rule. Long-only. costPerSide is charged on entry and exit.
export function simulate(bars: Bar[], rule: Rule, costPerSide: number): Trade[] {
  const trades: Trade[] = [];
  let i = rule.warmup;
  while (i < bars.length - 1) {
    if (!rule.enter(bars, i)) { i++; continue; }
    const entry = bars[i + 1].o;                 // next open, no lookahead
    if (!(entry > 0)) { i++; continue; }
    const stop = rule.stopPct ? entry * (1 - rule.stopPct) : null;
    let exitIdx = Math.min(i + rule.holdDays, bars.length - 1), exitPx = bars[exitIdx].c;
    for (let j = i + 1; j <= exitIdx; j++) {
      if (stop !== null && bars[j].l <= stop) { exitPx = Math.min(stop, bars[j].c); exitIdx = j; break; }
    }
    const gross = exitPx / entry;
    const net = gross * (1 - costPerSide) / (1 + costPerSide) - 1; // cost both sides
    trades.push({ entryDate: bars[i + 1].t, exitDate: bars[exitIdx].t, ret: net });
    i = exitIdx + 1;                             // no overlapping positions per symbol
  }
  return trades;
}

// Pool trades from many symbols, then split by entry date into the train (older) and test (newer, out-of-sample) halves.
export function walkForwardSplit(trades: Trade[], splitDate: string): { train: number[]; test: number[] } {
  const train: number[] = [], test: number[] = [];
  for (const t of trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate)))
    (t.entryDate < splitDate ? train : test).push(t.ret);
  return { train, test };
}

// An equity curve from a sequence of trade returns (compounded), for max-drawdown.
export const equityCurve = (returns: readonly number[]): number[] => {
  const curve = [1];
  for (const r of returns) curve.push(curve[curve.length - 1] * (1 + r));
  return curve;
};

// Annualization for trade-level Sharpe: how many of these trades happen per year on average.
export const tradesPerYear = (trades: Trade[]): number => {
  if (trades.length < 2) return 1;
  const first = Date.parse(trades[0].entryDate), last = Date.parse(trades[trades.length - 1].entryDate);
  const years = Math.max((last - first) / (365.25 * 86_400_000), 1 / 365);
  return trades.length / years;
};
