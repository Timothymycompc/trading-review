// Candidate rules for scripts/rule-lab.ts. agy edits THIS file. Each rule: long-only, next-open entries/exits.
//   enter(bars, i, symbol) / exit(bars, i, symbol): may read bars[0..i] only (bars[i] is today's close; no future).
//   holdDays: max days held (use 100000 for "until exit fires"). stopPct: optional stop. slots: max positions at once
//   (capital split equally; default = all 13 ETFs). For cross-sector rules (e.g. "hold the top 3 by momentum"), use
//   OTHER symbols' bars from ALL below — but only bars dated <= bars[i].t (use upTo()).
import { readFileSync } from "node:fs";
import type { Bar } from "../../src/alpaca.js";
import type { Rule } from "../../src/backtest.js";
import { sma } from "../../src/signals.js";

// The final check injects the full history (including the locked year) through globalThis; the lab uses search data.
export const ALL: Record<string, Bar[]> = (globalThis as any).__NIGHT_DESK_BARS
  ?? JSON.parse(readFileSync(new URL("../data/etf-search.json", import.meta.url), "utf8")).bars;
/** Another symbol's bars up to and including date t (no lookahead). */
export const upTo = (symbol: string, t: string): Bar[] => (ALL[symbol] ?? []).filter((b) => b.t <= t);

export const CANDIDATES: Rule[] = [
  {
    name: "SANITY: hold SPY only (should match SPY hold)",
    warmup: 0,
    enter: (_b, _i, s) => s === "SPY",
    holdDays: 100000,
    slots: 1,
  },
  // Finalist 1: Trend persistence (close & SMA20 >= SMA200) + panic mean reversion (< 0.95 * SMA20); exit below SMA200 on bounce to SMA20
  {
    name: "Trend + panic reversion (no band): SPY (c>=SMA200 & SMA20>=SMA200) or panic < 0.95*SMA20",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 == null || s20 == null || (w[i].c >= s200 && s20 >= s200) || w[i].c < s20 * 0.95;
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 != null && s20 != null && w[i].c < s200 && w[i].c >= s20;
    },
    holdDays: 100000,
    slots: 1,
  },
  // Finalist 2: Nearby-parameter companion (SMA15 / SMA200 + 5% panic reversion)
  {
    name: "Trend + panic reversion (SMA15/200): SPY (c>=SMA200 & SMA15>=SMA200) or panic < 0.95*SMA15",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s15 = sma(w, 15), s200 = sma(w, 200);
      return s200 == null || s15 == null || (w[i].c >= s200 && s15 >= s200) || w[i].c < s15 * 0.95;
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s15 = sma(w, 15), s200 = sma(w, 200);
      return s200 != null && s15 != null && w[i].c < s200 && w[i].c >= s15;
    },
    holdDays: 100000,
    slots: 1,
  },
  // Finalist 3: Pure 2-parameter trend persistence (close & SMA20 >= SMA200, exit when both < SMA200)
  {
    name: "Trend persistence: SPY close >= SMA200 and SMA20 >= SMA200 (exit both < SMA200)",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 == null || s20 == null || (w[i].c >= s200 && s20 >= s200);
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 != null && s20 != null && w[i].c < s200 && s20 < s200;
    },
    holdDays: 100000,
    slots: 1,
  },
  // Nearby-parameter check: SMA20 / SMA180 + 5% panic reversion
  {
    name: "Trend + panic reversion (SMA20/180): SPY (c>=SMA180 & SMA20>=SMA180) or panic < 0.95*SMA20",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s180 = sma(w, 180);
      return s180 == null || s20 == null || (w[i].c >= s180 && s20 >= s180) || w[i].c < s20 * 0.95;
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s180 = sma(w, 180);
      return s180 != null && s20 != null && w[i].c < s180 && w[i].c >= s20;
    },
    holdDays: 100000,
    slots: 1,
  },
  // Nearby-parameter check: -4% panic threshold (< 0.96 * SMA20)
  {
    name: "Trend + panic reversion (4% param): SPY (c>=SMA200 & SMA20>=SMA200) or panic < 0.96*SMA20",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 == null || s20 == null || (w[i].c >= s200 && s20 >= s200) || w[i].c < s20 * 0.96;
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 != null && s20 != null && w[i].c < s200 * 0.99 && w[i].c >= s20;
    },
    holdDays: 100000,
    slots: 1,
  },
  // Nearby-parameter check: -6% panic threshold (< 0.94 * SMA20)
  {
    name: "Trend + panic reversion (6% param): SPY (c>=SMA200 & SMA20>=SMA200) or panic < 0.94*SMA20",
    warmup: 0,
    enter: (b, i, s) => {
      if (s !== "SPY") return false;
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 == null || s20 == null || (w[i].c >= s200 && s20 >= s200) || w[i].c < s20 * 0.94;
    },
    exit: (b, i) => {
      const w = b.slice(0, i + 1), s20 = sma(w, 20), s200 = sma(w, 200);
      return s200 != null && s20 != null && w[i].c < s200 * 0.99 && w[i].c >= s20;
    },
    holdDays: 100000,
    slots: 1,
  },
];

// Up to 3 rule names (exactly as in CANDIDATES) to send to the ONE-SHOT final check on the locked year.
export const FINALISTS: string[] = [
  "Trend + panic reversion (no band): SPY (c>=SMA200 & SMA20>=SMA200) or panic < 0.95*SMA20",
  "Trend + panic reversion (SMA15/200): SPY (c>=SMA200 & SMA15>=SMA200) or panic < 0.95*SMA15",
  "Trend persistence: SPY close >= SMA200 and SMA20 >= SMA200 (exit both < SMA200)",
];
