# Night Desk — Build Plan (Post-Skeleton Phases)

Phase 0 (this commit) establishes the typed TypeScript skeleton, real scoring math (`src/scoring.ts`), real Risk Officer veto gates (`src/crew/riskOfficer.ts`), append-only journal (`src/journal.ts`), and 07:30 morning brief formatter (`src/morningBrief.ts`).

All subsequent phases follow [PRINCIPLES.md](./PRINCIPLES.md) and [RULES.md](./RULES.md):

## Phase 1 — Alpaca Market-Data Client + US Equities Universe
- Load `NIGHT_DESK_ALPACA_KEY` and `NIGHT_DESK_ALPACA_SECRET` from Google Secret Manager (project `x300-506418`).
- Build `src/alpaca/marketData.ts` targeting Alpaca's US equities data API (`data.alpaca.markets`) for liquid US stocks and sector ETFs (`SPY`, `QQQ`, `XLK`, `XLF`, `XLE`, `XLV`, `XLI`, `XLP`, `XLY`, `XLU`, `XLB`, `XLRE`, `XLC`).
- Wire `Scout` and `Chart Analyst` to real daily and intraday OHLCV bars, corporate actions/earnings calendars, and volume ratios.

## Phase 2 — Walk-Forward Backtest Engine + Costs & Slippage
- Build `src/backtest/walkForward.ts` with strict chronological train/test splits (no lookahead bias) and point-in-time universe filtering where available.
- Deduct realistic commission, spread, and slippage estimates (explicitly labelled `[estimate]`) on every simulated fill.
- Feed out-of-sample trade returns, trial count `nTrials`, skewness, kurtosis, and equity curve into `src/scoring.ts` (`sharpe`, `deflatedSharpe`, `maxDrawdown`, `scoreStrategy`).

## Phase 3 — Alpaca Paper Order Placement Behind the Risk Officer
- Build `src/alpaca/paperBroker.ts` hardcoded exclusively to `https://paper-api.alpaca.markets` (reject any non-paper base URL at startup).
- Require every order request to carry a valid, un-vetoed `Veto` token from `riskOfficer.veto(plan)` and a passing `Score` (`total >= 18`, `edgeAfterCosts > 0`, `tradeCount >= 30`).
- Log every paper order submission and fill to `research/journal.jsonl`.

## Phase 4 — Cloud Run + Cloud Scheduler (Overnight Run & 07:30 Brief)
- Deploy Night Desk as a service/job on Google Cloud Run in project `x300-506418`.
- Configure Cloud Scheduler (America/Chicago / Dallas time) to run the overnight research pipeline and deliver the Chief of Staff's 07:30 Central morning brief.

## Phase 5 — Automated Kill Switches
- Enforce three hard paper-trading circuit breakers before and during market hours:
  1. **2% daily drawdown limit:** Halt new paper entries and flatten open intraday positions if daily paper equity drops by >= 2%.
  2. **3 consecutive losses:** Pause the strategy and mark it `retest` for the next morning brief after 3 straight losing trades.
  3. **Stale data guard:** Refuse to score or place paper orders if the latest Alpaca bar/quote timestamp is stale beyond the timeframe threshold.

## Phase 6 — Optional TradingView Pine Script Output
- Expand `buildPineScriptStub` in `src/crew/strategist.ts` to write complete, self-contained Pine Script v5 indicator files into `research/pine/` for any strategy that passes the 18/25 gate, so a human can visually audit entries and stops on TradingView charts.
