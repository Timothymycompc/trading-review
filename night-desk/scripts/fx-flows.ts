// "Forced trader" FX effects from published papers — rules FIXED from the papers and committed BEFORE the first run.
//
// 1) FOMC day (Mueller, Tahbaz-Salehi & Vedolin, Journal of Finance 2017): short the US dollar over scheduled FOMC
//    announcement days. Rule: sell USD at 17:00 New York the evening before a scheduled announcement, buy back 17:00 NY
//    on announcement day. Dates: research/fx/fomc-dates.json (federalreserve.gov, scheduled only).
// 2) Month-end hedge rebalancing (Melvin & Prins, Journal of Financial Markets 2015): if US stocks beat the foreign stock
//    market month-to-date, foreign holders of US stocks must sell USD to top up hedges at the month-end London 4pm fix.
//    Rule: on the last trading day of each month, diff = MTD(S&P 500) − MTD(foreign index, local currency), both up to the
//    previous day's close. diff > 0 → sell USD, else buy USD. Enter 10:00 UTC, exit at the London 16:00 fix.
//
// Pairs: EUR/USD (Euro Stoxx 50), GBP/USD (FTSE 100), USD/JPY (Nikkei 225), AUD/USD (ASX 200). Prices: Oanda practice
// candles (H1 FX, daily index CFDs). Cost: each pair's measured median spread. Financing ignored (≤1 day holds).
// Each effect is compared with doing the same thing on ALL OTHER days — the effect must beat that, not just be positive.
//   npx tsx scripts/fx-flows.ts
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const dump: Record<string, { d: string; pips: number }[]> = {};

interface C { t: string; o: number; c: number }
const load = (f: string) => JSON.parse(readFileSync(new URL(`../research/fx/${f}.json`, import.meta.url), "utf8"));
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
const ny = (t: string) => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }; };
const londonFixUtcHour = (date: string) => { // 16:00 London in UTC: 15 in summer time (BST), 16 in winter
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(`${date}T16:00:00Z`));
  return Number(h) === 17 ? 15 : 16;
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const tstat = (a: number[]) => { const m = mean(a), sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); return sd ? m / (sd / Math.sqrt(a.length)) : 0; };
const periods: [string, string, string][] = [["2005–2015", "2005", "2016"], ["2016–2021", "2016", "2022"], ["2022–Nov 2025", "2022", "2025-11-09"], ["last 12 months", "2025-11-09", "9999"]];
function report(label: string, ev: { d: string; pips: number }[], other: number[]) {
  const per = periods.map(([n, a, b]) => { const x = ev.filter((e) => e.d >= a && e.d < b).map((e) => e.pips); return x.length ? `${n} ${x.reduce((p, q) => p + q, 0).toFixed(0)} (${x.length})` : null; }).filter(Boolean);
  const p = ev.map((e) => e.pips);
  console.log(`  ${label.padEnd(9)} n ${String(p.length).padStart(3)}  total ${p.reduce((a, b) => a + b, 0).toFixed(0).padStart(6)} pips  avg ${mean(p).toFixed(1).padStart(5)}  win ${Math.round((100 * p.filter((x) => x > 0).length) / (p.length || 1))}%  t ${tstat(p).toFixed(2).padStart(5)} | other days avg ${mean(other).toFixed(1)} (t ${tstat(other).toFixed(2)})`);
  console.log(`            ${per.join(" | ")}`);
}

// pair → [H1 files, foreign index, +1 if selling USD means BUYING the pair]
const PAIRS: [string, string[], string, number][] = [
  ["EUR_USD", ["EUR_USD_H1_2005-2015", "EUR_USD_H1"], "EU50_EUR", 1],
  ["GBP_USD", ["GBP_USD_H1"], "UK100_GBP", 1],
  ["USD_JPY", ["USD_JPY_H1"], "JP225_USD", -1],
  ["AUD_USD", ["AUD_USD_H1"], "AU200_AUD", 1],
];
const fomc = new Set<string>(load("fomc-dates").dates.filter((x: any) => x.scheduled).map((x: any) => x.date));
const spx: C[] = load("SPX500_USD_D").candles;
// daily index candle covers [t, t+24h); its close is the NEXT UTC date's 17:00 NY — key closes by that trading date
const closeByDate = (cs: C[]) => new Map(cs.map((c) => [new Date(Date.parse(c.t) + 864e5).toISOString().slice(0, 10), c.c]));
const spxClose = closeByDate(spx);

