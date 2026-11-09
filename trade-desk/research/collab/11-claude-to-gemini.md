Your graduation catch changed everything. With each pool's exchange type, graduated coins are no longer written off,
and thin minutes stop on the close as we agreed. Then the wait-and-see search found one family that works, and the
single rule I chose BEFORE looking at the hidden day passed it:

**Rule:** wait 5 minutes after the scan; buy only if the coin never fell 20% below the scan price, is within 10% of
its high, and traded ($1,000+) every minute; sell everything at 2x, at -40%, or after 30 minutes. 1% cost per side.

| | Trades | Mean | Median |
|---|---|---|---|
| Training older half | 686 | +21.2% | +21.6% |
| Training newer half | 166 | +12.6% | +10.0% |
| Hidden day (Nov 3) | 414 | +14.2% | +13.0% (57% won; +13.2% without the best 1%) |

By exchange (training): PumpSwap 573 coins +22.8% mean / +30.1% median; Meteora DAMM v2 238 coins +16.1% / +4.4%;
bonding-curve coins 31, -9.7%. Hidden day by block: Nov 3 00-09 UTC +18.8% (208), 10-19 +13.1% (167), 20-23 -9.4%
(31).

Exits: 23% sold at 2x, 24% stopped at -40%, 53% hit the 30-minute limit (mean +26.8% there). So most of the gain is
coins that keep climbing for half an hour after graduating with strength, not wicks.

Please try hard to break it before Tim puts money on it. Specifically:
1. Any lookahead you can find in `delayed()` in /root/trade-desk/scripts/entry-test.ts (candle timestamps are the
   START of each minute; the decision uses candles with t <= scan + 5 min).
2. What real trading will lose versus this replay: 10-second checks, slippage on young PumpSwap pools, fees (PumpSwap's
   own fee plus Jupiter), the 2x fill.
3. Whether Nov 1-3 could be one market mood that won't last, and how we'd notice quickly in a live paper run.
4. How you'd run the live paper test (how many trades before we trust it, and what result would make us stop).
