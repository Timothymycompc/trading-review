// EUR/USD "everything" system (Tim): EMA 35/68 trend + 5/16 cross trigger + Bollinger(20,2) position + ATR volatility gate
// + strong-candle confirmation, with trade management: initial 1.5×ATR stop, breakeven at +1×ATR, then 2×ATR trailing
// stop; also exit on a close past EMA 68. Rules FIXED before results. Signal on close, fill next open; stops fill at the
// stop price, or at the open if price gaps through it. 1.4 pips per round trip; overnight financing NOT included.
// Also runs the same entries WITHOUT stops (exit only on close past EMA 68) to show what the stops add.
//   npx tsx scripts/fx-combo.ts
import { readFileSync } from "node:fs";

interface C { t: string; o: number; h: number; l: number; c: number }
const PIP = 0.0001, COST_RT = 1.4;
const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map((x) => (e = x * k + e * (1 - k))); };
const rollMean = (xs: number[], n: number) => xs.map((_, i) => (i >= n - 1 ? xs.slice(i - n + 1, i + 1).reduce((a, x) => a + x, 0) / n : NaN));
const rollSd = (xs: number[], n: number, m: number[]) => xs.map((_, i) => (i >= n - 1 ? Math.sqrt(xs.slice(i - n + 1, i + 1).reduce((a, x) => a + (x - m[i]) ** 2, 0) / n) : NaN));

interface Trade { entryT: string; pips: number }
interface Opts { stops: boolean; initK?: number; beK?: number; trailK?: number; tpK?: number; session?: [number, number] }
function simulate(cs: C[], o: Opts): Trade[] {
  const useStops = o.stops, initK = o.initK ?? 1.5, beK = o.beK ?? 1, trailK = o.trailK ?? 2, tpK = o.tpK ?? 0; // trailK 0 = no trail; tpK 0 = no take-profit
  const cl = cs.map((b) => b.c), e5 = ema(cl, 5), e16 = ema(cl, 16), e35 = ema(cl, 35), e68 = ema(cl, 68);
  const mid = rollMean(cl, 20), sd = rollSd(cl, 20, mid);
  const tr = cs.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - cs[i - 1].c), Math.abs(b.l - cs[i - 1].c)) : b.h - b.l));
  const atr = ema(tr, 14), atrAvg = rollMean(atr, 100);
  const trades: Trade[] = [];
  let pos = 0, entry = 0, stop = 0, atrE = 0, best = 0, beHit = false, entryT = "", dir = 0, crossAt = -1;
  const exit = (px: number) => { trades.push({ entryT, pips: (pos * (px - entry)) / PIP - COST_RT }); pos = 0; };

  for (let i = 140; i < cs.length - 1; i++) {
    const b = cs[i];
    const d = e5[i] > e16[i] ? 1 : -1;
    if (d !== dir) { dir = d; crossAt = i; }
    if (pos !== 0) {
      // 1) stop check inside this candle
      if (useStops) {
        if (pos > 0 && b.o <= stop) { exit(b.o); continue; }
        if (pos < 0 && b.o >= stop) { exit(b.o); continue; }
        if (pos > 0 && b.l <= stop) { exit(stop); continue; }
        if (pos < 0 && b.h >= stop) { exit(stop); continue; }
        // take-profit (checked after the stop: if both are hit in one candle, assume the stop came first — conservative)
        if (tpK > 0) {
          const tp = entry + pos * tpK * atrE;
          if (pos > 0 && b.o >= tp) { exit(b.o); continue; }
          if (pos < 0 && b.o <= tp) { exit(b.o); continue; }
          if (pos > 0 && b.h >= tp) { exit(tp); continue; }
          if (pos < 0 && b.l <= tp) { exit(tp); continue; }
        }
      }
      // 2) end-of-candle updates: breakeven, trailing, trend exit
      best = pos > 0 ? Math.max(best, b.c) : Math.min(best, b.c);
      if (useStops) {
        if (!beHit && pos * (b.c - entry) >= beK * atrE) { beHit = true; stop = pos > 0 ? Math.max(stop, entry) : Math.min(stop, entry); }
        if (beHit && trailK > 0) stop = pos > 0 ? Math.max(stop, best - trailK * atr[i]) : Math.min(stop, best + trailK * atr[i]);
      }
      if ((pos > 0 && b.c < e68[i]) || (pos < 0 && b.c > e68[i])) { exit(cs[i + 1].o); continue; }
    }
    if (pos === 0) {
      const trend = e35[i] > e68[i] ? 1 : -1;
      const crossOk = dir === trend && i - crossAt <= 3;
      const bbOk = trend > 0 ? b.c > mid[i] && b.c < mid[i] + 2 * sd[i] : b.c < mid[i] && b.c > mid[i] - 2 * sd[i];
      const volOk = atr[i] > atrAvg[i];
      const r = b.h - b.l, candleOk = r > 0 && Math.abs(b.c - b.o) >= 0.5 * r && Math.sign(b.c - b.o) === trend;
      // Time of day: the entry fills at the next candle's open — only allow it inside the session (UTC hours, [start, end)).
      const h = new Date(cs[i + 1].t).getUTCHours();
      const sessOk = !o.session || (h >= o.session[0] && h < o.session[1]);
      if (crossOk && bbOk && volOk && candleOk && sessOk) {
        pos = trend; entry = cs[i + 1].o; atrE = atr[i]; stop = entry - pos * initK * atrE; best = entry; beHit = false; entryT = cs[i + 1].t;
      }
    }
  }
  return trades;
}

