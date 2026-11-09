# Two completely new strategies: brief (Claude + agy, 2026-11-09)

Tim: "get with agy and y'all come up with 2 completely new strategies using the data we gathered, see if you can find profitable."
Honesty rules: say "nothing works" if nothing works; never call a rule profitable from one slice; every rule is fixed BEFORE it sees the hidden day.

## What already FAILED (don't propose these again)
All of these buy a coin at (or within 5 min of) the moment the desk first sees it, then exit with take-profit / stop / trail / ladder / time:
- Main, Fast, Ladder A, Ladder B, Lottery exits, WAIT-5 (wait 5 min, buy if it held), Real Wallet Copy. 23k backtest (16,071 coins replayed): -15% to -20% a trade, every exit, both halves. Live paper since 11-07: 641 trades, -$720.
- 120-cell exit grid (tp 10-100% x sl 6-40% x 30-600 min, trails): no lead.
- Filters on entry facts: Pulse verdict, liquidity tier, 1h volume tier, buy/sell ratio, pool age, run-up, exchange. Safer slices stop the rugs but bleed ~2%/trade to costs; the big movers (13x+) were ALL pools 1-6 min old, the same zone as the rugs.
- Price rules on SOL/JUP/BONK/WIF (7 months hourly, 436 rules): 0 beat holding in both halves.

## The data we have (all real, from the desk)
1. **Minute candles**, 16,071 coins seen Nov 1-4 2026: `[unix_ts, open, high, low, close, volume_usd]`, traded minutes only (quiet minutes are missing), from the minute the desk saw the coin to ~16 h later (up to 1,000 traded minutes). Some pools drain: price falls ~100% in one candle.
2. **Per-coin facts** (coins.csv): seen_at, pool_age_min (age of the pool when seen; 99% under 10 min = just graduated from the Pump.fun curve), pool_dex, volume_tier ($1k-10k or $10k+ 1h volume), pre_vol_usd, pre_gain_from_open, peak_x, minutes_to_peak, reached_1_5x/2x/3x before -40%, rugged.
   Results of 7 known exits are included only so we can compare.
3. **desk_watch** (Postgres, ~200k coins Nov 2-9): at first sight: price0, liq0, fdv0, vol_h1, ratio0 (1h buys/sells), dex, top10, Pulse verdict (on ~6k), same_ticker count. Later price only for Nov 2 coins (taken ~3 days later): 23.6k coins with price and liquidity ~3 days after first sight.
4. Market-wide flow can be built from (1)-(3): how many new pools per hour, how many hit 1.5x, how many rugged, over any past window (only past information may be used at decision time).

## Costs and fills (non-negotiable in the test)
- 1% per side (also report 2.2%/side). A drained pool (price -90% in a minute) fills at that price. Stops fill at the minute's close if the low crossed them, never better than the stop. Targets fill at min(target, (high+close)/2).
- A coin that stops trading for 30+ min while holding = written off (paper desk found these were real drains).

## Test protocol (fixed in advance)
- TRAIN = coins seen before 2026-11-03 00:33 UTC (~10.9k). HIDDEN = after (~5.1k), looked at ONCE per rule, after the rule is frozen.
- A rule may have at most 2 numbers tuned on TRAIN, from a small grid written down first.
- LEAD = on TRAIN both older and newer half > 0 mean, median > -1%, mean without the best 1% of trades > 0, 100+ trades. PASS = LEAD + HIDDEN mean > 0 at 1%/side.
- Passing = paper lane next (Ladder A stays as the control). Never real money from a backtest alone.

## What agy should give back
4 strategy ideas that are genuinely different from the failed family (different WHEN to buy or WHAT signal, not new stop numbers). For each: one-line idea, why it could have an edge (who loses money to it), exact rules computable from the data above (entry, exit, and which 0-2 numbers to tune with their grid), and what result would kill it. Then pick the 2 you think most likely to survive and say why.
