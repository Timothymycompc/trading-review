# Hardships, and how we got past them

| Problem | What happened | How we got past it |
|---|---|---|
| **Results that were too good** | Memecoin replay showed +2,000% a trade; a coin "went 6,526×"; forex Sharpe ratios of 3+ | Each was a bug: dust-minute entries, a drained pool, and a Sharpe scaled by 252 instead of √252. We now distrust any big number until the code behind it is checked |
| **Overfitting** | ~1,500 forex versions and 27 AI stock rules: some always look great | Locked final year, hidden pairs and decades, tests committed before running, whole-grid robustness instead of best cell |
| **The winners failed on unseen data** | AI stock finalists +4–5% vs SPY +12.9%; forex system −61.9R on 9 other pairs | Reported as failures. No tweaking on the hidden data afterwards, since that would use it up |
| **Free data was hard to get** | One forex data site rate-limited automated downloads; another had a browser bot check | Didn't work around either. Used the Fed's FRED data, then Tim's free Oanda demo account API (10 pairs, measured spreads, back to 2005) |
| **Wrong key** | A 7-day Oanda "FX Data Services" trial key turned out to be a corporate exchange-rate API (daily averages only), not the trading API | Tested it, explained the difference, got a practice-account token instead |
| **Spreads ate short timeframes** | 15m and 1h: 0 of 1,260 settings profitable; one rule paid ~14,800 pips in spread in 6 years | Measured real spreads per pair; moved to 4h and daily |
| **"100% win rate"** | Take-profit-only with no exit showed 100% wins | Tracked worst open loss: trades sat at −2,000 pips for up to 5½ years. Flagged as a trap |
| **Self-tuning chased noise** | The "learning" version re-picked last period's best settings and lost in 2022–25 | Kept a fixed, middle-of-the-good-zone setting |
| **Stops don't stop rugs** | Memecoin stops filled at −70% to −100% in crashes | Rely on the safety filter (AVOID coins 82% dead), not stops, for rug protection |
| **Account rules** | US forex accounts can't hedge (FIFO), so 4 systems couldn't share one demo account | Shadow ledger for all systems (exact backtest code on live prices) + real demo orders for one |
| **Tool limits** | The AI research assistant hit its usage quota mid-research; heavy jobs can crash the phone it was run from | Did the research directly; heavy jobs run in Google Cloud |
| **Silent failures** | Bots that stopped on rate limits without saying so; "sent" sales that never landed | Health alerts; pending-sale tracking; "unknown" instead of guessing what happened |
