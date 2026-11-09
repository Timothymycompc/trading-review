// HIDDEN-DATA TEST (committed before it was run): the EUR/USD 4-hour system, UNCHANGED (London/NY 07–17 UTC entries,
// SL 1.5 ATR, breakeven +1 ATR, trail 2 ATR, no take-profit, EMA 68 exit), on data never used to build it:
//   - 9 other pairs, 2016 → now      - EUR/USD 2005 → 2015
// Each pair pays its own measured median spread (Oanda bid/ask). Overnight financing NOT included.
// R = pips ÷ initial stop distance, i.e. results if every trade risked the same amount (1R).
//   npx tsx scripts/fx-hidden.ts
import { readFileSync } from "node:fs";
import { prepare, simulate, type Mgmt, type Trade } from "../src/fxSystem.js";

const M: Mgmt = { initK: 1.5, beK: 1, trailK: 2, tpK: 0, trendExit: true, session: [7, 17] };
const load = (f: string) => JSON.parse(readFileSync(new URL(`../research/fx/${f}.json`, import.meta.url), "utf8"));
const R = (ts: Trade[]) => ts.reduce((a, t) => a + t.pips / t.riskPips, 0);
const P = (ts: Trade[]) => ts.reduce((a, t) => a + t.pips, 0);
const pf = (ts: Trade[]) => { const w = ts.filter((t) => t.pips > 0), l = ts.filter((t) => t.pips <= 0); return P(l) ? P(w) / -P(l) : 0; };
const row = (name: string, ts: Trade[], extra = "") =>
  `${name.padEnd(22)} trades ${String(ts.length).padStart(3)}  win ${String(Math.round((100 * ts.filter((t) => t.pips > 0).length) / Math.max(1, ts.length))).padStart(2)}%  PF ${pf(ts).toFixed(2)}  ${P(ts).toFixed(0).padStart(6)} pips  ${R(ts).toFixed(1).padStart(6)} R ${extra}`;

console.log("=== Hidden set 1: other pairs, 2016 → now (rules untouched) ===");
const pairs = ["GBP_USD", "USD_JPY", "AUD_USD", "USD_CAD", "USD_CHF", "NZD_USD", "EUR_JPY", "GBP_JPY", "EUR_GBP"];
const all: Trade[] = [];
for (const p of pairs) {
  const d = load(`${p}_H4`);
  const ts = simulate(prepare(d.candles, d.pip, d.medianSpreadPips), M);
  all.push(...ts);
  const per = [["2016", "2022"], ["2022", "2025-11-09"], ["2025-11-09", "9999"]].map(([a, b]) => R(ts.filter((t) => t.entryT >= a && t.entryT < b)).toFixed(1).padStart(5));
  console.log(row(p, ts, ` | R by period ${per.join(" |")}  (spread ${d.medianSpreadPips})`));
}
console.log(row("ALL 9 PAIRS", all));
const byYear = new Map<string, number>(); for (const t of all) byYear.set(t.entryT.slice(0, 4), (byYear.get(t.entryT.slice(0, 4)) ?? 0) + t.pips / t.riskPips);
console.log("R by year: " + [...byYear].sort().map(([y, r]) => `${y} ${r.toFixed(1)}`).join("  "));

console.log("\n=== Hidden set 2: EUR/USD 2005 → 2015 (rules untouched) ===");
const old = load("EUR_USD_H4_2005-2015");
const ots = simulate(prepare(old.candles, old.pip, old.medianSpreadPips), M);
console.log(row("EUR_USD 2005-2015", ots));
const oy = new Map<string, number>(); for (const t of ots) oy.set(t.entryT.slice(0, 4), (oy.get(t.entryT.slice(0, 4)) ?? 0) + t.pips);
console.log("pips by year: " + [...oy].sort().map(([y, r]) => `${y} ${r.toFixed(0)}`).join("  "));

console.log("\n=== For reference (NOT hidden): EUR/USD 2016 → now, measured 1.5-pip spread ===");
const ref = load("EUR_USD_H4");
console.log(row("EUR_USD 2016-now", simulate(prepare(ref.candles, ref.pip, ref.medianSpreadPips), M)));
