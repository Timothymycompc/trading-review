# Brief for Gemini (from Claude): finding an entry edge for Trade Desk

Tim asked the two of us to work on this together, as one team with one goal: find a way of picking coins that really
makes money, or show honestly that there isn't one yet. Claude has run the desk and its tests so far; you bring fresh
eyes. Build on each other's ideas. When you see a problem in Claude's work, say it plainly and kindly, and suggest the
fix; Claude will do the same for you. We settle questions with the numbers, not by arguing. Tim watches the whole
conversation live. You are in plan mode: read and think, don't edit files, don't run trades, don't call paid tools.

## What Trade Desk is
A memecoin desk on Solana, at https://trade-desk-1021990235790.us-central1.run.app (code in ~/trade-desk). Every
minute it scans new and trending pools on GeckoTerminal, asks Solana Pulse (Tim's safety API) whether each coin has
known rug traps, and five bots decide what to buy:

| Bot | Money | Buys | Sells |
|---|---|---|---|
| Main | $1,000 paper | passes strict safety rules + a score | -6% stop, 6% trail after +12% |
| Fast | $1,000 paper | passes safety rules, not AVOID | first of +10%, -6%, 30 min |
| Ladder A | $1,000 paper, $10 a coin | any coin with $1k+ 1h volume, not AVOID | 20% at +2%, tight trails (1%/0.6%/0.3%), -4% stop, more at 4x-10x |
| Ladder B | same coins as A | same | 5% at +5/10/15/20%, break-even stop from +1%, 3.5%/7% trails, -4% stop |
| Lottery | REAL SOL, 0.002 SOL a coin | price under $0.01, not AVOID | half at +100%, -40% stop, 40% trail, 24 h |

Live results so far (Nov 3-4): none is reliably profitable. The big losses are coins that dump 10-15% inside the
10-second check gap, and rugs (liquidity pulled in one swap).

## The data: research/collab/coins-train.csv
One row per coin the desk scanned Nov 1-4 (about 16k coins with usable prices). Columns:
- What was knowable at the scan: `seen_at_utc`, `volume_tier` (small = $1k-10k 1h volume, big = $10k+),
  `pool_age_min` (pool age when seen; blank = unknown), `buy_price_usd`, `run_up_1h` (move in the hour before; mostly
  blank, the price history rarely reaches back that far).
- What happened after: `peak_x` (highest price that held two traded minutes, as a multiple of the buy),
  `minutes_to_peak`, `reached_1_5x/2x/3x` (before a 40% fall), `rugged` (a close 90% under the buy).
- `result_*`: each exit rule's result per trade as a fraction (+0.05 = +5%), replayed pessimistically on 1-minute
  candles with 1% cost per sale.
- `half`: older or newer half by time.

## Limits (please keep them in mind)
- Price history covers at most ~16 hours after the scan, not 24.
- Results are replays on 1-minute candles, not real fills. Real fills are worse (slippage, 10-second gaps).
- No Pulse verdict per coin in this file yet.
- A drained pool prints absurd prices; `peak_x` ignores prices that didn't hold two minutes, and the replay ignores
  one-minute 20x spikes.
- The newest day of coins is NOT in this file. Claude keeps it hidden as the final test. Please don't ask for it.

## The rule for a finding
With 16k coins, some rules look great by luck (on Nov 1, 32 rules that looked profitable lost 10% on new coins).
A finding only counts if, using only columns knowable at the scan:
1. it is positive on the older half AND the newer half, with 100+ coins in each,
2. it stays positive without its best 1% of trades,
3. it then holds on the hidden day (Claude runs that), and then in live paper trading.

## What we want from you
Look for entry filters (which coins to buy) and say which exit fits them. Explain your reasoning, give the exact
rule, and say how many coins it keeps in each half. Also tell us what you think is wrong with this approach.
