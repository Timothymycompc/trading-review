### 1. Lookahead & Replay Bugs in `delayed()` and `simulate()` ([entry-test.ts](file:///root/trade-desk/scripts/entry-test.ts))

1. **Critical Bug on the 30-Minute Exit (53% of trades): `if (t > end) break` skips the `dead` candle and sells frozen/rugged pools at their pre-freeze high (`last`):**
   - In [`delayed()`](file:///root/trade-desk/scripts/entry-test.ts#L180-L202), the synthetic `dead` candle is placed at `windowEnd = c.at + 1000 * 60` (16.6 hours out).
   - In [`simulate()`](file:///root/trade-desk/scripts/entry-test.ts#L36-L39), `end = openedSec + 30 * 60`, and line 39 runs **`if (t > end) break;`**—so a 30-minute exit **never reaches the `dead` candle at `1000m`**!
   - Worse: if a Meteora DAMM v2 pool (238 training coins, where LP *can* be pulled) or a PumpSwap pool climbs to +40% at minute 10 and then **gets its LP pulled or stops trading at minute 12**, GeckoTerminal emits no candles between minute 12 and minute 30. `simulate()` exits the loop and runs line 65 (`cash += qty * (last ?? entry) * (1 - cost)`), booking a **+40% sale at minute 30 using minute 10's price** on an empty/untraded pool!
   - **Fix to test right now:** At `t > end`, do not sell at `last` from 15 minutes ago. If there is no traded candle (`v >= 1000`) within `[end - 2m, end + 5m]` and `canPull(pool)` is true, write it off; otherwise fill at the first candle at/after `end` (or require a candle in `[end - 2m, end + 2m]`).
2. **Candle-Boundary Timing (`scanPrice` and `tK`):**
   - In [`analyse()`](file:///root/trade-desk/scripts/entry-test.ts#L116-L122), `before = cs.filter((x) => x[0] <= c.at)`. Because `x[0]` is the **start** of the minute, `tradedBefore[4]` (`scanPrice`) is the close of the scan minute (up to 59s *after* `c.at`), or `tradedAfter[1]` (up to 10m *after* `c.at` if `tradedBefore` was thin!). Fix `scanPrice` in `delayed()` to never use `tradedAfter` after `c.at + 60`.
   - In [`delayed()`](file:///root/trade-desk/scripts/entry-test.ts#L184-L187), `seen` (`x[0] <= c.at + 300`) includes the 5th candle whose close `lastT[4]` happens at `x[0] + 60` (5–6 minutes after `c.at`). Since `after` (`x[0] > tK`) starts at the next candle, `entry` and `after` **don't overlap**, provided the live bot waits for that 5th 1-minute candle to close before buying.

### 2. What Real Trading Loses vs This Replay
1. **2x Wick Fills (23% of trades):** [`simulate()`](file:///root/trade-desk/scripts/entry-test.ts#L57-L60) triggers take-profit on `h >= 2 * entry` and fills at exact `2.0x`. Live bots poll Jupiter every 10 seconds with no resting limit order—a 3-second wick to `2.05x` that closes the minute at `1.45x` is missed ~70% of the time, and when caught fills near `(h + c) / 2` or `c`.
   - **Test:** Fill `h >= 2 * entry` at `Math.min(2 * entry, (h + c) / 2)`.
2. **Real Fees + Slippage on Young Pools:**
   - **PumpSwap fee:** **1.25% per side** (1.00% LP/creator + 0.25% protocol).
   - **Meteora DAMM v2 fee:** Dynamic fees on newly graduated pools are **1.5%–4.0% per side** in the first 15 minutes.
   - **Price impact + MEV slippage:** **0.5%–1.0% per side** on a $12k–$15k liquidity pool.
   - **Total friction:** **~2.2% per side (4.4% round trip)** vs `1.0%` per side in the test (costs ~2.4% off every trade's return). Also explicitly exclude `pump-fun` ungraduated curves (-9.7%).

### 3. Market Mood (Nov 1–3) & Fast Canary
- Notice two warnings in your table: trade count dropped 4x from training older half (686) to newer half (166), and **Nov 3 20–23 UTC lost -9.4% (31 trades)**.
- **Fast canary in live paper:** Track the **mean return of the 30-minute time-limit exits** over a rolling 20 trades. When the market is bidding graduations, those 53% time-limit exits average **+20%+**; when the market switches to fading graduations, time-limit exits flip negative and the `-40%` stop rate jumps above **35%**.

### 4. How to Run the Live Paper Test
1. **First:** Re-run the backtest with the 30m `dead`/stale-`last` fix, `Math.min(2*entry, (h+c)/2)` on 2x fills, `COST = 0.022`, and `pool_dex == 'pumpswap'` vs `'meteora'`.
2. **Live paper:** Fetch real **Jupiter `/swap/v1/quote` `outAmount` quotes** for Tim's actual SOL trade size at buy and sell (capturing live pool depth + DAMM/PumpSwap fees).
3. **Bar to trust:** **100 closed trades across $\ge 3$ calendar days (72+ hours)** with mean AND median **$\ge +5\%$** (and positive without the top 2 trades).
4. **Stop rules:** Kill or pause if (a) after **30 trades**, mean or median is **$\le 0\%$**, or (b) in any **rolling 25 trades**, `-40%` stops exceed **38%** or median falls below **-5%**.
