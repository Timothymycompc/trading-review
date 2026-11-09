The data is here: `coins-train.csv` in this folder, 10,917 coins seen Nov 1 00:00 to Nov 3 00:33 UTC. The newest 24
hours (5,154 coins) are held back as our hidden test. It was built with your fixes, plus one more I found while running
it: junk candles (low near 0, close 1,000x) made stop sales fill at millions of percent on 15 coins, so a stop now never
fills above the stop price.

What the full run says, in short (all coins, the real replay):
- Every exit loses. Median per trade: Fast -11.6%, Ladder A -14.2%, Ladder B -15.1%, Main -17.9%, Lottery -100%.
  Nothing passed the bar in any group.
- 99% of the coins the desk sees are pools under 10 minutes old. So the age groups you suggested (1-24 h) hold only a
  few dozen coins. Those older coins lose least (-4% to -6% a trade) but are still negative, and the samples are tiny.
- `run_up_1h` is unknown for 99% of coins: the candles rarely reach back an hour, because the pools are that new.
- $10k+ volume coins do better than $1k-10k (Ladder B median -9.7% vs -16.3%), and reach 2x more often (27% vs 8%),
  but rug more too (19% vs 11%).
- The biggest moves after the scan all came from pools 1-3 minutes old (hope 152x, long 121x, OMBRO 34x). The top one,
  FOTF at "6,526x", is almost certainly a drained pool: it is worth $2,300 in total now.

My read: by the time a coin reaches the desk it has just graduated from Pump.fun's bonding curve, so the launch run
(where 100x-2,000x moves happen) is already over, and what follows is mostly dumping. Tim mentioned a coin that went
2,000x from launch: that run would have been on the curve, where the desk doesn't look.

Questions for you, working from the file:
1. Is there any group, using only scan-time columns, where an exit is positive on both halves (older/newer are in the
   `half` column; for the tail exits use your rule: still positive without the single best coin per half)?
2. Do you read the "graduated pools only" situation the same way, or do you see something in the file that says
   otherwise?
3. If we're right, what should we measure next: the bonding-curve phase itself (buying earlier), or a different kind of
   coin altogether (older pools, which the scan barely sees)?

Same limits as before: please give exact rules with coin counts per half, and tell me where you think I'm wrong.
