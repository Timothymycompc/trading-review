# Solana Pulse: the main project

**What it is:** a safety gateway for AI agents (and people) that touch money on Solana. Before an agent signs a transaction
or buys a token, it can ask Pulse: *is this transaction what I asked for? is this token a known trap? why did that swap fail?*
Every answer comes from live chain data and names its source. A clean result only ever means "none of the traps we know about
are present". Repo: [solana-pulse-ai-agent-gateway](https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway).

**How long:** first commit **2026-08-30**; live on Google Cloud Run since early October; release v0.8.0 on 2026-10-31.
Built in spare time, about 80% of it on a phone (Pixel, Termux + Debian), with Claude Code as the main pair-programmer.

## How it was shaped, from then to now
| When | What it was | What changed it |
|---|---|---|
| Aug 30 | A Google AI Studio app ("solana-pluse-gateway"): hard-coded boilerplate, a Vite front end that crashed in production, MCP calls that tripped over each other | Moved into its own repo and rebuilt: one Express server, plain HTTP + MCP from one tool registry |
| Early Oct | 15 tools, paid per call with **x402** (USDC on Solana), Coinbase facilitator first and PayAI as backup, 25 free calls per tool per day | Tools renamed into plain verbs (`check_tx`, `tx_matches`, `token_safety`, `why_failed`, …); listed in the official MCP registry |
| Oct 16 | Pages were JavaScript-only, so directories and reviewers saw a blank page (one directory rejected it) | Every tool page server-rendered and readable without JavaScript |
| Oct 16 | `token_safety` audit on 500 live tokens: 64% AVOID, 2% SAFE — too harsh, some signals wrong | Bad signals fixed (impossible insider numbers → "unknown", ticker matching, stablecoin list); measured again |
| Oct 19 | Public **benchmark**: 10 real attack/mistake cases (wrong recipient, wrong amount, hidden transfer, balance drain, expired tx…) | 9/9 caught for the right reason, 0 false alarms; then an "everyday" test of 200 real mainnet transactions: **0 false blocks, fees exact 200/200** (was 132/200) |
| Oct 19 | **Found a live bug in the ecosystem:** mainnet started carrying *version 1* transactions (~35–44% of swaps); the standard library couldn't decode them, so `check_tx` said "could not decode" | Pulse fixed the same night. Turned into a bug-report campaign: 31 reports to projects with the same bug; **fixes merged** in Agent402, elizaOS, rotki, moneyswitch, taurvia, sol-parser-sdk-nodejs and UltiMafia |
| Oct 19 | Applied for a **Solana Foundation grant** ($8,500, 6 weeks) | **Rejected 2026-11-01: "not far enough along."** |
| Oct 20–21 | Listed on TensorBlock (merged), awesome-remote-mcp-servers (merged), Pay.sh (PR), sendaifun skills (PR); npm plugin for Solana Agent Kit; demo + walkthrough videos | Listings brought bots and directory scanners, not users |
| Oct 21 | Owner "Explorer": every call, its inputs, and a flag for fake browsers | Showed that most "visitors" were bots faking Chrome/Safari — so usage is counted honestly now |
| Oct 25 | Public Telegram bot **@SolanaPulseCheckBot** | First runs by real people through Telegram |
| Nov 9 | **Rug Check**: a free, plain web page ("is this Solana token a rug pull?") that runs on Pulse's `token_safety` | Distribution pivot: meet people where they panic-search, instead of waiting in agent directories |

## Honest numbers
- **180,825 logged calls** (Oct 9 → Oct 31), almost all from directory scanners, uptime monitors and our own tests.
  **0 confirmed outside paying users**; all-time revenue $1.11, all from our own test payments.
- Benchmark 9/9; everyday test 200/200 with 0 false blocks; 100 young tokens checked and re-checked after 7 days to measure
  whether AVOID/CAUTION calls came true; known-good tokens 47/54 SAFE.
- Competitors appeared during the build (Dexra on Oct 17, then the "Trading Agent Stack"). Pre-sign token checkers are
  becoming common; Pulse's difference is **measurement and honesty**: a public benchmark and a track record that shows misses.

## Problems we hit, and how we dealt with them
| Problem | How we handled it |
|---|---|
| AI-Studio code that broke in production | Rebuilt on a small, tested architecture (TypeScript, Express, one tool registry, recorded mainnet fixtures as tests) |
| Rate limits on free APIs (Jupiter answered 429 after ~5 calls) | Proper API keys in Google Secret Manager, retries, "unknown" instead of guessing when data is missing |
| Renaming tools broke listings (stability score dropped to 0, old names still called) | Kept old names answering during the change; registry publishing automated from GitHub |
| Version 1 transactions | Fixed in Pulse, measured how common they are, reported to 31 projects, followed up until fixed |
| Usage numbers that looked like people but weren't | Tagged known monitors and our own networks, flagged fake browsers, never call a caller a "person" without evidence |
| No users from directories | Moved toward people: Telegram bot, Rug Check page, bug reports that help other developers |
| Grant rejected | Kept going; next targets are Superteam, Colosseum, and re-applying with real users |
| Developing on a phone: headless browsers crash, the full test suite reset the terminal | Videos rendered natively in Termux or in Google Cloud Build; full test runs in the cloud, single test files on the phone |

## Now
Pulse is live and in upkeep. Effort has moved to getting real people to use it (Rug Check, the Telegram bot) and to research
that uses its tools as the data source (the [trading review](trading/README.md)). Sister project
**Base Pulse** is the same idea on Base (live since Oct 14; 18k calls, all probes/directories so far).
