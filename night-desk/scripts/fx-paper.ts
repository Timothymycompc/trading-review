// FX PAPER TRADER (forward test). Runs hourly on Cloud Run. Two parts:
//  1) SHADOW LEDGER for all 4 keeper systems (research/fx/FINDINGS.md): re-runs the exact backtest code (src/fxSystem.ts)
//     on live Oanda candles and counts only trades ENTERED on/after START. No orders. Same costs as the backtest.
//  2) REAL DEMO ORDERS for the daily trend system only, on the Primary practice account, 100 units (1 cent a pip):
//     opens when the system opens (with its take-profit as a real Oanda order), closes when the system exits.
// Each run's snapshot goes to gs://$FX_PAPER_BUCKET/fx-paper/ (latest.json + history/), so results can't be rewritten.
//   OANDA_PRACTICE_TOKEN=... npx tsx scripts/fx-paper.ts            (shadow only, prints)
//   ... --orders                                                     (also manage the real demo trade)
import { readFileSync } from "node:fs";
import { prepare, simulateFull, type Candle, type Mgmt, type Trade } from "../src/fxSystem.js";
import { candles, openTrades, marketOrder, closeTrade, accountSummary } from "../src/oanda.js";

const START = process.env.FX_PAPER_START ?? "2026-11-09T00:00:00Z";            // forward test start: only trades entered from here count
const DEMO_ACCOUNT = process.env.OANDA_DEMO_ACCOUNT ?? ""; // your practice sub-account id (101-...)
const DEMO_UNITS = 100, DEMO_TAG = "nd-daily";
const placeOrders = process.argv.includes("--orders");

const TREND: { name: string; gran: string; count: number; bollinger: boolean; m: Mgmt }[] = [
  { name: "Daily trend (no BB, no stop, TP 4 ATR)", gran: "D", count: 500, bollinger: false, m: { initK: 0, beK: 0, trailK: 0, tpK: 4, trendExit: true } },
  { name: "4h trend A (SL2 BE2 trail1 TP6)", gran: "H4", count: 1500, bollinger: true, m: { initK: 2, beK: 2, trailK: 1, tpK: 6, trendExit: true } },
  { name: "4h trend B (London/NY, SL1.5 BE1 trail2)", gran: "H4", count: 1500, bollinger: true, m: { initK: 1.5, beK: 1, trailK: 2, tpK: 0, trendExit: true, session: [7, 17] } },
];
// FOMC day: sell USD 17:00 NY the evening before a scheduled statement → buy back 17:00 NY on the day.
const FOMC_PAIRS: [string, number, number][] = [["EUR_USD", 1, 1.5], ["GBP_USD", 1, 1.9], ["USD_JPY", -1, 1.5], ["AUD_USD", 1, 1.4]]; // pair, +1 = buy pair to sell USD, backtest cost
const fomcDates: string[] = JSON.parse(readFileSync(new URL("../research/fx/fomc-dates.json", import.meta.url), "utf8")).dates.filter((x: any) => x.scheduled).map((x: any) => x.date);
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
const ny = (t: string) => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }; };

const sum = (ts: { pips: number }[]) => ts.reduce((a, t) => a + t.pips, 0);
const now = new Date().toISOString();
const snapshot: any = { runAt: now, start: START, source: "Oanda v20 practice candles (mid; bid/ask spread)", systems: [], fomc: [], demo: null };

// ---- 1) shadow ledger: trend systems on EUR/USD
let dailyOpen: ReturnType<typeof simulateFull>["open"] = null, dailyLastCandle: Candle | null = null;
for (const s of TREND) {
  const cs = await candles("EUR_USD", s.gran, s.count);
  const r = simulateFull(prepare(cs, 0.0001, 1.5, { bollinger: s.bollinger }), s.m);
  const fwd: Trade[] = r.trades.filter((t) => t.entryT >= START);
  const open = r.open && r.open.entryT >= START ? r.open : null;
  const last = cs.at(-1)!;
  const openPips = open ? (open.dir * (last.c - open.entry)) / 0.0001 - 1.5 : null;
  snapshot.systems.push({ name: s.name, closedTrades: fwd, closedPips: sum(fwd), open, openPips, liveSpreadPips: last.spread / 0.0001, lastCandle: last.t,
    note: r.open && !open ? `system was already in a trade from ${r.open.entryT} (before START) — not counted` : undefined });
  if (s.gran === "D") { dailyOpen = open; dailyLastCandle = last; }
}

