### Important Tool Note First (No Guessing)

In Antigravity (`agy`), my only web tool is `search_web(query, domain)`, which queries **Google Search snippets**—`agy` does **not** have Claude Code's `WebFetch` tool to fetch URLs directly from `raw.githubusercontent.com`, `api.github.com`, or `github.com/blob/...`.

Because GitHub's `robots.txt` blocks Googlebot from indexing most `/blob/` files, Google Search only holds repo READMEs, Issues/PRs, npm metadata, and occasional code snippets. When I tested asking `search_web` for exact code and line numbers of unindexed files, its grounding model **fabricated code (`Approx. Lines 14–42`)**. Per Tim's rule (*"Only list ones you actually read the code of; when data is missing, say 'unknown'; never guess"*), I will not pass off Google Search summaries as code I read.

Here is:
1. The **3 repos where Google Search returned literal verbatim code snippets** showing the bug, and
2. The **12 highest-priority Solana safety / x402 / payment / MCP candidate repos** I found via `search_web` (none in [`already-reported.txt`](file:///root/trade-desk/research/collab/prs/already-reported.txt)) so you can copy their transaction-reading files + `package.json`/`Cargo.toml` into `/root/trade-desk/research/collab/prs/` for me to read line-by-line.

---

### Part 1: Literal Code Snippets Confirmed in Google's Index

1. **`solana-foundation/solana-com`** (Check if Issue `#2141` is already yours; it wasn't in [`already-reported.txt`](file:///root/trade-desk/research/collab/prs/already-reported.txt))
   - **File & line (from indexed Issue `#2141`):** `apps/web/src/lib/slot200/rpc.ts`, lines 136–147 (commit `d1bb650`)
   - **Literal code:** `return rpc<SampledBlock | null>("getBlock", [slot, { encoding: "json", transactionDetails: "full", rewards: false, commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);`
   - **What breaks:** Fails with `-32015` on ~100% of mainnet blocks. Because it uses a raw `rpc()` JSON-RPC helper (not `@solana/web3.js` Superstruct), changing `0 -> 1` is a 1-line fix if `#2141` is still open.

2. **`mohitparmar1/Solana-Wallet-Security-Scanner`**
   - **File:** `index.ts` (exact line / stars / last commit / web3.js version: `unknown` until `index.ts` and `package.json` are copied locally)
   - **Literal code in snippet:** `getParsedTransaction(sigInfo.signature); if (!tx || !tx.meta) continue; // Check for high-value transfers const valueTransferred = tx.meta.preBalances`
   - **What breaks:** Omits the config object entirely (`maxSupportedTransactionVersion` unset -> legacy-only), failing with `-32015` on **both v0 and v1 transactions**.

3. **`Tee-py/solana-txn-parser`**
   - **Literal code in snippet:** `const txn1 = await connection.getParsedTransaction(txnSig);` (omits `maxSupportedTransactionVersion`; exact file/line/version `unknown` until copied locally).

---

### Part 2: Top 12 Safety / x402 / Payment / MCP Repos to Copy Into `/root/trade-desk/research/collab/prs/`

None of these are in [`already-reported.txt`](file:///root/trade-desk/research/collab/prs/already-reported.txt). If you fetch their transaction-fetching files + manifest (`package.json` / `Cargo.toml` / `pyproject.toml`) into `/root/trade-desk/research/collab/prs/`, I will read every file and give you the exact line numbers, versions, and ranked PR plan:

1. **`OpenZeppelin/relayer-plugin-x402-facilitator`** — OpenZeppelin x402 facilitator plugin; indexed snippet: *"Use channels pooling skipWait feature and getTransaction request."*
2. **`twzrd-sol/twzrd-preflight`** (npm: `twzrd-x402-gate`) — Solana preflight security check + x402 gate (`@solana/web3.js`).
3. **`laurenthalbrun/honeypot-guard`** (npm: `honeypot-guard`) — *"Pre-trade honeypot / rug-pull gate for trading bots... Pay-per-check in USDC via x402."*
4. **`tributary-so/tributary`** (npm: `@tributary-so/payments`) — Solana payment verification SDK indexed with `getParsedTransaction` and `@solana/web3.js`.
5. **`BOBER3r/x402-solana-toolkit`** (npm: `@x402-solana/core`, `@x402-solana/server`) — x402 Solana verifier (`packages/core/src/verifier.ts`).
6. **`OrbytLabz/x402python`** — Python x402 SVM facilitator (`schemes/exact_svm/facilitator.py`, `verifier.py`).
7. **`xka0085-byte/agenttoll`** — ReceiptRail x402 agent payment & receipt verifier (`getParsedTransaction` + MCP server).
8. **`roblambert9/x402-vercel-gateway`** — x402 gateway verifying Solana ATA transfers via `getTransaction` (`jsonParsed`).
9. **`Concorde89/facilitator`** & **`AceDataCloud/FacilitatorX402`** — x402 facilitators verifying Solana USDC transaction signatures on `/verify` and `/settle`.
10. **`openSVM/solana-mcp-server`** — Rust Solana MCP server (~64 stars, `transactions.rs` calling `getTransaction`).
11. **`daog1/sol-mcp`** & **`solana-foundation/solana-dev-mcp`** — Solana MCP servers (`get_solana_transaction` / `get_transaction_with_inner_instructions`, and `index.ts` `getTransaction`).
12. **`hedan8054/sol-sentry`** — AI-Powered Solana Wallet Guardian that monitors transactions and generates threat reports.

Full details are in [`plan.md`](file:///root/.gemini/antigravity-cli/brain/69b74602-2b14-4795-bc22-54d6e54646f4/plan.md).
