# Fast lane replay (2026-11-02)

Question (Tim): the desk was built to trade young Pump.fun coins and get out before the pull. Would a quick
take-profit on young coins have made money?

Data: every coin the desk ran its full safety check on, 2026-11-01 08:21 to 2026-11-02 07:02 UTC (294 coins,
`coins.jsonl`, from desk_events), with GeckoTerminal 1-minute candles for the 6 hours after each check (`ohlcv/`,
257 coins had candles). `fetch.py` downloads, `study.py` replays, `result.txt` is the output.

How a trade is simulated (strict on purpose; full notes at the top of `study.py`): buy at the price in the minute of the
desk's check plus 1% cost per side (2% as a harsh case); take profit as a resting limit sell (fills when the high
touches it) or by a once-a-minute check; stop on a minute's close (a one-swap rug costs nearly everything); a stop
and a target in the same minute count as the stop; take-profits need $1,000+ traded in that minute and are skipped
above 20x (emptied pools show fake prices). A rule counts only if it makes money in both halves (by time).

## Result

| Coins | n | Rules making money in both halves (of 120) | Best rule |
|---|---|---|---|
| Passed the desk's safety rules, not AVOID | 15 | 31 at 1% cost, **0 at 2% cost** | +10% limit sell, -6% stop, sell after 30 min: **+3.8% a trade**, 10 of 15 won, worst -9% |
| Not AVOID but failed the desk's rules (control) | 65 | - | same rule: **-5.1% a trade** |
| Not AVOID, all | 80 | 0 | - |
| All checked coins (mostly AVOID) | 257 | 1 (limit, 1% cost) | AVOID coins rug; not tradable |

- The desk's safety rules are what make the difference: the same quick-exit rule loses 5.1% a trade on coins that
  failed them and wins 3.8% on coins that passed.
- Holding past 30 minutes loses: the same rule with 60 minutes averages -1.1%.
- XTO and both AODFs (the three rugs that cost the paper desk $224) would have been +0.2%, +8.9% and +8.9%.
- The edge is thin: at 2% cost per side no rule holds up. Real cost on an $80 buy in a $25k-$100k pool is about
  0.25-0.5% swap fee plus 0.1-0.3% impact plus slippage, so near 1%, but that must be measured on real fills.

## Limits

- 15 coins from one day. This is a lead, not proof; the earlier study (`2026-11-01-pulse-data`) found 32 rules that
  looked good on training data and lost 10% on test data.
- One-minute candles hide the order of trades inside a minute.
- The desk saw these coins once a minute; a real limit sell can fill inside the minute, a once-a-minute desk can't.

## Next

Run it as a second paper lane next to the current desk (desk safety rules, not AVOID, no age/score requirement,
+10% take profit checked every 10 seconds, -6% stop, sold after 30 minutes) until it has 50+ trades, then compare.
