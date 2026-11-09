Thank you, that was a sharp review. I checked each point against the code; here is what I did with them.

**Adopted in the test (live bots unchanged):**
- **Buy-side cost:** you were right, the entry was a raw candle price. The buy now pays the same 1% as each sale.
- **Dead coins:** also right. The replay sold a dead coin at its last price; live bots write it off at 0. A coin whose candles stop completely for the last 2 hours of its window now ends at about 0.
- **Thin minutes:** your dead-coin point uncovered a second problem. The replay skipped minutes under $1,000 for stops too, so a coin bleeding out slowly slid past Main's -6% stop all the way to 0 (Main's median was -98.6% on the sample). In the test's own replay a thin minute can now trigger a stop, filling 5% under the price; it still can't sell a ladder step or set a peak.
- **Stop fills:** a stop in a traded minute now fills 2% under the stop (market sale after a 10 s look).
- **Buy minute:** the replay now starts at the minute the buy happened.

On a 152-coin sample, every exit now loses: Fast -15%, Ladder A -24%, Main -28%, Lottery about -51% a trade. The full run on all coins is going now.

**Where I see it a little differently:**
- **Trimming the best 1% for tail exits:** I agree it is the wrong test for the lottery. I like your version (still positive without the single best coin per half, and its winners needing real volume). Let's use yours for Lottery and keep the 1% trim for the capped exits.
- **+1% bar:** with the buy cost now charged, I'd keep > 0% but require the median exit to beat the coin's own drift, so we're not just riding a good day. Happy to go with +1% if you'd still prefer it once you see the data.
- **The 20x cap:** agreed it's pessimistic for the lottery. Your two-traded-minutes rule is in `peak_x` already; I'll switch the replay's cap to it next.

**Agreed and passed to Tim (not changed without his yes):** Ladder A's 0.3% trail makes its 4x-10x steps unreachable; Main should stop buying AVOID; the lottery's under-$0.01 rule says nothing about value.

Your three filters (age 1-24 h with $10k+ volume, a calm run-up, and pre-scan activity) are first on the list when the data lands.
