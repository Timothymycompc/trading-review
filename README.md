# Tim's dev log: Aug–Nov 2026

Everything I've built in my spare time since late August 2026, mostly on a phone, with AI pair-programmers (Claude Code,
plus Google's Antigravity/Gemini for reviews): what each project is, the data it uses, what we tested, what went wrong, how we
fixed it, what we learned, and what we're doing with it now. All numbers come from real data and say where they come from.

| Part | One line |
|---|---|
| [Solana Pulse](solana-pulse.md) | Safety gateway for AI agents on Solana: 15+ tools, x402 payments, public benchmark, found an ecosystem-wide bug. Live since early October |
| [Telegram bots and other projects](bots-and-tools.md) | Five Telegram bots, Base Pulse, Rug Check, V1 Ready, 31 bug reports with 7 fixes merged, ops tools and videos |
| [Trading review](trading/README.md) | Honest backtests of memecoins, stocks and forex — with all code and the raw price data |

## Timeline
| Date (2026) | Milestone |
|---|---|
| Aug 30 | First commit of Solana Pulse (started in Google AI Studio) |
| early Oct | Pulse live on Google Cloud Run with x402 payments; listed in the official MCP registry |
| Oct 14 | Base Pulse live |
| Oct 16–19 | Pulse rebuilt for honesty: no-JS pages, `token_safety` audit, public benchmark 9/9, 200-tx everyday test |
| Oct 19 | Found that ~35–44% of Solana swaps are version 1 transactions many apps can't read; Pulse fixed; Solana Foundation grant submitted |
| Oct 20–21 | Listings (TensorBlock, awesome-remote-mcp-servers, Pay.sh, sendaifun), npm plugin, demo videos |
| Oct 22–25 | CashOut Check, Money Scan, Gig Bidder, Firewood Buyers; @SolanaPulseCheckBot |
| Oct 27–31 | 31 bug reports posted by a scheduled job; first fixes merged; V1 Ready pipeline; Pulse v0.8.0 |
| Nov 1 | Grant rejected ("not far enough along"); Trade Desk memecoin desk starts |
| Nov 8–9 | Memecoin lanes all lose → retired; Night Desk stocks + forex research; Rug Check live; forex forward paper test starts |

## Money made so far: $0
All-time revenue is $1.11, and that was our own test payments. No grant (one rejected), no paid users, no trading profit.
What it did produce: a live product with a public benchmark, an ecosystem bug found and fixed in 7 other projects, five bots,
a pile of honest research, and the skills to build and run cloud services end to end, starting from almost nothing.

## What I'd say I learned
1. **Building is the easy part; getting real users is the hard part.** 180k calls to Pulse and none of them a confirmed
   outside customer.
2. **Honest measurement beats big claims.** The benchmark, the track record with misses, and the trading tests that admit failure
   are the most valuable things here.
3. **Most "wins" are bugs until proven otherwise.** In trading especially.
4. **Real problems found in real data are worth the most.** The version 1 transaction bug got fixes merged in 7 other projects.
5. **A phone and a cloud account are enough to build real services.** Heavy work goes to the cloud; the phone runs the show.

## What we're doing with it now
- **Pulse:** upkeep, and reaching people directly (Rug Check, Telegram bot) instead of waiting in directories.
- **Funding:** next targets Superteam, Colosseum, and re-applying to the Solana Foundation once there are real users.
- **Trading research:** the four surviving forex systems run as a forward paper test (fake money) from Nov 9; the stock desk
  keeps tiny $50 test buys; memecoin lanes are mostly retired.
- **Bots:** deploy the finished ones (CashOut Check, Money Scan, Gig Bidder) one at a time.

## Principles
We build to make the networks better for AI agents and for people — not to add slop, junk or false data, and never to lead
anyone astray. A safety check can't make something safe; it looks for the known ways people get robbed. Every fact names its
source; missing data is "unknown". Ideas wait in LATER.md until the current work is done. Nothing here is financial advice.
