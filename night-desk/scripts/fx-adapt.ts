// EUR/USD "everything" system: (1) a wide grid of stop / breakeven / trail / take-profit / trend-exit settings on every
// timeframe, judged by how MUCH of the grid works (not the best cell); (2) a "learns as it goes" walk-forward: every
// 6 months it picks the setting that did best on PAST data only (trades already closed), then trades the next 6 months
// with it — so its results are fully out of sample. Data: Oanda practice candles. 1.4 pips/round trip, no financing.
//   npx tsx scripts/fx-adapt.ts H4      (M15 | H1 | H4 | D)
import { readFileSync } from "node:fs";
import { prepare, simulate, type Candle, type Mgmt, type Trade } from "../src/fxSystem.js";

const gran = process.argv[2] ?? "H4";
const cs: Candle[] = JSON.parse(readFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), "utf8")).candles;
const prep = prepare(cs);
const periods: [string, string][] = [["2016", "2022"], ["2022", "2025-11-09"], ["2025-11-09", "9999"]];
const sum = (ts: Trade[]) => ts.reduce((a, t) => a + t.pips, 0);
const inP = (ts: Trade[], a: string, b: string) => ts.filter((t) => t.entryT >= a && t.entryT < b);
const LONDON_NY: [number, number] = [7, 17];
const label = (m: Mgmt) => `SL ${m.initK} BE ${m.beK} trail ${m.trailK || "-"} TP ${m.tpK || "-"}${m.trendExit ? "" : " noEMA68exit"}`;
const fmt3 = (ts: Trade[]) => periods.map(([a, b]) => sum(inP(ts, a, b)).toFixed(0).padStart(6)).join(" |");

const sessions: [string, [number, number] | undefined][] = gran === "D" ? [["all hours", undefined]] : [["all hours", undefined], ["London/NY", LONDON_NY]];
for (const [sName, session] of sessions) {
  const cells: { m: Mgmt; ts: Trade[] }[] = [];
  for (const initK of [0.75, 1, 1.5, 2, 3]) for (const beK of [0.5, 1, 2]) for (const trailK of [0, 1, 1.5, 2, 3, 4, 5])
    for (const tpK of [0, 2, 3, 4, 6, 8]) for (const trendExit of [true, false]) {
      const m: Mgmt = { initK, beK, trailK, tpK, trendExit, session };
      cells.push({ m, ts: simulate(prep, m) });
    }
  const totals = cells.map((c) => sum(c.ts)).sort((a, b) => a - b);
  const all3 = cells.filter((c) => periods.every(([a, b]) => sum(inP(c.ts, a, b)) > 0)).length;
  const best = cells.reduce((x, y) => (sum(y.ts) > sum(x.ts) ? y : x));
  console.log(`\n===== EUR/USD ${gran} · ${sName} · ${cells.length} settings =====`);
  console.log(`grid: ${totals.filter((x) => x > 0).length}/${cells.length} positive 2016→now, ${all3}/${cells.length} positive in all 3 periods; median ${totals[Math.floor(totals.length / 2)].toFixed(0)} pips, worst ${totals[0].toFixed(0)}, best ${totals.at(-1)!.toFixed(0)} (${label(best.m)}, ${best.ts.length} trades)`);
  const centre = cells.find((c) => c.m.initK === 1.5 && c.m.beK === 1 && c.m.trailK === 2 && c.m.tpK === 0 && c.m.trendExit)!;
  console.log(`pips per period:                 2016–21 | 2022–25 | last 12m`);
  console.log(`fixed centre (${label(centre.m)})`.padEnd(32) + ` ${fmt3(centre.ts)}   trades ${centre.ts.length}`);

  // Walk-forward "learning": every 6 months from 2018, choose the setting with the most pips on trades that had
  // already CLOSED before the window (expanding history, or the last 3 years), needing ≥ 8 such trades.
  for (const [wfName, lookbackYears] of [["learns (all past)", 99], ["learns (last 3 yrs)", 3]] as [string, number][]) {
    const chosen: Trade[] = []; const picks: string[] = [];
    for (let y = 2018; y <= 2026; y++) for (const h of [0, 1]) {
      const start = `${y}-${h ? "07" : "01"}-01`, end = h ? `${y + 1}-01-01` : `${y}-07-01`;
      const from = `${y - lookbackYears}-${h ? "07" : "01"}-01`;
      let bestCell: { m: Mgmt; ts: Trade[] } | null = null, bestScore = -Infinity;
      for (const c of cells) {
        const past = c.ts.filter((t) => t.exitT < start && t.entryT >= from);
        if (past.length < 8) continue;
        const sc = sum(past); if (sc > bestScore) { bestScore = sc; bestCell = c; }
      }
      if (!bestCell) continue;
      chosen.push(...inP(bestCell.ts, start, end));
      picks.push(`${start.slice(0, 7)}: ${label(bestCell.m)}`);
    }
    console.log(`${wfName}`.padEnd(32) + ` ${fmt3(chosen)}   trades ${chosen.length}   (starts 2018)`);
    if (process.argv[3] === "picks") console.log("   " + picks.join("\n   "));
  }
}