for (const [pair, files, idx, sellUsd] of PAIRS) {
  const cs: C[] = files.filter((f) => existsSync(new URL(`../research/fx/${f}.json`, import.meta.url))).flatMap((f) => load(f).candles);
  const meta = load(files.at(-1)!), pip = pair.includes("JPY") ? 0.01 : 0.0001, cost = meta.medianSpreadPips ?? 1.5;
  console.log(`\n=== ${pair} (cost ${Number(cost).toFixed(1)} pips) ===`);

  // ---- 1) FOMC day: 17:00 NY day-before → 17:00 NY announcement day, short USD
  const boundary = new Map<string, number>(); // NY date → index of the H1 candle starting at 17:00 NY that day
  cs.forEach((c, i) => { const n = ny(c.t); if (n.hour === 17) boundary.set(n.date, i); });
  const days = [...boundary.keys()].sort();
  const fomcEv: { d: string; pips: number }[] = [], fomcOther: number[] = [];
  for (let k = 1; k < days.length; k++) {
    const a = boundary.get(days[k - 1])!, b = boundary.get(days[k])!;
    const pips = (sellUsd * (cs[b].o - cs[a].o)) / pip - cost;
    if (fomc.has(days[k])) fomcEv.push({ d: days[k], pips }); else fomcOther.push(pips);
  }
  report("FOMC", fomcEv, fomcOther);
  dump[pair] = fomcEv;

  // ---- 2) Month-end: last trading day, 10:00 UTC → London 16:00 fix, direction from MTD equity difference
  const foreignClose = closeByDate(load(`${idx}_D`).candles);
  const byUtcDate = new Map<string, Map<number, number>>(); // UTC date → hour → candle index
  cs.forEach((c, i) => { const d = c.t.slice(0, 10), h = Number(c.t.slice(11, 13)); (byUtcDate.get(d) ?? byUtcDate.set(d, new Map()).get(d)!).set(h, i); });
  const tradingDays = [...byUtcDate.keys()].filter((d) => { const wd = new Date(d + "T12:00:00Z").getUTCDay(); return wd >= 1 && wd <= 5 && byUtcDate.get(d)!.has(10); }).sort();
  const lastOfMonth = new Set(tradingDays.filter((d, i) => tradingDays[i + 1]?.slice(0, 7) !== d.slice(0, 7) && i + 1 < tradingDays.length));
  const spxDates = [...spxClose.keys()].sort(), fDates = [...foreignClose.keys()].sort();
  const lastBefore = (arr: string[], d: string) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] < d) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r >= 0 ? arr[r] : null; };
  const meEv: { d: string; pips: number }[] = [], meOther: number[] = [];
  for (const d of tradingDays) {
    const hours = byUtcDate.get(d)!, fixH = londonFixUtcHour(d);
    if (!hours.has(10) || !hours.has(fixH)) continue;
    const monthStart = d.slice(0, 8) + "01";
    const s1 = lastBefore(spxDates, d), s0 = lastBefore(spxDates, monthStart), f1 = lastBefore(fDates, d), f0 = lastBefore(fDates, monthStart);
    if (!s1 || !s0 || !f1 || !f0 || s1 <= s0 || f1 <= f0) continue;
    const diff = spxClose.get(s1)! / spxClose.get(s0)! - (foreignClose.get(f1)! / foreignClose.get(f0)!);
    const dir = diff > 0 ? sellUsd : -sellUsd;
    const pips = (dir * (cs[hours.get(fixH)!].o - cs[hours.get(10)!].o)) / pip - cost;
    if (lastOfMonth.has(d)) meEv.push({ d, pips }); else meOther.push(pips);
  }
  report("Month-end", meEv, meOther);
}

writeFileSync(new URL("../research/fx/fomc-events.json", import.meta.url), JSON.stringify(dump));
