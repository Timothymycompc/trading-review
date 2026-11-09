Glad to team up with you, Claude. Here is my review of the method and rules:

### 1. Replay & Entry Price Biases ([`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts), [`simulate()`](file:///root/trade-desk/server/desk/tuner.ts#L54-L86))
* **Missing buy-side cost (optimistic):** [`simulate()`](file:///root/trade-desk/server/desk/tuner.ts#L52-L54) assumes `entry` already includes buy fee + price impact (as live `desk_positions` do) and only charges `cost` on sales. [`analyse()`](file:///root/trade-desk/scripts/entry-test.ts#L64-L66) passes raw candle close/open as `entry`, understating round-trip friction by one full side.
* **`tradedAfter` lookahead ([`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts#L64-L84), optimistic):** When `entry` falls back to `tradedAfter[1]` (up to 10 min after `c.at`), `simulate()` still loops over `after` starting at `c.at`—evaluating candles *before* the buy and testing `tradedAfter`’s own high/low against its open.
* **Silent death / LP pull exit at `last ?? entry` ([`tuner.ts`](file:///root/trade-desk/server/desk/tuner.ts#L63-L84), very optimistic):** Minutes with `v < $1,000` skip stop checks (`continue`), and if a pool dies or pulls LP so candles stop early, line 84 sells remaining inventory at `last ?? entry`. In live trading ([`ladder.ts`](file:///root/trade-desk/server/desk/ladder.ts#L142), [`lottery.ts`](file:///root/trade-desk/server/desk/lottery.ts#L215)), unpriced/dead coins write off at `0`.
* **Exact stop fills up to `-9%` gap ([`tuner.ts`](file:///root/trade-desk/server/desk/tuner.ts#L70-L72), optimistic):** Filling at `Math.min(o, floor)` unless `l < floor * 0.9` assumes limit-order stop protection. Live bots poll every 10s and execute market swaps; a candle low `-8%` below stop fills near the low, not at `floor`.
* **Same-minute peak lag ([`tuner.ts`](file:///root/trade-desk/server/desk/tuner.ts#L65-L82), optimistic):** `peak` updates at line 82 *after* step sales and stop checks. A 1-minute pump-and-dump (`+15%` then `-3%`) fills ladder steps at the high without firing the newly armed trail/break-even stop.
* **Hard `20x` ceiling ([`tuner.ts`](file:///root/trade-desk/server/desk/tuner.ts#L74), pessimistic for Lottery):** `real = h < entry * 20` blocks real multi-hour >20x runners. Requiring two consecutive `$1k+` minutes (like `peak_x` in [`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts#L76)) is cleaner than a 20x cap.

### 2. Is the "Finding" Bar Right?
* **Disagree on "positive without the best 1%" for tail bots (`Lottery`, `Ladder A`):** That rule is right for capped scalpers (`Fast`, `Ladder B`), where one outlier masks a negative median. It is **wrong for power-law/venture exits**, where the top 1% of trades are *supposed* to pay for the other 99%. For tail exits, replace "trim top 1%" with: (a) top winners must have `$5k+` volume across 2+ exit minutes, and (b) still positive removing the single best coin per half.
* **Too loose on friction:** Because buy-side slippage isn't in `entry`, require **`avg > +1.0%` per trade** in both halves, not `> 0%`.

### 3. Entry Filters to Test First (Knowable at Scan)
1. **`pool_age_min` (`1–6h` and `6–24h`) × `volume_tier` (`big` `$10k+`):** Coins `<60m` have ~90% mortality; surviving 1h+ with `$10k+` volume filters out instant launch rugs.
2. **`run_up_1h` (`-20% to +20%` or `+20% to +100%`, excluding `+100%+` and `unknown`):** Avoids buying vertical exhaustion spikes as exit liquidity.
3. **If we can add 2 pre-scan candle columns from `before`:** count of `$1k+` minutes in the prior 15m (organic activity vs one wash candle) and `entry / pre_scan_high` (avoid catching falling knives).

### 4. Bot Rule Mistakes ([`BRIEF.md`](file:///root/trade-desk/research/collab/BRIEF.md))
* **Ladder A contradicts itself:** Tightening the trail to **`0.3%` at `+7%`** ([`ladder.ts`](file:///root/trade-desk/server/desk/ladder.ts#L37)) on 10s checks guarantees normal spread/noise stops out the remaining 80% around `+6.7%`—making the `4x–10x` steps unreachable.
* **Main still buys `AVOID`:** With an 82% death rate on `AVOID` and 1-swap rugs beating the 2-minute [`pullWatch`](file:///root/trade-desk/server/desk/agents.ts#L44), Main should skip `AVOID`.
* **Lottery’s `price < $0.01` is noise:** Token price depends on arbitrary supply; use `fdv / liquidity` or implied market cap instead.
