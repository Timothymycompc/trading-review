// Honest technical FEATURES computed from real Alpaca bars — not a proven edge. They measure trend, breakout, volatility
// and volume so the Strategist has something concrete to rank; whether any of it makes money is unknown until the backtest
// engine (BUILD_PLAN phase 2) proves it out of sample. Nothing here claims profit, and the scoring gate still blocks any
// real trade until a strategy clears 18/25 on unseen data.
import type { Bar } from "./alpaca.js";

export const sma = (bars: Bar[], n: number): number | undefined =>
  bars.length >= n ? bars.slice(-n).reduce((a, b) => a + b.c, 0) / n : undefined;

export const momentum = (bars: Bar[], n: number): number | undefined => {
  if (bars.length <= n) return undefined;
  const then = bars[bars.length - 1 - n].c, now = bars[bars.length - 1].c;
  return then > 0 ? now / then - 1 : undefined;
};

// Average True Range as a fraction of price (volatility), over n sessions.
export const atrPct = (bars: Bar[], n = 14): number | undefined => {
  if (bars.length <= n) return undefined;
  const tr: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atr = tr.reduce((a, b) => a + b, 0) / n, last = bars[bars.length - 1].c;
  return last > 0 ? atr / last : undefined;
};

// Did today close above the highest high of the prior n sessions? (a breakout, by itself not an edge.)
export const breakout = (bars: Bar[], n = 20): boolean | undefined => {
  if (bars.length <= n) return undefined;
  const prior = bars.slice(-n - 1, -1);
  return bars[bars.length - 1].c > Math.max(...prior.map((b) => b.h));
};

export const volumeRatio = (bars: Bar[], n = 20): number | undefined => {
  if (bars.length <= n) return undefined;
  const avg = bars.slice(-n - 1, -1).reduce((a, b) => a + b.v, 0) / n;
  return avg > 0 ? bars[bars.length - 1].v / avg : undefined;
};

export interface Features {
  symbol: string;
  close: number;
  mom20?: number;
  mom60?: number;
  aboveSma50?: boolean;
  breakout20?: boolean;
  atrPct?: number;
  volumeRatio?: number;
  rankScore: number; // a plain heuristic for ordering candidates, NOT a profitability score
}

export function features(symbol: string, bars: Bar[]): Features | null {
  if (bars.length < 25) return null;
  const close = bars[bars.length - 1].c;
  const mom20 = momentum(bars, 20), mom60 = momentum(bars, 60);
  const s50 = sma(bars, 50), bo = breakout(bars, 20), vr = volumeRatio(bars, 20);
  // Heuristic rank only: recent trend + a breakout/volume nudge. Ordering, never a claim of profit.
  const rankScore = (mom20 ?? 0) + 0.5 * (mom60 ?? 0) + (bo ? 0.02 : 0) + (vr && vr > 1.5 ? 0.01 : 0);
  return { symbol, close, mom20, mom60, aboveSma50: s50 != null ? close > s50 : undefined, breakout20: bo, atrPct: atrPct(bars), volumeRatio: vr, rankScore };
}
