// EUR/USD 5/16 crossover + Japanese-candle confirmation, on Oanda practice candles (research/fx/EUR_USD_<gran>.json).
// Rules are FIXED from Tim's description before looking at results — no tuning — so every year is out of sample.
// Execution: signal on a candle's close, filled at the NEXT candle's open. Cost: 1.4 pips per round trip (Oanda EUR/USD
// typical spread), 0.7 per side; a flip pays both. Overnight financing NOT included (it would make results worse).
//   npx tsx scripts/fx-candles.ts
import { readFileSync } from "node:fs";

interface C { t: string; o: number; h: number; l: number; c: number }
const PIP = 0.0001, COST_SIDE = 0.7;

const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map((x) => (e = x * k + e * (1 - k))); };
const sma = (xs: number[], n: number) => { let s = 0; return xs.map((x, i) => { s += x; if (i >= n) s -= xs[i - n]; return i >= n - 1 ? s / n : NaN; }); };

// Candle helpers (bar i only + bar i-1 for engulfing — no future).
const strong = (b: C, dir: number) => { const r = b.h - b.l; return r > 0 && Math.abs(b.c - b.o) >= 0.5 * r && Math.sign(b.c - b.o) === dir; };
const engulf = (p: C, b: C, dir: number) => dir > 0
  ? p.c < p.o && b.c > b.o && b.c >= p.o && b.o <= p.c
  : p.c > p.o && b.c < b.o && b.c <= p.o && b.o >= p.c;

type Mode = "flip" | "confirm" | "engulf";
function targets(cs: C[], kind: "EMA" | "SMA", mode: Mode): number[] {
  const closes = cs.map((b) => b.c);
  const f = kind === "EMA" ? ema(closes, 5) : sma(closes, 5), s = kind === "EMA" ? ema(closes, 16) : sma(closes, 16);
  const tgt: number[] = []; let pos = 0, crossAt = -1, dir = 0;
  for (let i = 0; i < cs.length; i++) {
    if (!(f[i] === f[i]) || !(s[i] === s[i]) || i < 16) { tgt.push(0); continue; }
    const d = f[i] > s[i] ? 1 : -1;
    if (d !== dir) { dir = d; crossAt = i; if (mode !== "flip") pos = 0; } // opposite cross: exit (filtered modes go flat)
    if (mode === "flip") pos = dir;
    else if (pos === 0 && i - crossAt <= 3) {
      if (mode === "confirm" && strong(cs[i], dir)) pos = dir;
      if (mode === "engulf" && i > 0 && engulf(cs[i - 1], cs[i], dir)) pos = dir;
    }
    tgt.push(pos);
  }
  return tgt;
}

interface Stat { pips: number; trades: number; wins: number; maxDDpips: number; grossWin: number; grossLoss: number }
function run(cs: C[], tgt: number[], from: string, to: string): Stat {
  const st: Stat = { pips: 0, trades: 0, wins: 0, maxDDpips: 0, grossWin: 0, grossLoss: 0 };
  let held = 0, peak = 0, tradePips = 0;
  const close = () => { if (held !== 0) { st.trades++; if (tradePips > 0) { st.wins++; st.grossWin += tradePips; } else st.grossLoss -= tradePips; } tradePips = 0; };
  for (let k = 1; k < cs.length - 1; k++) {
    if (cs[k].t < from || cs[k].t >= to) continue;
    const want = tgt[k - 1]; // decided at previous close, filled at this open
    if (want !== held) { const c = Math.abs(want - held) * COST_SIDE; st.pips -= c; if (held !== 0) { tradePips -= COST_SIDE; close(); } held = want; if (held !== 0) tradePips -= COST_SIDE; }
    const p = (held * (cs[k + 1].o - cs[k].o)) / PIP; st.pips += p; tradePips += p;
    peak = Math.max(peak, st.pips); st.maxDDpips = Math.max(st.maxDDpips, peak - st.pips);
  }
  close();
  return st;
}

const periods: [string, string, string][] = [["2016–2021", "2016", "2022"], ["2022–Nov 2025", "2022", "2025-11-09"], ["last 12 months", "2025-11-09", "9999"]];
const fmt = (s: Stat) => `${s.pips.toFixed(0).padStart(6)} pips  trades ${String(s.trades).padStart(5)}  win ${(s.trades ? (100 * s.wins) / s.trades : 0).toFixed(0).padStart(2)}%  PF ${(s.grossLoss ? s.grossWin / s.grossLoss : 0).toFixed(2)}  maxDD ${s.maxDDpips.toFixed(0)} pips`;

for (const gran of process.argv[2]?.split(",") ?? ["H1", "H4", "D"]) {
  const cs: C[] = JSON.parse(readFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), "utf8")).candles;
  console.log(`\n=== EUR/USD ${gran} (${cs.length} candles, Oanda practice, mid) ===`);
  const rules: [string, "EMA" | "SMA", Mode][] = [["EMA 5/16 flip", "EMA", "flip"], ["SMA 5/16 flip", "SMA", "flip"], ["EMA 5/16 + strong candle", "EMA", "confirm"], ["EMA 5/16 + engulfing", "EMA", "engulf"]];
  for (const [name, kind, mode] of rules) {
    const tgt = targets(cs, kind, mode);
    console.log(name);
    for (const [label, a, b] of periods) console.log(`  ${label.padEnd(15)} ${fmt(run(cs, tgt, a, b))}`);
  }
}
