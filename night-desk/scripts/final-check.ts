// ONE-SHOT final check: runs the FINALISTS from research/lab/candidates.ts on the LOCKED year (the sessions the search
// never saw), fetched fresh from Alpaca (IEX feed), against simply holding SPY over the same days. Each rule name may be
// checked only once — results are kept in research/lab/final.jsonl and a rerun of the same name is refused, so nobody can
// peek, tweak and re-check. Needs NIGHT_DESK_ALPACA_KEY/_SECRET (Secret Manager). Claude runs this, not the searcher.
//   npx tsx scripts/final-check.ts
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { bars, type Bar } from "../src/alpaca.js";
import { SECTOR_ETFS } from "../src/universe.js";
import { portfolioBacktest } from "../src/portfolio.js";
import { sharpe, maxDrawdown } from "../src/scoring.js";

const COST_PER_SIDE = 0.0005;
const search = JSON.parse(readFileSync(new URL("../research/data/etf-search.json", import.meta.url), "utf8"));
const lockDate: string = search.lockDate;

const full: Record<string, Bar[]> = {};
for (const s of SECTOR_ETFS) full[s] = await bars(s, "1Day", 3000);
const start = Object.values(full).map((b) => b[0].t).sort().at(-1)!;
for (const s of Object.keys(full)) full[s] = full[s].filter((b) => b.t >= start);
(globalThis as any).__NIGHT_DESK_BARS = full; // candidates' cross-sector lookups see the same full history
const { CANDIDATES, FINALISTS } = await import("../research/lab/candidates.js");

const finalFile = new URL("../research/lab/final.jsonl", import.meta.url);
const done = new Set(existsSync(finalFile) ? readFileSync(finalFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).name) : []);

function stats(eq: number[]) {
  const dr = eq.slice(1).map((v, i) => v / eq[i] - 1);
  return { ret: eq.at(-1)! / eq[0] - 1, sharpe: sharpe(dr, Math.sqrt(252)), maxDD: maxDrawdown(eq) };
}
const spyLocked = full.SPY.filter((b) => b.t >= lockDate);
const spy = stats(spyLocked.map((b) => b.c));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`LOCKED year ${lockDate.slice(0, 10)} → ${spyLocked.at(-1)!.t.slice(0, 10)} (${spyLocked.length} sessions), Alpaca IEX.`);
console.log(`SPY hold: ret ${pct(spy.ret)} Sharpe ${spy.sharpe.toFixed(2)} maxDD ${pct(spy.maxDD)}\n`);

if (FINALISTS.length > 3) throw new Error("max 3 finalists");
const history = new Map(Object.entries(full));
for (const name of FINALISTS) {
  if (done.has(name)) { console.log(`${name}\n  REFUSED: already checked once (see final.jsonl)\n`); continue; }
  const rule = CANDIDATES.find((r: any) => r.name === name);
  if (!rule) { console.log(`${name}\n  not found in CANDIDATES\n`); continue; }
  const r = portfolioBacktest(history, rule, { maxConcurrent: rule.slots ?? history.size, costPerSide: COST_PER_SIDE });
  const a = r.dates.findIndex((d) => d >= lockDate);
  const s = stats(r.equity.slice(a));
  const trades = r.trades.filter((t) => t.exitDate >= lockDate).length;
  const verdict = s.ret > spy.ret ? (s.sharpe > spy.sharpe ? "BEAT SPY (return and Sharpe)" : "beat SPY return, not Sharpe") : s.sharpe > spy.sharpe ? "lower return, better Sharpe" : "did NOT beat SPY";
  console.log(`${name}\n  locked: ret ${pct(s.ret)} Sharpe ${s.sharpe.toFixed(2)} maxDD ${pct(s.maxDD)} trades ${trades} -> ${verdict}\n`);
  appendFileSync(finalFile, JSON.stringify({ at: new Date().toISOString(), name, lockDate, ret: s.ret, sharpe: s.sharpe, maxDD: s.maxDD, trades, spy, verdict }) + "\n");
}
