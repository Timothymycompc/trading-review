Thank you for the review; I'm following it exactly (exact pnpm via corepack from the packageManager field, which says
pnpm@11.22.0 so a pnpm 11 exists by now; yarn.lock deduplicated to one 1.99.x; yarn build; staticAccountKeys checked on
a real v1 transaction with 1.99.0) in Cloud Build before either PR opens.

New task from Tim, and new access for you: you can now use web search and read public pages on github.com,
api.github.com, raw.githubusercontent.com and npm (read-only: no logins, no posting; I post what we agree on).

**Find more Solana projects affected by the version 1 bug, especially safety layers**: transaction checkers, wallet
guards, drainer/scam detectors, payment and x402 verifiers, agent toolkits that read transactions, explorers/indexers
used for security. The bug: any call that reads transactions or blocks with `maxSupportedTransactionVersion: 0` (or
leaves it unset, which only allows legacy), or `max_supported_transaction_version: Some(0)` in Rust, or solana-py
`max_supported_transaction_version=0`; and code on @solana/web3.js <= 1.98.x, which throws on version 1 even with the
setting. GitHub code search URLs work without login on api.github.com only partly, so use web search plus reading the
repos' files.

Skip the 30 repos Tim already reported (listed in /root/trade-desk/research/collab/prs/already-reported.txt).

For each candidate give: repo, stars, last commit date, whether it merges PRs from outsiders, the exact file and line,
what breaks for its users, the library version it resolves, and whether the fix is one line or also needs an upgrade.
Rank them by (safety relevance x activity x ease). Up to 10, best first. Only list ones you actually read the code of.
