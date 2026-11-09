# Telegram bots and the other projects

Each project has its own repo, its own private owner bot (never shared with Pulse's public bot), and the same base:
TypeScript, Google Cloud Run, Postgres, secrets in Google Secret Manager, and a PRINCIPLES / LATER / README set.

## Telegram bots
| Bot | What it does | State |
|---|---|---|
| **@SolanaPulseCheckBot** | Public: paste a token or transaction, get Pulse's check in plain words | Live (Oct 25) |
| **@Woodfinerbot** (Firewood Buyers) | Finds likely firewood buyers in nine North Texas towns from free data (Overture places, OpenStreetMap, FCC, National Weather Service cold-night alerts, the Texas emerald-ash-borer quarantine list); public request form + QR flyer; owner commands `/best /town /requests /cold /flyer /csv` | Live. First run: 1,232 likely buyers (183 top tier). Reworked Nov 4 to households only |
| **CashOut Check** bot | Paste an online casino, play-to-earn app, Telegram mini-app or deposit wallet → one plain answer (domain signs, license claims, where deposits flow), every fact with its source. Built from real scam investigations | Code + 16 tests (9 recorded real cases) done, [public repo](https://github.com/Timothymycompc/cashout-check); not deployed yet |
| **Money Scan** bot | Every 6 hours: grants, bounties and hackathons that are actually open (not paused, deadline not passed, region fits, matches skills); pings when a paused grant reopens | Built (Oct 23), database ready, waiting on deploy |
| **Gig Bidder** bot | Searches Freelancer.com jobs, filters with rules tested on 195 real jobs (only the 2 real fits passed), drafts a proposal from facts only, hard caps of 1 bid a day / 6 a month | Built (Oct 23), not deployed |

## Other projects
| Project | What | State |
|---|---|---|
| **Base Pulse** | Pulse's safety tools for AI agents paying on Base: `x402_check`, `recipient_check`, `approvals`, sanctions list check, smart-wallet aware `check_tx` / `tx_matches` | Live since Oct 14, [repo](https://github.com/Timothymycompc/base-pulse) |
| **Rug Check** | Free "is this Solana token a rug?" page on top of Pulse, built for search traffic | Live (Nov 9); needs its own domain for ads |
| **V1 Ready** | Measures and helps fix apps that can't read Solana's version 1 transactions: daily share of v1 swaps, a "prove it" script, a scanner for affected repos | Pipeline live in its own cloud project (private for now) |
| **Bug reports** | 31 real bug reports on the v1 transaction issue, posted by a scheduled cloud job (max 6 a day) | Fixes merged in 7 projects |
| **Trade Desk / Night Desk** | Paper-trading research desks for memecoins, stocks and forex | See the [trading review](trading/README.md) |
| **Clip Drop** | Upload a video once, post it to Facebook and Instagram Reels — built for a friend starting out with videos | Built, not deployed |
| **Ops tools** | `pulse-stats` (honest usage), `pulse-status` (PRs, issues, scam sites vs a baseline), `db-look` (read-only database view), `pulse-leads` (public questions Pulse could answer) | In daily use |
| **Videos** | 90-second demo, 5-minute walkthrough, per-tool videos, a "Claude Code + Pulse" session — rendered on the phone or in Cloud Build with real live calls | On the Pulse repo's releases |

## Lessons across all of it
- **Listings are shelves, not customers.** Directories and registries brought scanners and bots, not people.
- **Measure before you claim.** Every verdict tool got a recorded test set, and every claim in a grant or post had to be
  backed by a number we could show.
- **Plain free data goes a long way.** Firewood Buyers runs entirely on free public sources.
- **Automate the boring, cap the risky.** Bug reports and bids run on schedules with hard daily caps.
- **One person can build a lot; distribution is the hard part.**
