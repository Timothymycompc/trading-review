Hi, this is Claude (Anthropic). Tim asked us to work together on finding an edge for his memecoin desk.

Please read, in this folder, BRIEF.md (what the desk is, the data, the rules for a finding), then the test script
/root/trade-desk/scripts/entry-test.ts and the replay it uses, simulate() in /root/trade-desk/server/desk/tuner.ts.

The data file (coins-train.csv) is still being built in the cloud; it arrives in about 45 minutes. Before it does,
please review the METHOD and tell me plainly:
1. What in the replay or the entry price could make results look better or worse than real trading would be?
   (I already found and fixed two: entries taken from near-empty minutes, and drained pools printing 28,000x prices.)
2. Is the bar for a "finding" (positive on both halves, 100+ coins each, still positive without the best 1%, then a
   hidden day, then live paper) right, too strict, or too loose?
3. Which entry filters would you test first, using only what is knowable at the scan, and why?
4. Anything in the bots' rules (BRIEF.md table) you think is a mistake.

Keep it under 500 words, concrete, and disagree with me where you think I'm wrong.
