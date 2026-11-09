### 1. Why WAIT-5 Decayed (`+9.0% -> +1.4% -> +0.9%`) and Why Trades Dropped 4x (`686` vs `166`)

**First, there is a split artifact in [`entry-test.ts`](file:///root/trade-desk/scripts/entry-test.ts#L250-L254).**
`mid` was computed as the median timestamp across **all** coins (Nov 1 00:00 to Nov 4 00:33 UTC), which set `split_at` to **Nov 2 ~16:30 UTC**. When [`coins-train.csv`](file:///root/trade-desk/research/collab/coins-train.csv) was cut at Nov 3 00:33 UTC (holding out Nov 3) without recomputing `mid`:
- **`older` (`coins-train.csv` lines 2–8,553)** is **40.5 hours** (Nov 1 00:00 to Nov 2 16:30 UTC: 8,552 coins, 686 WAIT-5 trades = **16.9 trades/hr**).
- **`newer` (`coins-train.csv` lines 8,554–10,918)** is only **8.0 hours** (Nov 2 16:30 to Nov 3 00:33 UTC: 2,365 coins, 166 WAIT-5 trades = **20.8 trades/hr**).

Graduations didn't drop 4x—they actually **rose** 23% per hour (`16.9 -> 20.8/hr`), and `newer` was simply an 8-hour slice sitting entirely inside **`16:30–00:33 UTC`**.

**Second, `16:00–24:00 UTC` (US afternoon/evening) is a supply-glut / fade regime.**
Both weak buckets—the 8-hour `newer` training slice (`+1.4%` at 1%, `-0.3%` at 2.2%) and Nov 3's worst block (`20:00–23:59 UTC`, `-9.4%`)—are the exact same time of day. When graduation supply spikes above ~20/hr in US evening hours, speculator liquidity gets diluted across too many launches and bots fade graduations faster.

**Three regime filters to check on a true 24h/24h split of [`coins-train.csv`](file:///root/trade-desk/research/collab/coins-train.csv) (at 2.2% cost/side, without touching Nov 3):**
1. **R1 (Trailing 1h Graduation Breadth):** Among `pumpswap` + `meteora-damm-v2` coins scanned in `[at - 60m, at - 10m]`, require `>= 50%` to have `move_since_scan > 0` at `k = 5` in [`coins-wait-train.csv`](file:///root/trade-desk/research/collab/coins-wait-train.csv). This directly measures whether the market is bidding or dumping fresh graduations (and captures SOL tape drops without an external feed).
2. **R2 (DEX + Crowding Cap):** Restrict to `pool_dex == 'pumpswap'` (excluding `pump-fun`'s `-9.7%` drag and `meteora-damm-v2`'s +4.4% median high-fee decay) AND require `5 <= graduations_last_1h <= 18`.
3. **R3 (UTC Session):** Compare `seen_hour_utc < 16` vs `>= 16` independently across each 24h day (Nov 1, Nov 2, Nov 3).

---

### 2. Where to Look Next for a Real Edge

1. **Do NOT buy earlier on the bonding curve (`pump-fun`):**
   [`coins-train.csv`](file:///root/trade-desk/research/collab/coins-train.csv) already has ~8,000 ungraduated `pump-fun` coins. Only 1.8% of launch-floor curves ever hit 2x, and the 31 curve coins that passed `WAIT-5` lost `-9.7%`. Pre-graduation is a negative-sum bundle/latency war against creators and 0-slot snipers with a 1%/side fee.
2. **One bounded spot test left—`WAIT-30` / `WAIT-60` pullback on `pumpswap` survivors:**
   Minute-5 entries pay peak slippage and fight initial sniper distribution. In [`coins-wait-train.csv`](file:///root/trade-desk/research/collab/coins-wait-train.csv), test `k = 30` and `k = 60` on `pumpswap` coins that survived (`move_since_scan >= +0.50`, `traded_minutes >= 25/30`) and pulled back (`off_high` between `-0.30` and `-0.15`), where pools are deeper and early dumpers are gone.
3. **Flip sides of the 4.4% round-trip tax, or publish the study:**
   You can't short 5-minute-old PumpSwap coins (no borrow market). If `WAIT-5` + regime filter and `WAIT-30` fail at 2.2%/side, the real edge is either **(a) collecting the 2–4% swap fees as a short-duration Meteora DLMM LP on Pulse-verified `SAFE` graduations**, or **(b) publishing this 23,000-coin replay on Solana Pulse** as flagship proof for grants and `@solana-pulse/guard`.

Full details are in [`plan.md`](file:///root/.gemini/antigravity-cli/brain/69b74602-2b14-4795-bc22-54d6e54646f4/plan.md).
