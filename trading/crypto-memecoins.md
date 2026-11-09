# Memecoins on Solana: Trade Desk

**Goal:** a paper-trading desk (and a tiny real-money "lottery" lane) that scouts new Solana memecoins, filters out scams with
the [Solana Pulse](https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway) safety tools, and tries different exit rules, to see if any lane makes money.

## Data
- Live Solana DEX prices and pools: Jupiter (prices, quotes, liquidity), GeckoTerminal (new pools, 1-minute candles),
  DexScreener (fallback prices). Safety verdicts from Solana Pulse (`token_safety`: SAFE / REVIEW / AVOID).
- Replays: every coin the desk scanned, Nov 1–4 2026 (**23,379 coins**), with 1-minute candles; strict entry test on **16,071**.

## Systems tried (6 paper lanes, $1,000 each)
| Lane | Idea |
|---|---|
| Main | Scout + filter + safety verdict, trailing stop exits |
| Fast | Buy every filter pass (except AVOID), fast exits |
| Ladder A / Ladder B | Sell in steps as price rises |
| WAIT-5 (momentum) | Wait 5 minutes, buy only if still rising |
| Real Wallet Copy | Paper copy of the small real-money lane's rules |

Each lane had an automatic "tuner" that could adjust exits, limited to small changes.

## Results
- **Live paper since the 2026-11-07 reset: all 6 lanes lose. 641 closed trades, −$720 in total.**
  (Ladder A 296 trades −$212; Ladder B 296 trades −$277; Fast −$91; WAIT-5 −$80; Copy −$45; Main −$14.)
- Before the reset, all five lanes were also down (−4.9% to −29.8%).
- **Strict replay of 16,071 coins: every exit rule loses**; the typical trade lost −11.6% to −17.9%.
- An AI-assisted review (Gemini) of the 23k-coin replay found no leads either.
- Lanes were retired 2026-11-08 except Ladder A plus two new experiments.

## What the safety checks did show
The trading rules lost, but the scam filter worked: coins Pulse marked **AVOID were 82% dead** soon after (5% went up), while
**0 of 15 SAFE coins died**. Telling rugs apart is possible; making money trading new memecoins is a different problem.

## Lessons (from the desk's own records)
| Lesson | Evidence |
|---|---|
| Replays flatter | A "+2,000% per trade" was a bug (entries on dust minutes); "+14.2%" became "+0.9%" after a red-team review; a "6,526×" coin was a drained pool |
| Stops don't protect against rugs | 3 rugs were $224 of the first run's $238 lost; crash fills −70% to −100%; Fast's stops averaged −16.1% against a −6% stop |
| A silent coin is not a sale at its last price | 6 of 11 WAIT-5 trades went silent and had to be written off at −100% |
| Small samples lie | A +3.8% lead on 15 coins lost 5.9% live; one lane's first +$11 was a single coin |
| A wrong price can trigger a real sale | A price feed said −96%; the bot sold; the sale paid back more than the buy. Now a real quote must agree first |
| "Sent" isn't "sold" | Unconfirmed sales were re-sent; now pending sales are tracked |
| Tiny real trades don't pay | 0.0001 SOL buys paid ~5% per transaction, and each new coin locks ~0.002 SOL of account rent |
| Rate limits stop bots quietly | Three lanes nearly stopped without saying so; now there's a health alert |

## Verdict
No lane has a proven edge. The useful output was the safety data (rug detection works) and a long list of ways a trading bot
can fool its owner. Source: Trade Desk `LESSONS.md` and `research/2026-11-08-agy-review/`.
