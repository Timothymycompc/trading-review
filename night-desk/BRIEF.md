# Night Desk — build brief (from Tim's "hedge fund that never sleeps" prompt, 2026-11-09)

Tim pasted a six-agent "one-person hedge fund" prompt and said: build it, and aim it at the markets the prompt talks about.

## The market (locked)
The prompt's signals are earnings drift, momentum after news, mean reversion, breakouts on expanded volume, sector
rotation, and it names earnings, Fed meetings and CPI. That is **US stocks (equities)**. So:
- Universe: liquid US equities + major sector ETFs (SPY, QQQ, XLK, XLF, XLE, ...). No options, no futures, no crypto, no memecoins.
- Data + paper trading: **Alpaca** (alpaca.markets) — real market data API and a free paper-trading account. Keys later in
  Google Secret Manager (NIGHT_DESK_ALPACA_KEY / _SECRET), like every other project. Never a live/real-money account in code.
- TradingView has no free data API, so it is NOT a data source. The only TradingView output is an optional Pine Script
  indicator the Build step writes for a human to paste in. All real numbers come from Alpaca (named as the source).

## Honesty rules (RULES.md, same spirit as PRINCIPLES.md)
- Real data with its source, or say "unknown". Never invent a price, a backtest result or a return.
- A strategy is "profitable" ONLY if it stays positive after costs on UNSEEN (out-of-sample) data across 30+ trades.
- Label every estimate as an estimate. No guaranteed-profit claims, ever.
- Account for multiple testing (deflated Sharpe), survivorship and lookahead bias. Paper only until a human approves real money.
- Every idea, veto and trade is logged to the journal. If stuck, leave one question and move on.

## Scope of THIS build (Phase 0 — skeleton, no live trading yet)
Build a clean, typed TypeScript skeleton that compiles and is ready to wire to Alpaca next. Do NOT fabricate data or results.
Stubs that need live data return `{ status: "needs-data" }`, never a made-up number. Follow Tim's conventions: TypeScript,
small files, own repo, RULES.md + README + LATER.md.

## Files to write (exact manifest)
- `package.json` — name "night-desk", type module, scripts: build (tsc), test (node --test), typecheck (tsc --noEmit).
  deps: none required for the skeleton; devDeps: typescript, @types/node, tsx. No network libs yet.
- `tsconfig.json` — strict, NodeNext, target ES2022, outDir dist, src rootDir.
- `README.md` — what it is (overnight equities research + paper desk), the six agents in one line each, "paper only", how to run.
- `RULES.md` — the honesty rules above, each with one line of why. Link PRINCIPLES.md.
- `LATER.md` — parked ideas (options, crypto, live money, TradingView webhook, Monte Carlo tuning).
- `src/types.ts` — shared types: DeskRules, Idea, Setup, Strategy, Score, Veto, Trade, JournalEntry, Handoff
  (Handoff = { ticker, idea, evidence, nextStep }).
- `src/deskRules.ts` — the intake: the 4 questions (markets [default: US equities + sector ETFs], paper capital, max risk
  per trade, holding period, what never to trade), a function to validate answers into a DeskRules object, and load/save
  to a local JSON file (research/desk-rules.json). No question is re-asked once saved.
- `src/journal.ts` — append-only journal (research/journal.jsonl): logEntry(kind, payload), readJournal(). kinds: idea,
  veto, trade, note.
- `src/scoring.ts` — REAL math, no stubs: sharpe(returns), deflatedSharpe(sharpe, nTrials, skew, kurtosis, n),
  maxDrawdown(equityCurve), and score1to5 for each of {outOfSampleSharpe, deflatedSharpe, maxDrawdown, tradeCount,
  edgeAfterCosts} plus total out of 25 and a `passed` flag (>=18 AND positive after costs AND >=30 trades). Unit-tested.
- `src/crew/chiefOfStaff.ts, scout.ts, chartAnalyst.ts, strategist.ts, riskOfficer.ts, trader.ts` — one file each, a typed
  function with a clear signature and a doc comment of its job from the prompt. Where it needs live data it returns
  `{ status: "needs-data", need: "<what>" }`. riskOfficer.veto(plan) returns a real decision from DeskRules limits
  (max risk per trade, never-trade list, no entry into earnings/Fed/CPI windows) — that logic is real, not a stub.
- `src/pipeline.ts` — wires the crew in order (scout -> chartAnalyst -> strategist -> scoring -> riskOfficer -> trader),
  every handoff a Handoff object logged to the journal; the Chief of Staff is the only one that produces the morning brief.
- `src/morningBrief.ts` — formats the 07:30 brief from journal + strategies (market in 5 lines [needs-data], top 3
  strategies, every veto + why, bot status, one decision: approve/reject/retest). Pure formatting over given data.
- `tests/scoring.test.ts` — tests sharpe, maxDrawdown, deflatedSharpe and the pass/fail gate on hand-worked numbers.
- `tests/riskOfficer.test.ts` — veto fires on over-risk, never-trade ticker, and an earnings/Fed/CPI window.
- `BUILD_PLAN.md` — the phases after this skeleton: (1) Alpaca market-data client + universe, (2) backtest engine with
  walk-forward + costs/slippage, (3) Alpaca paper order placement behind the Risk Officer, (4) Cloud Run + Scheduler for
  the overnight run and 07:30 brief, (5) kill switches (2% daily loss / 3 losses / stale data), (6) optional Pine Script output.

## What to hand back in result.md
What you built, any file you could not write, and anything a reviewer must check. Do not run npm/build/test (not allowed
headless) — just write the files. Keep every file small.
