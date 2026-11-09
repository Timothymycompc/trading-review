// EUR/USD moving-average crossover backtest (5/16, SMA and EMA), daily, from FRED DEXUSEU (Fed noon NY rate, 1999-).
// Source: https://fred.stlouisfed.org/series/DEXUSEU — saved to research/fx/DEXUSEU.csv. Close-only, so no candle patterns.
// Rule: always in the market — long when fast MA > slow MA, short when below. Signal at day t's close, position
// held from t to t+1 (no look-ahead). Cost: 1.5 pips paid on every flip (one spread). Overnight swap NOT included.
// Run: npx tsx scripts/fx-crossover.ts
import { readFileSync } from "node:fs";
import { sharpe, maxDrawdown } from "../src/scoring.js";

const rows = readFileSync(new URL("../research/fx/DEXUSEU.csv", import.meta.url), "utf8")
  .trim().split("\n").slice(1)
  .map((l) => l.split(","))
  .filter(([, v]) => v && v !== ".")
  .map(([d, v]) => ({ date: d, px: Number(v) }));

const COST_PIPS = 1.5;
const SPLIT = "2015-01-01"; // before = "train" era, after = out-of-sample era

function sma(xs: number[], n: number): number[] {
  const out: number[] = []; let s = 0;
  xs.forEach((x, i) => { s += x; if (i >= n) s -= xs[i - n]; out.push(i >= n - 1 ? s / n : NaN); });
  return out;
}
function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1); const out: number[] = []; let e = NaN;
  xs.forEach((x, i) => {
    if (i === n - 1) e = xs.slice(0, n).reduce((a, b) => a + b) / n;
    else if (i >= n) e = x * k + e * (1 - k);
    out.push(i >= n - 1 ? e : NaN);
  });
  return out;
}

interface Result { rets: number[]; dates: string[]; flips: number; wins: number; trades: number }
function run(kind: "SMA" | "EMA", fast: number, slow: number, from = "", to = "9999"): Result {
  const px = rows.map((r) => r.px);
  const f = kind === "SMA" ? sma(px, fast) : ema(px, fast);
  const s = kind === "SMA" ? sma(px, slow) : ema(px, slow);
  const rets: number[] = []; const dates: string[] = [];
  let pos = 0, flips = 0, trades = 0, wins = 0, tradeRet = 0;
  for (let t = slow; t < rows.length - 1; t++) {
    if (rows[t].date < from || rows[t].date >= to) continue;
    const want = f[t] > s[t] ? 1 : -1;
    let cost = 0;
    if (want !== pos) {
      if (pos !== 0) { trades++; if (tradeRet > 0) wins++; }
      cost = (COST_PIPS * 0.0001) / px[t]; flips++; pos = want; tradeRet = 0;
    }
    const r = pos * (px[t + 1] / px[t] - 1) - cost;
    tradeRet += r; rets.push(r); dates.push(rows[t + 1].date);
  }
  return { rets, dates, flips, wins, trades };
}

function stats(r: Result) {
  const eq = [1]; for (const x of r.rets) eq.push(eq[eq.length - 1] * (1 + x));
  const years = r.rets.length / 252;
  return {
    cagr: (Math.pow(eq[eq.length - 1], 1 / years) - 1) * 100,
    total: (eq[eq.length - 1] - 1) * 100,
    sharpe: sharpe(r.rets, Math.sqrt(252)),
    maxDD: maxDrawdown(eq) * 100,
    tradesPerYr: r.trades / years,
    winRate: r.trades ? (r.wins / r.trades) * 100 : 0,
  };
}
const fmt = (s: ReturnType<typeof stats>) =>
  `CAGR ${s.cagr.toFixed(2).padStart(6)}%  total ${s.total.toFixed(0).padStart(5)}%  Sharpe ${s.sharpe.toFixed(2).padStart(5)}  maxDD ${s.maxDD.toFixed(0).padStart(3)}%  trades/yr ${s.tradesPerYr.toFixed(0).padStart(3)}  win ${s.winRate.toFixed(0)}%`;

console.log(`EUR/USD daily, FRED DEXUSEU ${rows[0].date} → ${rows[rows.length - 1].date}, ${COST_PIPS} pip cost per flip, swap not included\n`);
for (const kind of ["SMA", "EMA"] as const) {
  console.log(`${kind} 5/16`);
  console.log(`  all years      ${fmt(stats(run(kind, 5, 16)))}`);
  console.log(`  1999-2014      ${fmt(stats(run(kind, 5, 16, "", SPLIT)))}`);
  console.log(`  2015-now (OOS) ${fmt(stats(run(kind, 5, 16, SPLIT)))}`);
}

// Is 5/16 special, or is it one lucky pick out of many? Grid of nearby settings, out-of-sample era.
console.log(`\nNeighbour grid, 2015-now, Sharpe (EMA):`);
const slows = [10, 13, 16, 20, 25, 30, 40, 50];
console.log("fast\\slow " + slows.map((s) => String(s).padStart(6)).join(""));
for (const fast of [2, 3, 5, 8, 10]) {
  console.log(String(fast).padStart(9) + " " + slows.map((s) => (s <= fast ? "     -" : sharpe(run("EMA", fast, s, SPLIT).rets, Math.sqrt(252)).toFixed(2).padStart(6))).join(""));
}

// Year by year for EMA 5/16.
console.log(`\nEMA 5/16 by year (% return):`);
const full = run("EMA", 5, 16);
const byYear = new Map<string, number>();
full.rets.forEach((r, i) => { const y = full.dates[i].slice(0, 4); byYear.set(y, (byYear.get(y) ?? 1) * (1 + r)); });
console.log([...byYear].map(([y, g]) => `${y} ${((g - 1) * 100).toFixed(1)}`).join("  "));
