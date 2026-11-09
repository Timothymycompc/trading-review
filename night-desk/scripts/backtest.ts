// Trusted backtest: survivorship-safe universe (sector/broad ETFs — they don't vanish and aren't cherry-picked like
// today's winning stocks), a REAL portfolio (one capital pot, position sizing, honest daily drawdown), as much history as
// Alpaca gives (to include a down market), walk-forward split, and the 18/25 gate on the OUT-OF-SAMPLE portion. It also
// compares to simply holding SPY. Honest: if a rule can't beat holding SPY out of sample after costs, it hasn't earned anything.
//   npm run backtest
import { bars, type Bar } from "../src/alpaca.js";
import { SECTOR_ETFS } from "../src/universe.js";
import { RULES } from "../src/strategyRules.js";
import { portfolioBacktest } from "../src/portfolio.js";
import { sharpe, deflatedSharpe, maxDrawdown, scoreStrategy } from "../src/scoring.js";

const COST_PER_SIDE = 0.0005; // 5 bps/side (Alpaca is commission-free; this is spread/slippage on liquid ETFs)
const HISTORY = 1300;         // ~5 years of sessions, to reach a down market (2022)

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const dailyReturns = (eq: number[]) => eq.slice(1).map((v, i) => v / eq[i] - 1);
function moments(a: number[]) {
  const m = mean(a), n = a.length; if (n < 2) return { skew: 0, kurt: 3 };
  const sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / n) || 1e-9;
  return { skew: a.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n, kurt: a.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n };
}
const worstYear = (dates: string[], eq: number[]) => {
  const byYear = new Map<string, number[]>();
  dates.forEach((d, i) => (byYear.get(d.slice(0, 4)) ?? byYear.set(d.slice(0, 4), []).get(d.slice(0, 4))!).push(eq[i]));
  let worst = { year: "?", ret: Infinity };
  for (const [y, e] of byYear) { const r = e[e.length - 1] / e[0] - 1; if (r < worst.ret) worst = { year: y, ret: r }; }
  return worst;
};

async function main() {
  const history = new Map<string, Bar[]>();
  for (const s of SECTOR_ETFS) { try { const b = await bars(s, "1Day", HISTORY); if (b.length > 250) history.set(s, b); } catch {} }
  const spy = history.get("SPY") ?? [];
  const allDates = [...new Set([...history.values()].flat().map((b) => b.t))].sort();
  const split = allDates[Math.floor(allDates.length * 0.6)];
  console.log(`Trusted backtest: ${history.size} ETFs, ${allDates[0]?.slice(0, 10)} -> ${allDates.at(-1)?.slice(0, 10)}, ${COST_PER_SIDE * 10000} bps/side.`);
  console.log(`Walk-forward split ${split.slice(0, 10)} (test = newest ~40%, out of sample). ${RULES.length} rules tried.\n`);

  // Buy-and-hold SPY over the out-of-sample window, for comparison.
  const spyTest = spy.filter((b) => b.t >= split);
  const spyHold = spyTest.length > 1 ? spyTest.at(-1)!.c / spyTest[0].o - 1 : 0;

  for (const rule of RULES) {
    const r = portfolioBacktest(history, rule, { maxConcurrent: SECTOR_ETFS.length, costPerSide: COST_PER_SIDE });
    const splitIdx = r.dates.findIndex((d) => d >= split);
    const testEq = r.equity.slice(splitIdx), testDates = r.dates.slice(splitIdx);
    const dr = dailyReturns(testEq), { skew, kurt } = moments(dr);
    const testTrades = r.trades.filter((t) => t.entryDate >= split).map((t) => t.ret);
    const sr = sharpe(dr, Math.sqrt(252));
    const metrics = {
      outOfSampleSharpe: sr,
      deflatedSharpe: deflatedSharpe(sr / Math.sqrt(252), RULES.length, skew, kurt, dr.length), // DSR wants per-day Sharpe
      maxDrawdown: maxDrawdown(testEq),
      tradeCount: testTrades.length,
      edgeAfterCosts: mean(testTrades),
    };
    const score = scoreStrategy(metrics);
    const totalRet = testEq.at(-1)! / testEq[0] - 1, wy = worstYear(r.dates, r.equity);
    console.log(`${rule.name}`);
    console.log(`  OOS: ${testTrades.length} trades, total ${(totalRet * 100).toFixed(1)}% vs SPY hold ${(spyHold * 100).toFixed(1)}% | Sharpe ${sr.toFixed(2)}, deflated ${metrics.deflatedSharpe.toFixed(2)}, maxDD ${(metrics.maxDrawdown * 100).toFixed(1)}%`);
    console.log(`  worst calendar year (full period): ${wy.year} ${(wy.ret * 100).toFixed(1)}%`);
    console.log(`  SCORE ${score.total}/25 -> ${score.passed && totalRet > spyHold ? "PASS + beat SPY" : score.passed ? "passed gate but did NOT beat SPY" : "FAIL — " + score.reasons[0]}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
