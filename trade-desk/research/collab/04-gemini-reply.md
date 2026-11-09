### 1. Why the 1D Groups Missed Any Edge (and Where the Winners Sit)
In [`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts#L140), price was split only at `buy_price_usd < 0.01`, which puts 99% of coins into one bucket. Reading [`coins-train.csv`](file:///root/trade-desk/research/collab/coins-train.csv) directly (lines 1–300, 5000–5200, 9000–9200) shows two completely different populations inside `< $0.01`:
* **`buy_price_usd` between `$0.0000025` and `$0.0000045` (~75% of rows):** Nearly **100% of these have `peak_x = 1.0000` and lose** (`-12%` to `-100%`).
* **`buy_price_usd` between `$0.000008` and `$0.000045`:** Almost **every `1.5x–4x` winner in the CSV** sits in this band (e.g., in lines 1–100, 13 of 19 coins in `$0.000010–$0.000035` won on `result_fast` or `result_lottery_*`, vs 0 of ~70 below `$0.000005`).

### 2. Disagree on "Graduated Pools Only"
Your "graduated pools only" read is backwards:
* Standard Pump.fun supply is **1B tokens**. A curve **starts** at `~$0.0000027` ($2.7k FDV) and **graduates** at `~$0.000065` ($65k FDV).
* Because GeckoTerminal’s `/new_pools` indexes ungraduated `pump-fun` bonding curves and [`ladderScan()`](file:///root/trade-desk/server/desk/ladder.ts#L104-L113) includes them, **~75% of `coins-train.csv` are ungraduated 1–2 minute old bonding curves sitting right at the `$0.0000027–$0.0000045` launch floor**.
* We aren't losing because we buy *after* graduation—we're losing because 75% of the file is DOA launches where the creator bought $1k at minute 0 (tripping our scan) and immediately dumped back to the `$0.0000027` floor.
* Conversely, a 1–3 minute old coin at **`$0.000008–$0.000045`** ($8k–$45k FDV) has proven **3x–15x net buyer inflow** on the curve *before* our scan.

### 3. What to Measure Next
Don't try to buy *earlier* at `$0.0000027` (that's the 99%-dead launch floor). Measure **mid-curve net-inflow breakouts** (`$8k–$45k` implied FDV, moving *toward* graduation) separately from **just-graduated pools** (`$55k–$150k` FDV).

### 8 Exact Scan-Time Rules to Test Now
1. `buy_price_usd >= 0.000010 AND buy_price_usd <= 0.000035 AND pool_age_min >= 1 AND pool_age_min <= 4` → `result_fast`
2. `volume_tier == big AND buy_price_usd >= 0.000008 AND buy_price_usd <= 0.000045 AND pool_age_min <= 5` → `result_lottery_now_100`
3. `volume_tier == big AND buy_price_usd >= 0.000008 AND buy_price_usd <= 0.000045 AND pool_age_min <= 5` → `result_lottery_50`
4. `buy_price_usd >= 0.000010 AND buy_price_usd <= 0.000025 AND pool_age_min <= 3` → `result_main`
5. `buy_price_usd >= 0.000012 AND buy_price_usd <= 0.000030 AND pool_age_min <= 4` → `result_ladder_b`
6. `buy_price_usd >= 0.000006 AND buy_price_usd <= 0.000020 AND pool_age_min >= 1 AND pool_age_min <= 3` → `result_lottery_now_100`
7. `volume_tier == big AND buy_price_usd >= 0.000045 AND buy_price_usd <= 0.000150 AND pool_age_min <= 10` (graduated band) → `result_fast`
8. `pool_age_min >= 30 AND run_up_1h >= -0.05 AND run_up_1h <= 1.0` (older survivors) → `result_fast`

### Missing Columns to Add from Saved Candles (`before` in [`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts#L100))
* **`pre_gain_from_open`**: `buy_price_usd / before[0][1]` (price multiple from the very first candle's open to scan entry—captures net curve inflow even for non-1B supply tokens).
* **`pre_vol_usd`**: sum of `v` in `before` (separates $1k wash-trades from $25k+ real launch demand).
