// Tim's variant: NO Bollinger filter, NO stop loss (no breakeven, no trail), bigger take-profits. Exits: take-profit
// and/or a close past EMA 68. Shows worst open loss per trade, because with no stop that decides survival.
// EUR/USD, Oanda candles, measured 1.5-pip spread, overnight financing NOT included (it matters more with long holds).
//   npx tsx scripts/fx-nostop.ts
import { readFileSync } from "node:fs";
import { prepare, simulate, type Mgmt, type Trade } from "../src/fxSystem.js";

const per: [string, string][] = [["2016", "2022"], ["2022", "2025-11-09"], ["2025-11-09", "9999"]];
const P = (ts: Trade[]) => ts.reduce((a, t) => a + t.pips, 0);
function row(name: string, ts: Trade[]) {
  if (!ts.length) return `${name.padEnd(30)} no trades`;
  const w = ts.filter((t) => t.pips > 0), l = ts.filter((t) => t.pips <= 0);
  let eq = 0, pk = 0, dd = 0; for (const t of ts) { eq += t.pips; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const pp = per.map(([a, b]) => P(ts.filter((t) => t.entryT >= a && t.entryT < b)));
  const ok = pp.every((x) => x > 0) ? "✓" : " ";
  const days = ts.map((t) => (Date.parse(t.exitT) - Date.parse(t.entryT)) / 864e5);
  return `${ok} ${name.padEnd(28)} ${P(ts).toFixed(0).padStart(6)} | ${pp.map((x) => x.toFixed(0).padStart(5)).join(" /")} | tr ${String(ts.length).padStart(3)} win ${String(Math.round((100 * w.length) / ts.length)).padStart(2)}% PF ${(l.length ? P(w) / -P(l) : 0).toFixed(2)} DD ${dd.toFixed(0).padStart(4)} | worst loss ${Math.min(...ts.map((t) => t.pips)).toFixed(0)} worst open ${Math.min(...ts.map((t) => t.maePips)).toFixed(0)} | hold avg ${(days.reduce((a, x) => a + x, 0) / days.length).toFixed(0)}d max ${Math.max(...days).toFixed(0)}d`;
}

const sets: [string, string, [number, number] | undefined][] = [["EUR_USD_H4", "4h all hours", undefined], ["EUR_USD_H4", "4h London/NY", [7, 17]], ["EUR_USD_D", "Daily", undefined]];
console.log("✓ = positive in all 3 periods. pips: total | 2016–21 / 2022–25 / last 12m");
for (const [f, label, session] of sets) {
  const d = JSON.parse(readFileSync(new URL(`../research/fx/${f}.json`, import.meta.url), "utf8"));
  console.log(`\n=== EUR/USD ${label} ===`);
  const ref = prepare(d.candles, 0.0001, 1.5);
  const noBB = prepare(d.candles, 0.0001, 1.5, { bollinger: false });
  const best: Mgmt = label === "4h London/NY" ? { initK: 1.5, beK: 1, trailK: 2, tpK: 0, trendExit: true, session } : label === "Daily" ? { initK: 3, beK: 2, trailK: 3, tpK: 4, trendExit: true } : { initK: 2, beK: 2, trailK: 1, tpK: 6, trendExit: true, session };
  console.log(row("REFERENCE (best w/ stops, BB)", simulate(ref, best)));
  console.log(row("ref setting, no Bollinger", simulate(noBB, best)));
  for (const trendExit of [true, false]) {
    console.log(trendExit ? " -- no BB, NO stop, exit = TP or close past EMA 68" : " -- no BB, NO stop, exit = TP ONLY (nothing else)");
    for (const tpK of [0, 4, 6, 8, 10, 12, 15]) {
      if (!trendExit && tpK === 0) continue; // would never exit
      console.log(row(`TP ${tpK ? tpK + " ATR" : "none"}`, simulate(noBB, { initK: 0, beK: 0, trailK: 0, tpK, trendExit, session })));
    }
  }
}
