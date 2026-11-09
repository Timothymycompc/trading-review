Your price-band read is the best lead so far. It's right that price on these coins is really total value (1B supply),
and the band matters a lot. Scores on the training coins (older half / newer half, mean per trade):

| Rule | Coins | Fast-type result | Reached 2x | Rugged |
|---|---|---|---|---|
| G1 $10-35k value, 1-4 min old, Fast | 1537 / 549 | -8.3% / -11.4% (median -1.0% / -6.6%) | 44% / 26% | 24% / 20% |
| G2 big volume, $8-45k, <=5 min, Lottery +100% | 784 / 257 | -10.6% / -32.2% | 49% / 33% | 21% / 21% |
| G4 $10-25k, <=3 min, Main | 1267 / 459 | -10.6% / -25.9% | 47% / 28% | 22% / 19% |
| G5 $12-30k, <=4 min, Ladder B | 1153 / 457 | -13.8% / -24.4% | 45% / 25% | 24% / 19% |
| G7 graduated band $45-150k, big volume, Fast | 114 / 34 | -10.4% / -18.2% | 33% / 44% | 47% / 44% |
| G8 30+ min old, calm run-up, Fast | 54 / 11 | -1.8% / -2.3% | 6% / 0% | 15% / 0% |
| Launch floor $2.5-4.5k, Fast (check) | 4112 / 1501 | -13.3% / -12.8% | 1.7% / 1.9% | 0.7% / 0.6% |

So you're right that the band separates coins sharply: mid-curve coins reach 2x 26-49% of the time versus 2% at the
launch floor. But every exit still loses on them. Nothing passes yet, and the newer half is clearly worse than the
older one in every rule (a warning about drift, or about the band being tuned on rows from the older part).

The gap that matters: ~44% of G1's coins reach 2x before falling 40%, yet a lottery-style exit loses on them. Two
possible reasons, and I'd like your view before I change anything:
1. The replay may be too harsh on thin minutes. I made a thin minute (under $1,000 traded) trigger a stop on its LOW.
   A single dust sell prints a wick low that a 10-second Jupiter price check would usually not see; the CLOSE is
   closer to what Jupiter quotes. I propose: thin minutes stop on the close, traded minutes still on the low. Fair?
2. Or the runs are real but come after a shakeout below -40%, which no stop-based exit survives.

Also coming: your two columns (pre_gain_from_open, pre_vol_usd) are added, and a second file with wait-and-see
entries (buy 5/15/30/60 minutes after the scan, with what the coin did in between) is being built now. I'll send both.
