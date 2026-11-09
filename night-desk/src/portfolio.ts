// A real portfolio backtest: ONE pot of capital, position sizing, concurrent positions, and a daily mark-to-market equity
// curve — so drawdown and Sharpe are honest (the old engine compounded overlapping trades as one all-in curve, which
// faked an 88% drawdown). No lookahead: a signal at day i closes is entered at day i+1's OPEN. Costs charged both sides.
import type { Bar } from "./alpaca.js";
import type { Rule, Trade } from "./backtest.js";

export interface PortfolioResult {
  dates: string[];
  equity: number[];          // daily mark-to-market, aligned to dates
  trades: (Trade & { symbol: string })[];
}

interface Planned { symbol: string; entryDate: string; entryPx: number; exitDate: string; exitPx: number; }

// Turn a rule into the list of trades it WOULD take on one symbol (entry next open, exit at holdDays close or stop).
function plannedTrades(symbol: string, bars: Bar[], rule: Rule): Planned[] {
  const out: Planned[] = [];
  let i = rule.warmup;
  while (i < bars.length - 1) {
    if (!rule.enter(bars, i, symbol)) { i++; continue; }
    const entryPx = bars[i + 1].o;
    if (!(entryPx > 0)) { i++; continue; }
    const stop = rule.stopPct ? entryPx * (1 - rule.stopPct) : null;
    let exitIdx = Math.min(i + rule.holdDays, bars.length - 1), exitPx = bars[exitIdx].c;
    for (let j = i + 1; j <= exitIdx; j++) {
      if (stop !== null && bars[j].l <= stop) { exitPx = Math.min(stop, bars[j].c); exitIdx = j; break; }
      // Rule-based exit: signal at day j's close, leave at day j+1's open (no lookahead).
      if (rule.exit && j + 1 < bars.length && rule.exit(bars, j, symbol)) { exitIdx = j + 1; exitPx = bars[j + 1].o; break; }
    }
    out.push({ symbol, entryDate: bars[i + 1].t, entryPx, exitDate: bars[exitIdx].t, exitPx });
    i = exitIdx + 1;
  }
  return out;
}

export function portfolioBacktest(
  history: Map<string, Bar[]>,
  rule: Rule,
  opts: { startCapital?: number; maxConcurrent?: number; costPerSide?: number } = {}
): PortfolioResult {
  const startCapital = opts.startCapital ?? 100_000, maxConcurrent = opts.maxConcurrent ?? 10, cost = opts.costPerSide ?? 0.0005;
  const frac = 1 / maxConcurrent;

  // All trading dates, and each symbol's close by date (for daily mark-to-market).
  const dateSet = new Set<string>(), closeBy = new Map<string, Map<string, number>>();
  for (const [sym, bars] of history) {
    const m = new Map<string, number>();
    for (const b of bars) { dateSet.add(b.t); m.set(b.t, b.c); }
    closeBy.set(sym, m);
  }
  const dates = [...dateSet].sort();

  // Entries grouped by date, exits grouped by date.
  const entriesOn = new Map<string, Planned[]>(), exitsOn = new Map<string, Planned[]>();
  for (const [sym, bars] of history) for (const p of plannedTrades(sym, bars, rule)) {
    (entriesOn.get(p.entryDate) ?? entriesOn.set(p.entryDate, []).get(p.entryDate)!).push(p);
    (exitsOn.get(p.exitDate) ?? exitsOn.set(p.exitDate, []).get(p.exitDate)!).push(p);
  }

  let cash = startCapital;
  const open = new Map<Planned, { shares: number; sizeUsd: number }>();
  const equity: number[] = [], trades: (Trade & { symbol: string })[] = [];

  for (const d of dates) {
    // Exits first (free the capital before new entries the same day).
    for (const p of exitsOn.get(d) ?? []) {
      const pos = open.get(p); if (!pos) continue;
      const proceeds = pos.shares * p.exitPx * (1 - cost);
      cash += proceeds; open.delete(p);
      trades.push({ symbol: p.symbol, entryDate: p.entryDate, exitDate: p.exitDate, ret: proceeds / pos.sizeUsd - 1 });
    }
    // Entries: only if there is a free slot and cash; size on current equity.
    for (const p of entriesOn.get(d) ?? []) {
      if (open.size >= maxConcurrent) break;
      const mtm = cash + [...open].reduce((s, [q, pos]) => s + pos.shares * (closeBy.get(q.symbol)?.get(d) ?? q.entryPx), 0);
      const sizeUsd = mtm * frac;
      if (sizeUsd > cash || sizeUsd <= 0) continue;
      const shares = (sizeUsd * (1 - cost)) / p.entryPx;
      cash -= sizeUsd; open.set(p, { shares, sizeUsd });
    }
    // Mark to market at today's close.
    const mtm = cash + [...open].reduce((s, [q, pos]) => s + pos.shares * (closeBy.get(q.symbol)?.get(d) ?? q.entryPx), 0);
    equity.push(mtm);
  }
  return { dates, equity, trades };
}
