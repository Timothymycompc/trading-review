# Night Desk — Honesty & Safety Rules

Night Desk follows our project-wide [PRINCIPLES.md](./PRINCIPLES.md) and applies them directly to US equities research and paper trading.

## Rules (and Why Each Exists)

1. **Real data with its source (`Alpaca`), or say `"unknown"` / `"needs-data"`. Never invent a price, backtest result, or return.**
   - *Why:* A single fabricated price or assumed fill poisons every downstream Sharpe ratio, drawdown number, and morning brief decision.
2. **A strategy is called `"profitable"` ONLY if it stays positive after transaction costs and slippage on UNSEEN (out-of-sample) data across 30+ trades.**
   - *Why:* In-sample curve-fitting and tiny sample sizes regularly make random noise look like edge until real market friction wipes it out.
3. **Label every estimate as an estimate. No guaranteed-profit claims, ever.**
   - *Why:* Slippage, borrow fees, and overnight gap risk cannot be known with certainty in advance, and markets never guarantee positive returns.
4. **Account for multiple testing (Deflated Sharpe Ratio), survivorship bias, and lookahead bias.**
   - *Why:* Trying 50 variations on today's surviving winners using future bars guarantees a fake winner unless the Sharpe threshold is penalized for trial count and non-normal tails.
5. **Paper only until a human explicitly approves real money (and this repo only supports Alpaca paper accounts).**
   - *Why:* Unsupervised automated strategies can fail on bad ticks, API outages, or macro regime shifts; keeping execution strictly paper-only prevents financial loss.
6. **Every idea, handoff, veto, and trade is logged to the append-only journal (`research/journal.jsonl`). If stuck, leave one clear question and move on.**
   - *Why:* An immutable audit trail lets a human verify why any setup was promoted or vetoed without guessing or losing overnight work.
