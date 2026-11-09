// Rule lab: tests the rules in research/lab/candidates.ts on the SEARCH data only (research/data/etf-search.json, which
// stops before the lock date — the newest year is held back for scripts/final-check.ts). Same engine as the trusted
// backtest: one pot of capital, next-open entries, 5 bps/side costs. Every rule ever run is logged to
// research/lab/trials.jsonl, because the number of rules tried is what the deflated Sharpe penalises.
//   npx tsx scripts/rule-lab.ts
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import type { Bar } from "../src/alpaca.js";
import { portfolioBacktest } from "../src/portfolio.js";
import { sharpe, deflatedSharpe, maxDrawdown } from "../src/scoring.js";
import { CANDIDATES } from "../research/lab/candidates.js";

const COST_PER_SIDE = 0.0005;
const data = JSON.parse(readFileSync(new URL("../research/data/etf-search.json", import.meta.url), "utf8"));
// Common start: the date every ETF has data (SPY's early IEX history is sparse, so align everyone).
const start: string = Object.values<Bar[]>(data.bars).map((b) => b[0].t).sort().at(-1)!;
const history = new Map<string, Bar[]>(Object.entries<Bar[]>(data.bars).map(([s, b]) => [s, b.filter((x) => x.t >= start)]));
const dates = [...new Set([...history.values()].flat().map((b) => b.t))].sort();
const split = dates[Math.floor(dates.length * 0.6)]; // train = older 60%, validate = newer 40% (both inside the search data)

const spy = history.get("SPY")!;
function window(eq: number[], ds: string[], from: string, to: string) {
  const a = ds.findIndex((d) => d >= from), b = ds.findIndex((d) => d >= to);
  return eq.slice(a, b === -1 ? undefined : b);
}
function stats(eq: number[]) {
  const dr = eq.slice(1).map((v, i) => v / eq[i] - 1);
  const years = dr.length / 252;
  return { ret: eq.at(-1)! / eq[0] - 1, cagr: Math.pow(eq.at(-1)! / eq[0], 1 / years) - 1, sharpe: sharpe(dr, Math.sqrt(252)), maxDD: maxDrawdown(eq), dr };
}
const spyEq = spy.map((b) => b.c), spyDates = spy.map((b) => b.t);
const spyTrain = stats(window(spyEq, spyDates, start, split)), spyVal = stats(window(spyEq, spyDates, split, "9999"));

const trialsFile = new URL("../research/lab/trials.jsonl", import.meta.url);
const seen = new Set<string>(existsSync(trialsFile) ? readFileSync(trialsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).name) : []);
for (const r of CANDIDATES) seen.add(r.name);
const nTrials = seen.size;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Search data ${start.slice(0, 10)} → ${dates.at(-1)!.slice(0, 10)} (lock ${String(data.lockDate).slice(0, 10)} onward is hidden). Split ${split.slice(0, 10)}.`);
console.log(`SPY hold   train: ret ${pct(spyTrain.ret)} CAGR ${pct(spyTrain.cagr)} Sharpe ${spyTrain.sharpe.toFixed(2)} maxDD ${pct(spyTrain.maxDD)}`);
console.log(`SPY hold   valid: ret ${pct(spyVal.ret)} CAGR ${pct(spyVal.cagr)} Sharpe ${spyVal.sharpe.toFixed(2)} maxDD ${pct(spyVal.maxDD)}`);
console.log(`Unique rules tried so far (incl. this run): ${nTrials}\n`);

for (const rule of CANDIDATES) {
  const r = portfolioBacktest(history, rule, { maxConcurrent: rule.slots ?? history.size, costPerSide: COST_PER_SIDE });
  const tr = stats(window(r.equity, r.dates, start, split)), va = stats(window(r.equity, r.dates, split, "9999"));
  const nTrades = r.trades.length;
  const m = va.dr.reduce((a, b) => a + b, 0) / va.dr.length, sd = Math.sqrt(va.dr.reduce((a, x) => a + (x - m) ** 2, 0) / va.dr.length) || 1e-9;
  const skew = va.dr.reduce((a, x) => a + ((x - m) / sd) ** 3, 0) / va.dr.length, kurt = va.dr.reduce((a, x) => a + ((x - m) / sd) ** 4, 0) / va.dr.length;
  const dsr = deflatedSharpe(va.sharpe / Math.sqrt(252), nTrials, skew, kurt, va.dr.length); // per-day Sharpe
  const beats = tr.ret > spyTrain.ret && va.ret > spyVal.ret;
  const beatsRisk = tr.sharpe > spyTrain.sharpe && va.sharpe > spyVal.sharpe;
  console.log(rule.name);
  console.log(`  train: ret ${pct(tr.ret)} Sharpe ${tr.sharpe.toFixed(2)} maxDD ${pct(tr.maxDD)} | valid: ret ${pct(va.ret)} Sharpe ${va.sharpe.toFixed(2)} maxDD ${pct(va.maxDD)} | trades ${nTrades} | deflated ${dsr.toFixed(2)}`);
  console.log(`  ${beats ? "BEATS SPY return in both" : "does not beat SPY return in both"}; ${beatsRisk ? "beats SPY Sharpe in both" : "does not beat SPY Sharpe in both"}\n`);
  appendFileSync(trialsFile, JSON.stringify({ at: new Date().toISOString(), name: rule.name, train: { ret: tr.ret, sharpe: tr.sharpe, maxDD: tr.maxDD }, valid: { ret: va.ret, sharpe: va.sharpe, maxDD: va.maxDD }, trades: nTrades, beats, beatsRisk }) + "\n");
}
