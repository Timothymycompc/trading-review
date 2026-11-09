// Stats for the chosen EUR/USD setting: 4-hour, London/NY entries, SL 1.5 ATR, BE +1 ATR, trail 2 ATR, no TP, EMA 68 exit.
//   npx tsx scripts/fx-best.ts
import { readFileSync } from "node:fs";
import { prepare, simulate, type Candle } from "../src/fxSystem.js";
const cs: Candle[] = JSON.parse(readFileSync(new URL("../research/fx/EUR_USD_H4.json", import.meta.url), "utf8")).candles;
const ts = simulate(prepare(cs), { initK: 1.5, beK: 1, trailK: 2, tpK: 0, trendExit: true, session: [7, 17] });
const w = ts.filter((t) => t.pips > 0), l = ts.filter((t) => t.pips <= 0);
const s = (a: typeof ts) => a.reduce((x, t) => x + t.pips, 0);
let eq = 0, pk = 0, dd = 0, run = 0, worstRun = 0;
for (const t of ts) { eq += t.pips; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); run = t.pips <= 0 ? run + 1 : 0; worstRun = Math.max(worstRun, run); }
const hold = ts.map((t) => (Date.parse(t.exitT) - Date.parse(t.entryT)) / 86400000);
console.log(`trades ${ts.length}, wins ${w.length} (${((100 * w.length) / ts.length).toFixed(0)}%), total ${s(ts).toFixed(0)} pips`);
console.log(`avg win ${(s(w) / w.length).toFixed(1)}  avg loss ${(s(l) / l.length).toFixed(1)}  biggest win ${Math.max(...ts.map((t) => t.pips)).toFixed(0)}  biggest loss ${Math.min(...ts.map((t) => t.pips)).toFixed(0)}`);
console.log(`profit factor ${(s(w) / -s(l)).toFixed(2)}  max drawdown ${dd.toFixed(0)} pips  longest losing streak ${worstRun}`);
console.log(`avg hold ${(hold.reduce((a, x) => a + x, 0) / hold.length).toFixed(1)} days (max ${Math.max(...hold).toFixed(0)})`);
const by = new Map<string, number>(); for (const t of ts) by.set(t.entryT.slice(0, 4), (by.get(t.entryT.slice(0, 4)) ?? 0) + t.pips);
console.log([...by].map(([y, p]) => `${y} ${p.toFixed(0)}`).join("  "));
