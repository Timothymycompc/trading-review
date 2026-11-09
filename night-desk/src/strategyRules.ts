// Candidate rules to backtest. Plain, well-known setups — the backtest decides whether any of them survive out of sample.
// They are listed here so the count is explicit: trying more rules raises the multiple-testing (deflated-Sharpe) penalty.
import type { Rule } from "./backtest.js";
import { momentum, breakout, sma } from "./signals.js";

export const RULES: Rule[] = [
  {
    name: "20d momentum + 20d breakout, hold 10, stop 8%",
    warmup: 25,
    enter: (b, i) => (momentum(b.slice(0, i + 1), 20) ?? -1) > 0 && breakout(b.slice(0, i + 1), 20) === true,
    holdDays: 10,
    stopPct: 0.08,
  },
  {
    name: "60d momentum + above SMA50, hold 20, stop 10%",
    warmup: 60,
    enter: (b, i) => {
      const w = b.slice(0, i + 1), s = sma(w, 50);
      return (momentum(w, 60) ?? -1) > 0 && s != null && w[w.length - 1].c > s;
    },
    holdDays: 20,
    stopPct: 0.10,
  },
  {
    name: "pullback in an uptrend (above SMA50, 5d down), hold 10, stop 6%",
    warmup: 55,
    enter: (b, i) => {
      const w = b.slice(0, i + 1), s = sma(w, 50);
      return s != null && w[w.length - 1].c > s && (momentum(w, 5) ?? 1) < 0;
    },
    holdDays: 10,
    stopPct: 0.06,
  },
];
