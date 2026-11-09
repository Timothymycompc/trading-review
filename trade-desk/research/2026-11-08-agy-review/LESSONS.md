# What the desk has learned

Each lesson comes from the desk's own records, and says what changed because of it. None of this makes the desk profitable: no lane has a proven edge. Applied 2026-11-07; every paper lane restarted at $1,000 that day. Older runs stay in the tables, under their old run ids.

| Lesson | Evidence | What changed |
| --- | --- | --- |
| No system makes money yet | Strict replay of 16,071 coins: every exit loses (typical trade -11.6% to -17.9%). Before the reset, live paper: all five lanes down, -4.9% to -29.8% | `/desk` says no bot has a proven edge |
| Exits alone don't create an edge | First 2,400 coins: all four bots lost on every day and both halves | Tuners stay limited to small exit changes, and now replay honestly (below) |
| Replays flatter | +2000% a trade was a bug; +14.2% became +0.9% after Gemini's fixes; a "6,526x" was a drained pool | Tuner fills match `scripts/entry-test.ts`: sales no higher than halfway from high to close, time-limit sales at the next open. `backtest.ts` is marked as not for quoting |
| A silent coin is not a sale at its last price | WAIT-5 live: 6 of 11 trades went silent and were written off at -100%, all but one last priced near or above the buy. The replay treated PumpSwap as never pulled | `PUMPSWAP_PULL=1` replay added; the tuner gives 0 to coins written off live. Re-measured on the 414 hidden-day trades, the same rule goes from +0.9% a trade to -22.7% when silent PumpSwap coins count as written off (-2.1% to -25.1% at 2.2% cost a side). That's the harsh end of the range, and neither end is an edge |
| A live lane must match what it tests | WAIT-5 accepted a scan price from up to 10 minutes later, and bought at a later live price unchecked | 60 s, as in the replay; the live price must still pass the rule; no liquidity exit, as in the replay |
| A stop rule that isn't in code isn't a stop rule | The page promised WAIT-5's 30-trade pause, but no code did it | `momoStop` enforces it |
| Small samples lie | A +3.8% lead on 15 coins lost 5.9% live; Ladder A's first +$11 was one coin | A tuner waits for 40 trades in its own run; reset also clears tuned rules |
| Pulse's verdicts separate rugs; the trading rules lose | AVOID: 82% dead, 5% up (most "dead" have no price at all). SAFE: 0 of 15 dead, all established coins | Main rejects AVOID since 2026-11-04; unchanged here |
| Stops don't protect against rugs | 3 rugs were $224 of the first run's $238 lost; crash fills -70% to -100%; Fast's stops averaged -16.1% against a -6% stop | Page says a crash can fill below the stop. Exits not changed: replay shows no better exit |
| A wrong price can trigger a real sale | BURKAT, Nov 5: the price said -96%, the bot sold, and the sale paid back more than the buy | Before a real stop sells, a real quote must agree |
| One source's silence isn't death | Jupiter answering with no price meant no price, even when another source had one. A failed call also counted toward a write-off | DexScreener fills the gap only for a pool with money that traded in the last hour; a failed call no longer counts |
| Two liquidity numbers aren't comparable | Jupiter's is all pools, DexScreener's is one: a false "pull" | DexScreener's number never feeds the pull check |
| Dead coins must close | Fast and Main kept unpriced coins open at their last price, flattering the balance | Both write off after 30 minutes without a price, as the other lanes do. Main's buy and sell rules are unchanged |
| "Sent" isn't "sold" | MOGZ and PAIRS, Nov 5: sales unconfirmed after a minute were sent again | A pending sale is tracked and booked if it lands, with no new sale for 2 minutes |
| A buy can land late | The 3-minute clock began before the buy was sent, and an unreadable wallet counted as no tokens | The clock starts after the send; an unreadable wallet decides nothing |
| "No route" isn't "Jupiter is down" | HTTP 400 was reported as an outage, so a rugged coin could never be recognised | Reported as no route; the coin is written off and frees its slot |
| Never guess what happened | PEPE, PIRATE and STANK were closed as "an earlier sale landed". The bot had sent no sale; their tokens left the wallet some other way | Said as it is; result marked unknown, and left out of totals rather than counted as 0 |
| The kill switch must stop everything | `TRADING_PAUSED` missed cancels and token-account closes | Both stop now |
| Rate limits stop bots quietly | Nov 5: Main, Fast and WAIT-5 had nearly stopped, and nothing said so | `/desk` shows quiet lanes; `DESK_HEALTH_ALERT` emails the owner at most once an hour |
| An empty wallet measures nothing | The real wallet has 0 SOL, so its rules can't be judged | Real Wallet Copy: a paper lane buying wherever those rules would |
| Tiny real trades don't pay | 0.0001 SOL buys paid ~5% a transaction, and each new coin locks ~0.002 SOL rent | Buys raised to 0.002 SOL on 2026-11-04; unchanged here |

Open review findings that aren't lessons from trading are in [LATER.md](LATER.md).
