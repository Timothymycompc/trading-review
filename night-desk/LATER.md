# Later (Parked Ideas)

Per [PRINCIPLES.md](./PRINCIPLES.md), we finish the current phase before adding new scope. The ideas below are parked until the core US equities paper desk is live and verified:

- **Options strategies:** Iron condors, earnings straddles, and covered calls (requires options chain data, Greeks, and assignment modeling).
- **Crypto & 24/7 markets:** Spot crypto pairs or perpetual futures (different market structure, funding rates, and exchange custody risk).
- **Live real-money brokerage execution:** Any connection to a funded real-money account remains strictly out of scope until months of out-of-sample paper trading are audited by a human.
- **TradingView inbound webhooks:** Accepting signal webhooks from TradingView alerts (currently TradingView is only an optional Pine Script output for human charting).
- **Monte Carlo path resampling & parameter tuning:** Bootstrap equity-curve shuffling and automated hyperparameter sweeps (must wait until walk-forward out-of-sample backtesting is wired).

## Backtest trust: why the first PASS is NOT trusted (2026-11-09)
The engine (src/backtest.ts) ran and the 18/25 gate passed all 3 rules — but the result is not trustworthy yet. Three
flaws must be fixed before any PASS is allowed to promote a rule to trading:
1. SURVIVORSHIP BIAS. src/universe.ts is TODAY's winners (NVDA, LLY, AAPL...). Backtesting momentum on stocks we already
   know went up is rigged to look good. Fix: point-in-time universe, or restrict to broad/sector ETFs (no single-name
   survivorship) for any trusted test.
2. BROKEN PORTFOLIO/DRAWDOWN MODEL. maxDD came out 75-93% next to "+0.6%/trade, Sharpe 1.5" — contradictory. It compounds
   hundreds of OVERLAPPING trades as one sequential all-in curve. Fix: one capital, real position sizing, model concurrent
   positions; compute drawdown on a true daily portfolio equity curve.
3. ONE REGIME. The test window (2025-08 -> 2026-11) is a recent bull. Long-only momentum always looks great in a bull.
   The prompt's own test: "would it survive 2020 and 2022?" — untested. Fix: include a bear period.
Until all three are fixed, the live paper bot keeps placing UNPROVEN probes only; no rule is treated as proven.
