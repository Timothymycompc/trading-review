// EUR/USD EMA ribbon 5/16/35/68 (Tim's idea: 35 and 68 act like a band price bounces off in a trend). Oanda practice
// candles. Four interpretations FIXED before looking at results. Signal on close, fill next open, 1.4 pips per round trip.
// Overnight financing NOT included.   npx tsx scripts/fx-ribbon.ts
import { readFileSync } from "node:fs";

interface C { t: string; o: number; h: number; l: number; c: number }
const PIP = 0.0001, COST_SIDE = 0.7;
const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map((x) => (e = x * k + e * (1 - k))); };
const engulf = (p: C, b: C, dir: number) => dir > 0
  ? p.c < p.o && b.c > b.o && b.c >= p.o && b.o <= p.c
  : p.c > p.o && b.c < b.o && b.c <= p.o && b.o >= p.c;

type Mode = "stack" | "stackHold" | "bounce" | "bounceEngulf" | "crossEngulf";
type Gate = "none" | "highVol" | "lowVol";
function targets(cs: C[], mode: Mode, gate: Gate = "none"): number[] {
  const cl = cs.map((b) => b.c), e5 = ema(cl, 5), e16 = ema(cl, 16), e35 = ema(cl, 35), e68 = ema(cl, 68);
  // Volatility reference: ATR(14) vs its own 100-candle average (both use candles up to i only).
  const tr = cs.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - cs[i - 1].c), Math.abs(b.l - cs[i - 1].c)) : b.h - b.l));
  const atr = ema(tr, 14); const atrAvg = atr.map((_, i) => (i >= 100 ? atr.slice(i - 99, i + 1).reduce((a, x) => a + x, 0) / 100 : NaN));
  const gateOk = (i: number) => gate === "none" || (gate === "highVol" ? atr[i] > atrAvg[i] : atr[i] < atrAvg[i]);
  const tgt: number[] = []; let pos = 0, dir = 0, crossAt = -1;
  for (let i = 0; i < cs.length; i++) {
    if (i < 140) { tgt.push(0); continue; } // let the 68 EMA settle
    const b = cs[i];
    const up = e5[i] > e16[i] && e16[i] > e35[i] && e35[i] > e68[i], dn = e5[i] < e16[i] && e16[i] < e35[i] && e35[i] < e68[i];
    const prev = pos;
    const d = e5[i] > e16[i] ? 1 : -1;
    if (d !== dir) { dir = d; crossAt = i; if (mode === "crossEngulf") pos = 0; }
    if (mode === "crossEngulf") { if (pos === 0 && i - crossAt <= 3 && engulf(cs[i - 1], b, dir)) pos = dir; }
    else if (mode === "stack") pos = up ? 1 : dn ? -1 : 0;
    else if (mode === "stackHold") {
      if (pos === 1 && b.c < e68[i]) pos = 0;
      if (pos === -1 && b.c > e68[i]) pos = 0;
      if (pos === 0) pos = up ? 1 : dn ? -1 : 0;
    } else {
      const trend = e35[i] > e68[i] ? 1 : -1;
      // exits: close beyond the 68, or 5/16 cross against the position
      if (pos === 1 && (b.c < e68[i] || e5[i] < e16[i])) pos = 0;
      if (pos === -1 && (b.c > e68[i] || e5[i] > e16[i])) pos = 0;
      if (pos === 0) {
        const touched = trend > 0 ? b.l <= e35[i] && b.c > e35[i] : b.h >= e35[i] && b.c < e35[i];
        const candleOk = mode === "bounce" ? Math.sign(b.c - b.o) === trend : engulf(cs[i - 1], b, trend);
        if (touched && candleOk) pos = trend;
      }
    }
    if (pos !== prev && pos !== 0 && !gateOk(i)) pos = 0; // new entries only when the volatility gate agrees
    tgt.push(pos);
  }
  return tgt;
}

interface Stat { pips: number; trades: number; wins: number; maxDDpips: number; grossWin: number; grossLoss: number; bars: number }
function run(cs: C[], tgt: number[], from: string, to: string): Stat {
  const st: Stat = { pips: 0, trades: 0, wins: 0, maxDDpips: 0, grossWin: 0, grossLoss: 0, bars: 0 };
  let held = 0, peak = 0, tp = 0;
  const close = () => { if (held !== 0) { st.trades++; if (tp > 0) { st.wins++; st.grossWin += tp; } else st.grossLoss -= tp; } tp = 0; };
  for (let k = 1; k < cs.length - 1; k++) {
    if (cs[k].t < from || cs[k].t >= to) continue;
    const want = tgt[k - 1];
    if (want !== held) { st.pips -= Math.abs(want - held) * COST_SIDE; if (held !== 0) { tp -= COST_SIDE; close(); } held = want; if (held !== 0) tp -= COST_SIDE; }
    const p = (held * (cs[k + 1].o - cs[k].o)) / PIP; st.pips += p; tp += p; if (held) st.bars++;
    peak = Math.max(peak, st.pips); st.maxDDpips = Math.max(st.maxDDpips, peak - st.pips);
  }
  close();
  return st;
}

const periods: [string, string, string][] = [["2016–2021", "2016", "2022"], ["2022–Nov 2025", "2022", "2025-11-09"], ["last 12 months", "2025-11-09", "9999"]];
const names: Record<Mode, string> = { stack: "1 stacked", stackHold: "2 stacked, exit past 68", bounce: "3 bounce off 35", bounceEngulf: "4 bounce + engulfing", crossEngulf: "5/16 cross + engulfing" };
console.log("pips per period: 2016–2021 | 2022–Nov 2025 | last 12 months   (✓ = positive in all three)");
for (const gran of process.argv[2]?.split(",") ?? ["H1", "H4", "D"]) {
  const cs: C[] = JSON.parse(readFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), "utf8")).candles;
  console.log(`\n=== EUR/USD ${gran} ===`);
  for (const mode of Object.keys(names) as Mode[]) for (const gate of ["none", "highVol", "lowVol"] as Gate[]) {
    const tgt = targets(cs, mode, gate);
    const r = periods.map(([, a, b]) => run(cs, tgt, a, b));
    const ok = r.every((x) => x.pips > 0) ? "✓" : " ";
    console.log(`${ok} ${(names[mode] + " / " + gate).padEnd(34)} ${r.map((x) => x.pips.toFixed(0).padStart(6)).join(" |")}   trades ${r.map((x) => x.trades).join("/")}  maxDD ${Math.max(...r.map((x) => x.maxDDpips)).toFixed(0)}`);
  }
}
