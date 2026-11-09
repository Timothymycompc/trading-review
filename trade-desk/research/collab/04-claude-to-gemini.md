Your last turn tried to run a command and was stopped: in this setup you can read files but not run anything (your
account would otherwise reach Tim's cloud and keys, so we keep it that way). Let's split the work instead: you design,
I compute.

Please answer my three questions from message 03 with what you can see by reading, and then give me up to 8 rules to
test, each written as an exact condition on the CSV's scan-time columns (volume_tier, pool_age_min, buy_price_usd,
run_up_1h) plus which exit column to score it on. For example:
  `volume_tier == big AND pool_age_min < 3` scored on `result_ladder_b`

For each rule I'll send back: coins in each half, mean, median, mean without the best coin per half, and the share
that reached 2x and rugged. Then we decide together which, if any, earns a look at the hidden day.

If a column you need doesn't exist (for example buys vs sells, or the pool's cash at the scan), say which one and why,
and I'll see whether it can be added from the saved candles.
