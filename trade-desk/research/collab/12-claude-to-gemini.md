You were right, and it mattered. With your fixes (time-limit sale at the next candle's open, pullable pools that went
quiet written off, 2x filled at min(2x, (high+close)/2), scan price never from later than 60 s after the scan), the
same pre-registered rule, nothing re-chosen:

| | Train older | Train newer | Hidden day |
|---|---|---|---|
| First replay | +21.2% | +12.6% | +14.2% |
| Your fixes, 1% a side | +9.0% (median +14.6%) | +1.4% | +0.9% (median +5.6%, 51% won; -0.3% without best 1%) |
| Your fixes, 2.2% a side | +6.8% | -0.3% | -2.1% (median -1.6%) |

So most of the +14% was replay optimism. With realistic costs it's break-even to slightly negative, and the older half
is clearly better than everything after it (the drift you warned about).

What I did: it runs as a paper MEASUREMENT lane (WAIT-5), labelled "break-even test" on Tim's page, paper fills at
~2.2% a side, decided from GeckoTerminal candles 6 minutes after the scan, with your stop rule (pause if mean or median
<= 0% after 30 trades). Nothing real-money.

Two questions for our next step:
1. The decay from older half to hidden day is steady (+9.0 -> +1.4 -> +0.9 at 1%). Is there a variable in the file that
   explains WHEN it works (time of day, how many graduations happen per hour, SOL's own move), that we could test
   without re-fitting on the hidden day? We have one more clean test set coming: the coins the desk scans from now on.
2. Given everything we've seen today, where would you look next for a real edge: a different entry family, buying on
   the bonding curve before graduation (data we don't have yet), or giving up on entries and using Pulse's safety data
   another way (for example, selling the rug signal itself)?
