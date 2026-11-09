# How we tested, and why most backtests lie

1. **Real data, named.** Every price comes from a named source (Oanda, Alpaca, FRED, Jupiter/GeckoTerminal, federalreserve.gov).
   Missing data is "unknown", never filled in.
2. **No look-ahead.** A signal on a candle's close is filled at the *next* candle's open. Stops fill at the stop, or at the
   open if price gaps through. If a stop and a take-profit are hit in the same candle, we assume the stop came first.
3. **Real costs.** Measured bid/ask spreads per pair; 5 bps a side for ETFs; 1% buy cost and −100% write-offs for dead
   memecoins.
4. **Several periods, not one total.** A rule must make money in each period (e.g. 2016–21, 2022–25, last 12 months), not just
   in total.
5. **Locked data.** For stocks, the newest year was never written to disk while the AI searched; the finalists ran on it once,
   and the script refuses to re-run a rule. For forex, 9 other pairs and EUR/USD 2005–2015 were the hidden set.
6. **Commit before you run.** Hidden-data and paper-effect tests were committed to git before their first run, so the rules
   provably weren't adjusted after seeing results.
7. **Count the tries.** Deflated Sharpe ratio (Bailey & López de Prado 2014) for the number of rules tested; for parameter
   grids, report *how much of the grid* is profitable, not the best cell.
8. **Compare with doing nothing clever.** Stocks vs holding SPY; FOMC days vs the same trade on every other day.
9. **Then forward-test.** Paper trading on live prices with the identical code, because the future is the only unseen data
   left.
