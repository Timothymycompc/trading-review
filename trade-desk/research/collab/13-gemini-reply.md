### PR 1: `cosmos/ibc-contracts #1249` ([`1-cosmos-solana.rs`](file:///root/trade-desk/research/collab/prs/1-cosmos-solana.rs), [`1-cosmos.diff`](file:///root/trade-desk/research/collab/prs/1-cosmos.diff))
- **Verdict:** **Safe and complete—keep it open as-is.**
- **Does `fetch_events` decode Base64 transactions into `VersionedTransaction`?**
  **No.** Look at [`1-cosmos-solana.rs` lines 178–200](file:///root/trade-desk/research/collab/prs/1-cosmos-solana.rs#L178-L200): `fetch_events` only reads `tx.meta` (`meta.log_messages`) and **never calls `tx.transaction.decode()`**. During JSON deserialization of `get_block_with_config`, `tx.transaction` stays an un-decoded `EncodedTransaction::Binary(String, TransactionBinaryEncoding::Base64)`, and `tx.version` deserializes into `TransactionVersion::Number(u8)`, which is an untagged `u8` in `solana-sdk 2.0` that accepts `1`. In `fetch_tx_events` (lines 121–143), `UiTransactionEncoding::Json` deserializes into `UiTransaction` / `UiRawMessage` (no `deny_unknown_fields`), and the code only reads `tx.transaction.meta` and `tx.slot`.
- **Maintainer point if asked:** Look at [lines 170–173](file:///root/trade-desk/research/collab/prs/1-cosmos-solana.rs#L170-L173): when `get_block_with_config` returns `-32015` (which happens whenever **any** non-IBC transaction in the slot is v1—i.e., ~100% of mainnet blocks), `fetch_events` logs at `tracing::debug!` and returns `Ok(Vec::new())`, **silently dropping every IBC event in that block**.

---

### PR 2: `Merit-Systems/x402scan` ([`2-x402scan-query.ts`](file:///root/trade-desk/research/collab/prs/2-x402scan-query.ts), [`2-x402scan-probe-channels.ts`](file:///root/trade-desk/research/collab/prs/2-x402scan-probe-channels.ts), [`2-x402scan-package.json`](file:///root/trade-desk/research/collab/prs/2-x402scan-package.json))
- **Verdict:** **Right fix; check two monorepo details before opening.**
- **Completeness & safety:**
  - `extractPayouts` ([lines 177–256](file:///root/trade-desk/research/collab/prs/2-x402scan-query.ts#L177-L256)) only touches `instructions`, `accountKeys`, `postTokenBalances`, and `innerInstructions` on `ParsedTransactionWithMeta`, which have identical shapes on v1 transactions.
  - Because [line 24](file:///root/trade-desk/research/collab/prs/2-x402scan-query.ts#L24) re-exports `from '../bitquery/query'`, double-check that no other file under `sync/transfers/trigger/chains/solana/` or `facilitators` calls `getTransaction(s)` / `getParsedTransaction(s)`.
- **Will `@solana/web3.js` `^1.98.4 -> ^1.99.0` break anything?**
  - **No API breakage:** zero APIs were removed between `1.98.4` and `1.99.0`.
  - **Lockfile warning:** You wrote `pnpm 11.22.0`—pnpm only goes up to v9/v10 (npm is 11.x). Check the repo's root `package.json` `"packageManager"` field and run that **exact** `pnpm` version via `corepack` so `pnpm-lock.yaml` doesn't get reformatted across thousands of lines.

---

### PR 3: `openbook-dex/openbook-v2` ([`3-openbook-market.ts`](file:///root/trade-desk/research/collab/prs/3-openbook-market.ts), [`3-openbook-package.json`](file:///root/trade-desk/research/collab/prs/3-openbook-package.json))
- **Verdict:** **Check two things in Cloud Build before opening (`getTransactions` message shape + duplicate `@solana/web3.js` in `yarn.lock`).**
1. **Non-parsed `getTransactions` + `.staticAccountKeys` ([lines 78–100](file:///root/trade-desk/research/collab/prs/3-openbook-market.ts#L78-L100)):**
   Unlike PR 2 (`getParsedTransactions`), `findAllMarkets` calls `connection.getTransactions(batch, ...)` (`json` encoding) and reads `(tx.transaction.message as Message).staticAccountKeys[...]`. Verify on a mainnet v1 tx in `@solana/web3.js 1.99.0` that `getTransactions()` populates `.staticAccountKeys` on `tx.transaction.message`.
2. **Duplicate `@solana/web3.js` in `yarn.lock` breaks `tsc` with `@coral-xyz/anchor@^0.29.0`:**
   In [`3-openbook-package.json`](file:///root/trade-desk/research/collab/prs/3-openbook-package.json#L33-L37), `@coral-xyz/anchor@^0.29.0` also depends on `@solana/web3.js` (currently resolved to `1.87.6` in `yarn.lock`). A naive `yarn install` after editing `package.json` can leave `@coral-xyz/anchor` pinned to `1.87.6` while resolving root to `1.99.x`—causing `yarn build` (`tsc`) to fail with nominal type mismatches on `Connection` / `VersionedTransaction`. Ensure `yarn.lock` deduplicates **all** `@solana/web3.js@^1.x` ranges to the single `1.99.x` resolution and run `yarn build` in Cloud Build to confirm.

---

### Dependency Bump Inside a Bug-Fix PR: Right Call?
- **Yes—keep the `^1.99.0` bump in the same PR.** Without `^1.99.0`, changing `0 -> 1` fails both **compile-time `tsc`** (`TransactionVersion` in `<=1.98.4` is `'legacy' | 0`, so `types:check` / `yarn build` fails) and **runtime Superstruct validation** (`StructError` on `"version": 1`).
- **Just add one sentence in the PR body:** *"Also bumps `@solana/web3.js` to `^1.99.0` because `<=1.98.x` rejects `maxSupportedTransactionVersion: 1` in TypeScript types (`TransactionVersion = 'legacy' | 0`) and throws a client-side `StructError` on `"version": 1` RPC responses."*

Full notes are in [`plan.md`](file:///root/.gemini/antigravity-cli/brain/69b74602-2b14-4795-bc22-54d6e54646f4/plan.md).
