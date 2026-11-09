Why the 31 v1 bug issues ([bug-issue-poster.md](file:///root/.claude/projects/-root/memory/bug-issue-poster.md)) got **7 merged fixes** (`elizaOS`, `rotki`, `Agent402`, `UltiMafia`, `taurvia`, `sol-parser-sdk-nodejs`, `moneyswitch`) but **0 stars**: when you file an issue, the maintainer writes their own patch and closes the tab without clicking a footer link. When you open a **PR**, publish **exact error-string answers**, or give them a **1-command tool**, they click through to your repo.

Here are the 5 highest-leverage moves for the next 4 weeks, ranked:

### 1. Switch the 5,255-Repo Scanner from Filing Issues to Ready-to-Merge Fix PRs
- **What to do:** Use the `v1-scan` hits ([v1-ready-project.md](file:///root/.claude/projects/-root/memory/v1-ready-project.md#L23-L27): `maxSupportedTransactionVersion`, `web3.js >= 1.99.0`, `sec-slippage-20pct-plus`) to open 3–5 clean **fix PRs/day** (starting with the 24 open issues still unpatched). Include a 1-line reproduction/verification command (`npx @solana-pulse/guard check-v1 <sig>`) in the PR test plan.
- **Why it reaches real devs:** Maintainers merge code that saves them work; your repo sits in their commit history and PR feed where the whole team sees and stars it.
- **Who does what:** **Claude end-to-end** (scan, fork, patch, test on mainnet fixture, draft PR). **Tim:** 2 min/day to approve the PR list.
- **Honest measurement:** Merged PR count; `gh api repos/Timothymycompc/solana-pulse/stargazers` cross-checked against target repo contributors; GitHub referrer views (`gh api .../traffic/popular/referrers`).

### 2. Publish Exact Error-String Benchmarks on `dev.to` + `/v1-report` (Search Capture)
- **What to do:** Turn the findings sitting in private `~/v1-ready/FINDINGS.md` ([v1-ready-project.md](file:///root/.claude/projects/-root/memory/v1-ready-project.md#L23)) and Pulse's 9/9 drainer test into two `dev.to` articles and a public `/v1-report` page titled with the exact errors devs Google: *"`RPC -32015`: Why `@solana/web3.js 1.98` Still Fails on Version 1 Transactions (45% of DEX Swaps)"*.
- **Why it reaches real devs:** Zero social media, permanent search traffic from developers actively debugging `-32015` or pre-sign simulation.
- **Who does what:** **Claude end-to-end** (`dev.to` publishing is already enabled in [feedback-claude-can-ship.md](file:///root/.claude/projects/-root/memory/feedback-claude-can-ship.md#L15)). **Tim:** 5 min once to approve the draft.
- **Honest measurement:** `dev.to` views; GitHub referrers from `google.com`/`dev.to`; `npx @solana-pulse/guard` npm downloads.

### 3. Ship `solana-pulse/guard-action` on GitHub Marketplace & PR It to the 7 Warm Repos
- **What to do:** Package the v1 + pre-sign fixture + slippage checks as a free GitHub Action (`solana-pulse/guard-action`) and send a follow-up PR to the 7 maintainers who already fixed their v1 bugs so their CI never regresses.
- **Why it reaches real devs:** Every contributor opening a PR on those repos sees the Action run and links back to `solana-pulse`.
- **Who does what:** **Claude end-to-end** (code, release tag, PRs). **Tim:** 2 min once (one click to check "Publish to GitHub Marketplace" on the release).
- **Honest measurement:** Public workflow runs, GitHub "Used by" count, and stars from contributors of those repos.

### 4. Put a Zero-Setup Paste Box at the Top of Pulse + High-Intent Google Ads
- **What to do:** Add a prominent top-of-page input where pasting any tx signature, base64 tx, or mint runs `tx_version`, `check_tx`, or `token_safety` free in the browser (no MCP/x402 setup), with a *"Star on GitHub / Run via `npx`"* button below the result. Point Tim's small Google Ads test only at exact error/tool queries (`solana -32015`, `solana transaction simulator api`).
- **Why it reaches real devs:** Gives an instant answer instead of an x402 paywall bounce.
- **Who does what:** **Claude end-to-end** (UI + ad keywords). **Tim:** 10 min once to set the Google Ads budget cap.
- **Honest measurement:** Dashboard Explorer checks ([feedback-verify-usage-numbers.md](file:///root/.claude/projects/-root/memory/feedback-verify-usage-numbers.md)): `Made by = Outside`, `input = Typed by caller` (not Example/Empty), not fake-browser, not Tim's networks.

### 5. Publish Fiverr Gigs 2 & 5 ($5 Drain Trace / Token Check) Returning Shareable `/report/<id>` URLs
- **What to do:** Post the already-written Gig 5 (`$5 Solana Drain Trace`, [freelance-gigs.md](file:///root/.claude/projects/-root/memory/freelance-gigs.md#L21)) and Gig 2, and include a permanent read-only `/report/<id>` link on Pulse with every delivery.
- **Why it reaches real people:** Fiverr brings paying humans without social media (Gig 1 already got a buyer message), and buyers share permanent trace reports in their own group chats for Tim.
- **Who does what:** **Claude** generates the `/report/<id>` page and trace output. **Tim:** 15 min once to post the 2 gigs + 1 min per order.
- **Honest measurement:** Paid Fiverr orders + outside human views on `/report/<id>`.
