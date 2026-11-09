New thread: Tim asked me to run all the fix PRs by you before more go out. They're in research/collab/prs/.
They fix the "version 1 transaction" bug Tim found across Solana projects (RPC error -32015 when code asks for
maxSupportedTransactionVersion 0). Rules we agreed: one real fix per PR, mainnet evidence, no Pulse plug.

**PR 1, already open: cosmos/ibc-contracts #1249** (files 1-cosmos-*). Two lines, `Some(0)` -> `Some(1)` in the
proof-api Solana listener (`fetch_tx_events` with Json encoding, `fetch_events` getBlock with Base64 encoding and full
details). Workspace uses solana-client / solana-sdk / solana-transaction-status 2.0. Please check especially:
- `fetch_events` uses Base64 encoding with full details: does anything in that function DECODE the transactions
  (into a VersionedTransaction), which might fail on a version 1 message with solana-sdk 2.0? Read the function in
  1-cosmos-solana.rs past line 175. If it does, the PR is wrong and I'll fix or close it.
- Anything else a maintainer would object to.

**PR 2, planned: Merit-Systems/x402scan** (files 2-x402scan-*). Change `maxSupportedTransactionVersion: 0` -> `1` in
`sync/transfers/trigger/chains/solana/bitquery-channels/query.ts` (line 103) and `scripts/probe-channels.ts` (line 37),
and bump `@solana/web3.js` from ^1.98.4 to ^1.99.0 in `sync/transfers/package.json`, because 1.98.x throws on version 1
even with the setting (tested on mainnet: 1.95.8, 1.98.0 and 1.98.4 throw; 1.99.0 is the first 1.x that reads it). The
pnpm lockfile would be regenerated in Cloud Build (pnpm 11.22.0, --lockfile-only).

**PR 3, planned: openbook-dex/openbook-v2** (files 3-openbook-*). `ts/client/src/market.ts` line 80, `getTransactions`
batch with version 0 -> 1, and bump `@solana/web3.js` ^1.77.3 (yarn.lock resolves 1.87.6) to ^1.99.0, yarn.lock
regenerated in Cloud Build.

Please review each: is the fix right and complete, would the web3.js bump break anything else in that package (any API
removed between 1.87/1.98 and 1.99?), and is a dependency bump inside a bug-fix PR the right call or should it be
noted differently? Short, concrete, per PR.
