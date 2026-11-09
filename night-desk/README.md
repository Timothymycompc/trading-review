# Night Desk

Night Desk is an overnight US equities and sector ETF research and **paper-only** trading desk. All market data and paper order execution come from **Alpaca** (`alpaca.markets`). It never connects to a live or real-money brokerage account.

See [PRINCIPLES.md](./PRINCIPLES.md) and [RULES.md](./RULES.md) for our data honesty and risk rules, and [LATER.md](./LATER.md) for parked ideas.

## The Six-Agent Crew

1. **Chief of Staff (`src/crew/chiefOfStaff.ts`)** — Coordinates the overnight run, enforces desk intake rules, and writes the 07:30 morning brief with one clear decision (`approve`, `reject`, or `retest`).
2. **Scout (`src/crew/scout.ts`)** — Scans liquid US equities and major sector ETFs (`SPY`, `QQQ`, `XLK`, `XLF`, `XLE`, etc.) via Alpaca for earnings drift, post-news momentum, volume expansion, and sector rotation anomalies.
3. **Chart Analyst (`src/crew/chartAnalyst.ts`)** — Evaluates daily/intraday price structure, key levels, ATR volatility, and volume confirmation on Scout tickers using Alpaca bars.
4. **Strategist (`src/crew/strategist.ts`)** — Turns confirmed chart setups into testable rules with walk-forward out-of-sample backtests, transaction cost estimates, and an optional TradingView Pine Script indicator for human review.
5. **Risk Officer (`src/crew/riskOfficer.ts`)** — Enforces hard veto gates from `DeskRules`: max risk per trade, never-trade ticker list, and macro/event blackout windows (earnings, FOMC/Fed meetings, CPI releases).
6. **Trader (`src/crew/trader.ts`)** — Submits approved, un-vetoed strategies that pass the >=18/25 scoring gate to the Alpaca **paper** trading API and monitors kill switches.

## Paper Only

This repository is strictly **paper trading only**. Where live Alpaca market or paper-account data is not yet wired (Phase 0 skeleton), crew modules return `{ status: "needs-data", need: "<what>" }` rather than inventing prices, returns, or backtest numbers.

## How to Run

```bash
# Typecheck source files
npm run typecheck

# Compile TypeScript to dist/
npm run build

# Run unit tests (scoring math & Risk Officer veto logic)
npm test
```