// ---- FOMC shadow trades (only meetings on/after START)
for (const [pair, sellUsd, cost] of FOMC_PAIRS) {
  const pip = pair.includes("JPY") ? 0.01 : 0.0001;
  const cs = await candles(pair, "H1", 500); // ~3 weeks
  const at17 = new Map<string, Candle>(); for (const c of cs) { const n = ny(c.t); if (n.hour === 17) at17.set(n.date, c); }
  for (const d of fomcDates.filter((x) => x >= START.slice(0, 10))) {
    const prev = [...at17.keys()].filter((k) => k < d).sort().at(-1);
    const entry = prev ? at17.get(prev) : undefined, exit = at17.get(d);
    if (!entry) continue; // not started yet (or out of the candle window)
    const px = exit ? exit.o : cs.at(-1)!.c;
    snapshot.fomc.push({ pair, date: d, status: exit ? "closed" : "open", entryT: entry.t, pips: (sellUsd * (px - entry.o)) / pip - cost });
  }
}
const nextFomc = fomcDates.find((d) => d >= now.slice(0, 10));
snapshot.nextFomc = nextFomc;

// ---- 2) real demo orders: daily trend system only
if (placeOrders) {
  const mine = (await openTrades(DEMO_ACCOUNT)).filter((t) => t.tag === DEMO_TAG);
  const actions: string[] = [];
  if (dailyOpen && mine.length === 0) {
    const res = await marketOrder(DEMO_ACCOUNT, "EUR_USD", dailyOpen.dir * DEMO_UNITS, DEMO_TAG, dailyOpen.tp ?? undefined);
    actions.push(`opened ${dailyOpen.dir > 0 ? "long" : "short"} ${DEMO_UNITS} EUR_USD (system entry ${dailyOpen.entry}, TP ${dailyOpen.tp?.toFixed(5)}) → ${res.orderFillTransaction ? "filled " + res.orderFillTransaction.price : JSON.stringify(res).slice(0, 200)}`);
  } else if (!dailyOpen && mine.length) {
    for (const t of mine) { await closeTrade(DEMO_ACCOUNT, t, DEMO_TAG); actions.push(`closed trade ${t.id} (system exited)`); }
  }
  const acct = await accountSummary(DEMO_ACCOUNT);
  snapshot.demo = { account: DEMO_ACCOUNT, units: DEMO_UNITS, actions, ourTrades: (await openTrades(DEMO_ACCOUNT)).filter((t) => t.tag === DEMO_TAG), balance: acct.balance, nav: acct.nav };
}

// ---- totals + output
snapshot.totals = {
  trendPips: snapshot.systems.reduce((a: number, s: any) => a + s.closedPips, 0),
  fomcPips: snapshot.fomc.filter((x: any) => x.status === "closed").reduce((a: number, x: any) => a + x.pips, 0),
};
const brief = [
  `FX paper ${now.slice(0, 16)}Z (since ${START.slice(0, 10)}): trend ${snapshot.totals.trendPips.toFixed(0)} pips closed, FOMC ${snapshot.totals.fomcPips.toFixed(0)} pips closed, next FOMC ${nextFomc}`,
  ...snapshot.systems.map((s: any) => `  ${s.name}: ${s.closedTrades.length} closed (${s.closedPips.toFixed(0)} pips)${s.open ? `, OPEN ${s.open.dir > 0 ? "long" : "short"} since ${s.open.entryT.slice(0, 16)} (${s.openPips.toFixed(0)} pips)` : ""}${s.note ? " — " + s.note : ""}`),
  ...(snapshot.demo ? [`  demo ${snapshot.demo.account}: ${snapshot.demo.actions.join("; ") || "no action"}; our trades ${snapshot.demo.ourTrades.length}; NAV ${snapshot.demo.nav}`] : []),
];
console.log(brief.join("\n"));

const bucket = process.env.FX_PAPER_BUCKET;
if (bucket) {
  const tok = (await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json()).access_token;
  for (const name of ["fx-paper/latest.json", `fx-paper/history/${now.replace(/[:.]/g, "-")}.json`]) {
    const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(snapshot, null, 1) });
    if (!r.ok) console.error("upload failed", name, r.status, (await r.text()).slice(0, 200));
  }
}
