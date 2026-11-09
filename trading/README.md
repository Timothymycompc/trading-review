# Trading Review: memecoins, stocks and forex, tested honestly

Over a few weeks (Oct–Nov 2026) we built trading bots and backtests for three markets and kept a record of what held up and
what didn't. This folder is that record: the data we used, every kind of system we tried, the results, the mistakes that made
early results look better than they were, and how we caught them.

**Short version: almost nothing we tried beats doing nothing clever.** Memecoin bots lost money in every lane. No stock rule beat
just holding the S&P 500. In forex, ~1,500 indicator versions produced one EUR/USD trend system that looks good on the data it
was found on and fails on data it never saw. One published effect, the Fed-announcement-day dollar drop, held up across
4 currency pairs and two decades. All of it is now in a forward paper test with fake money, because the future is the only data
none of these systems has seen.

| Market | What we tested | Data | Result |
|---|---|---|---|
| [Memecoins (Solana)](crypto-memecoins.md) | 6 paper-trading bots (scout + safety filter + exits, ladders, momentum, wallet copy), replays of 16k–23k coins | Live Solana DEX data (Jupiter, GeckoTerminal, DexScreener), Solana Pulse safety checks | **Every lane lost.** 641 paper trades since the 2026-11-07 reset: −$720. Strict replay: every exit rule loses (typical trade −11.6% to −17.9%) |
| [Stocks (US ETFs)](stocks.md) | Momentum, breakout, pullback, trend filters; an AI-assisted search of 27 rules | Alpaca daily bars, 13 ETFs, Jul 2020 → Nov 2026 | **Nothing beat holding SPY.** The AI's 3 finalists beat SPY on the data they were picked from (+68% vs +62%), then lost on the locked final year (+4–5% vs +12.9%) |
| [Forex](forex.md) | 5/16 MA crossovers, candle patterns, EMA ribbons, volatility gates, stops/trailing/take-profit grids, self-tuning, 3 paper-based "forced trader" effects | Oanda candles (15m → daily, 2005 → 2026, 10 pairs, measured spreads), FRED, Fed calendars | **Indicators: no real edge** (best system lost on 9 other pairs and on 2005–2015). **Fed-day effect: holds** on 4 pairs, 2005–2026. Month-end and time-of-day: not tradeable |

- [How we tested (and why most backtests lie)](method.md)
- [Hardships, and how we got past them](hardships.md)

## What's in this repo (paths from the repo root)
| Folder | Contents |
|---|---|
| `night-desk/` | Stock + forex code (TypeScript) and all its data |
| `night-desk/research/fx/` | Every forex price file we downloaded: Oanda EUR/USD 15m (2016→), 1h (2005→), 4h (2005→) and daily; 4h for 10 pairs and 1h for 4 pairs with bid/ask spreads; index CFDs daily (2005→); FRED `DEXUSEU.csv`; Fed calendar pages + `fomc-dates.json`; `fomc-events.json`; [FINDINGS.md](../night-desk/research/fx/FINDINGS.md) |
| `night-desk/research/data/` | Alpaca daily bars for the 13 ETFs: `etf-search.json` (what the AI saw) and `etf-full.json` (including the locked year) |
| `night-desk/research/lab/` | Every stock rule the AI tried (`trials.jsonl`), its candidates, and the one-shot locked-year results (`final.jsonl`) |
| `trade-desk/research/` | Memecoin studies: scanned coins, 1-minute candles for several studies, replays, trade lists, AI review |
| `trade-desk/scripts/`, `trade-desk/server/desk/` | Memecoin backtest/replay scripts and the paper-lane code (needs the full Trade Desk server to run) |
| `trade-desk/benchmark/` | Transaction-check benchmark cases used by the desk's safety layer |
| Release `memecoin-candles` | 1-minute candles for all 23,379 coins of the Nov 1–4 2026 replay (≈187 MB, too big for the repo) |

To re-run a forex test: `cd night-desk && npm ci && npx tsx scripts/fx-hidden.ts` (price files are already here). To fetch
fresh data you need your own free Oanda practice token (`OANDA_PRACTICE_TOKEN`) or Alpaca keys.

Data sources keep their own terms (Oanda, Alpaca, GeckoTerminal/Jupiter/DexScreener); FRED and federalreserve.gov data are
public. Our code and write-ups are free to reuse.

## What we'd tell anyone starting out
1. **A backtest is a story until it survives data it has never seen.** Lock away a year, or a different market, *before*
   you start, and look at it once.
2. **Count your tries.** Test 1,500 versions and some will look brilliant by luck. Judge a family of settings by how much of it
   works, not by its best cell.
3. **Most "edges" are bugs.** Our biggest early wins (+2,000% a trade, a 6,526× coin, Sharpe ratios of 3+) were all mistakes in the
   test, not in the market.
4. **Costs decide short timeframes.** On 15-minute and 1-hour charts the spread ate every rule we tried.
5. **Holding the index is a hard benchmark.** For stocks, nothing we built beat it.
6. **Effects with a reason last longer than chart patterns.** The only thing that held up was a flow with a known cause
   (the Fed-day dollar drop), not an indicator combination.

## Principles
We build to make things better, not to add junk or false data. Every number here comes from real data and names its source;
where data was missing we said "unknown". No result here is advice. Past results, including ours, don't promise future ones.

*Written with Claude (Anthropic) and Antigravity/Gemini as research assistants; all runs and numbers are reproducible from the
scripts referenced in each report.*
