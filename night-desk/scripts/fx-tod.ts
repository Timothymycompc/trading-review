// Time-of-day effect (Breedon & Ranaldo, Journal of Money, Credit and Banking 2013): currencies tend to DEPRECIATE during
// their own local trading hours. Rules FIXED from the paper and committed BEFORE the first run (UTC hours, every weekday):
//   EUR/USD, GBP/USD: sell the pair 07–12 (European hours); buy the pair 13–21 (US hours, USD weakens)
//   USD/JPY: buy 00–06 (Tokyo hours, JPY weakens); sell 13–21 (US hours)
//   AUD/USD: sell 23–06 (Sydney/Tokyo hours, AUD weakens); buy 13–21 (US hours)
// Enter at the open of the first hour, exit at the open of the end hour. Cost = measured median spread per leg.
// Shows GROSS (before cost) too: a daily intraday effect must beat the spread to be tradeable.
//   npx tsx scripts/fx-tod.ts
import { readFileSync, existsSync } from "node:fs";

interface C { t: string; o: number }
const load = (f: string) => JSON.parse(readFileSync(new URL(`../research/fx/${f}.json`, import.meta.url), "utf8"));
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const tstat = (a: number[]) => { const m = mean(a), sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); return sd ? m / (sd / Math.sqrt(a.length)) : 0; };
const periods: [string, string, string][] = [["2005–2015", "2005", "2016"], ["2016–2021", "2016", "2022"], ["2022–Nov 2025", "2022", "2025-11-09"], ["last 12m", "2025-11-09", "9999"]];

// [pair, files, legs: [name, startHourUTC, endHourUTC, direction (+1 buy pair)]]
const SETUP: [string, string[], [string, number, number, number][]][] = [
  ["EUR_USD", ["EUR_USD_H1_2005-2015", "EUR_USD_H1"], [["EU hours sell", 7, 12, -1], ["US hours buy", 13, 21, 1]]],
  ["GBP_USD", ["GBP_USD_H1"], [["EU hours sell", 7, 12, -1], ["US hours buy", 13, 21, 1]]],
  ["USD_JPY", ["USD_JPY_H1"], [["Tokyo buy", 0, 6, 1], ["US hours sell", 13, 21, -1]]],
  ["AUD_USD", ["AUD_USD_H1"], [["Sydney sell", 23, 6, -1], ["US hours buy", 13, 21, 1]]],
];

for (const [pair, files, legs] of SETUP) {
  const cs: C[] = files.filter((f) => existsSync(new URL(`../research/fx/${f}.json`, import.meta.url))).flatMap((f) => load(f).candles);
  const pip = pair.includes("JPY") ? 0.01 : 0.0001, cost = load(files.at(-1)!).medianSpreadPips ?? 1.5;
  const at = new Map(cs.map((c) => [c.t.slice(0, 13), c.o])); // "YYYY-MM-DDTHH" → open
  const days = [...new Set(cs.map((c) => c.t.slice(0, 10)))].sort();
  console.log(`\n=== ${pair} (cost ${Number(cost).toFixed(1)} pips per trade) ===`);
  for (const [name, h0, h1, dir] of legs) {
    const gross: { d: string; p: number }[] = [];
    for (const d of days) {
      const wd = new Date(d + "T12:00:00Z").getUTCDay(); if (wd < 1 || wd > 5) continue;
      const endDay = h1 > h0 ? d : new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10); // overnight leg
      const a = at.get(`${d}T${String(h0).padStart(2, "0")}`), b = at.get(`${endDay}T${String(h1).padStart(2, "0")}`);
      if (a == null || b == null) continue;
      gross.push({ d, p: (dir * (b - a)) / pip });
    }
    const g = gross.map((x) => x.p), net = g.map((x) => x - cost);
    const per = periods.map(([n, a, b]) => { const x = gross.filter((e) => e.d >= a && e.d < b); return x.length ? `${n} ${x.reduce((s, e) => s + e.p - cost, 0).toFixed(0)}` : null; }).filter(Boolean);
    console.log(`  ${name.padEnd(14)} days ${g.length}  GROSS avg ${mean(g).toFixed(2).padStart(5)} pips (t ${tstat(g).toFixed(2)})  NET avg ${mean(net).toFixed(2).padStart(5)}  NET total ${net.reduce((a, b) => a + b, 0).toFixed(0).padStart(6)}`);
    console.log(`                 net by period: ${per.join(" | ")}`);
  }
}