const periods: [string, string, string][] = [["2016–2021", "2016", "2022"], ["2022–Nov 2025", "2022", "2025-11-09"], ["last 12 months", "2025-11-09", "9999"]];
function line(ts: Trade[]) {
  const pips = ts.reduce((a, t) => a + t.pips, 0), wins = ts.filter((t) => t.pips > 0);
  const gw = wins.reduce((a, t) => a + t.pips, 0), gl = -ts.filter((t) => t.pips <= 0).reduce((a, t) => a + t.pips, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pips; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return `${pips.toFixed(0).padStart(6)} pips  trades ${String(ts.length).padStart(4)}  win ${(ts.length ? (100 * wins.length) / ts.length : 0).toFixed(0).padStart(2)}%  PF ${(gl ? gw / gl : 0).toFixed(2)}  maxDD ${dd.toFixed(0)}`;
}
const gransArg = process.argv[2]?.split(",") ?? ["H1", "H4", "D"];
const LONDON_NY: [number, number] = [7, 17]; // 07:00–17:00 UTC = London open to NY afternoon
const variants: [string, Opts][] = [
  ["no stops (exit past EMA 68)", { stops: false }],
  ["stops 1.5 / BE 1 / trail 2  (the fixed system)", { stops: true }],
  ["stops 1.0 / BE 1 / trail 2", { stops: true, initK: 1.0 }],
  ["stops 2.0 / BE 1 / trail 2", { stops: true, initK: 2.0 }],
  ["stops 1.5 / BE 0.5 / trail 2", { stops: true, beK: 0.5 }],
  ["stops 1.5 / BE 1.5 / trail 2", { stops: true, beK: 1.5 }],
  ["stops 1.5 / BE 1 / trail 1.5", { stops: true, trailK: 1.5 }],
  ["stops 1.5 / BE 1 / trail 3", { stops: true, trailK: 3 }],
  ["fixed system + London/NY hours only", { stops: true, session: LONDON_NY }],
];
console.log("pips: 2016–2021 | 2022–Nov 2025 | last 12 months   (✓ = positive in all three)");
if (process.argv[3] !== "grid") for (const gran of gransArg) {
  const cs: C[] = JSON.parse(readFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), "utf8")).candles;
  console.log(`\n=== EUR/USD ${gran} ===`);
  for (const [name, o] of variants) {
    const ts = simulate(cs, o);
    const per = periods.map(([, a, b]) => ts.filter((t) => t.entryT >= a && t.entryT < b));
    const pp = per.map((x) => x.reduce((a, t) => a + t.pips, 0));
    console.log(`${pp.every((x) => x > 0) ? "✓" : " "} ${name.padEnd(46)} ${pp.map((x) => x.toFixed(0).padStart(5)).join(" |")}   trades ${per.map((x) => x.length).join("/")}`);
  }
}

// GRID: every initial stop × trailing stop × take-profit (breakeven at +1 ATR), all-hours and London/NY.
//   npx tsx scripts/fx-combo.ts H4 grid
if (process.argv[3] === "grid") {
  const gran = gransArg[0];
  const cs: C[] = JSON.parse(readFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), "utf8")).candles;
  const inits = [1, 1.5, 2], trails = [0, 1, 1.5, 2, 2.5, 3], tps = [0, 1.5, 2, 3, 4];
  for (const session of [undefined, LONDON_NY]) {
    let n = 0, pass = 0, posAll = 0;
    console.log(`\n##### GRID ${gran} ${session ? "London/NY hours" : "all hours"} — cell = total pips 2016→now, ✓ = positive in all 3 periods`);
    for (const initK of inits) {
      console.log(`initial stop ${initK} ATR     ` + tps.map((t) => (t ? `TP ${t}` : "no TP").padStart(9)).join(""));
      for (const trailK of trails) {
        const cells = tps.map((tpK) => {
          const ts = simulate(cs, { stops: true, initK, trailK, tpK, session });
          const pp = periods.map(([, a, b]) => ts.filter((t) => t.entryT >= a && t.entryT < b).reduce((x, t) => x + t.pips, 0));
          const tot = pp.reduce((a, x) => a + x, 0), ok = pp.every((x) => x > 0);
          n++; if (ok) pass++; if (tot > 0) posAll++;
          return `${tot.toFixed(0)}${ok ? "✓" : " "}`.padStart(9);
        });
        console.log(`  trail ${trailK ? trailK + " ATR" : "none  "}`.padEnd(24) + cells.join(""));
      }
    }
    console.log(`=> ${pass}/${n} settings positive in ALL 3 periods; ${posAll}/${n} positive overall`);
  }
}
