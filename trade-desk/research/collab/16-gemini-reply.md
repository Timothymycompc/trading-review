Here is my independent review of Group 1 (real money) and Group 2 (paper/caches/replay), ranked by severity.

---

### Group 1: Real Money (`lottery.ts`, `swap.ts`, `limits.ts`, `wallet.ts`, `index.ts`)

1. **[CRITICAL / MONEY] Session `pg_try_advisory_lock` called on `pool.query()` instead of a dedicated `PoolClient`**
   - **Where:** [`lottery.ts:241, 252`](file:///root/trade-desk/server/desk/lottery.ts#L241-L252) (and [`tick.ts:51, 55`](file:///root/trade-desk/server/desk/tick.ts#L51-L55), [`ladder.ts:216, 236`](file:///root/trade-desk/server/desk/ladder.ts#L216-L236), [`fast.ts:128, 141`](file:///root/trade-desk/server/desk/fast.ts#L128-L141))
   - **Scenario:** `pool.query("SELECT pg_try_advisory_lock($1)", [LOCK])` checks out a random pooled connection `C1`, locks `LOCK` on `C1`, and immediately returns `C1` to `pool`.
     - **Permanent lock leak:** 50s later, `finally { await pool.query("SELECT pg_advisory_unlock($1)", [LOCK]); }` runs on whatever connection `pool` hands out (`C2`). `C2` doesn't own `LOCK`, so Postgres returns `false` (`WARNING: you don't own a lock of type ExclusiveLock`), leaving `LOCK` **permanently stuck on `C1`**. Every later watcher/tick on another connection or second Cloud Run instance gets `ok = false` and **stops watching/selling open real-money lottery positions**.
     - **Re-entrant overlap:** If a second call on the same instance gets handed idle `C1`, Postgres session advisory locks are re-entrant on the same session, so `C1` returns `ok = true` a second time and runs two concurrent watchers (stacking lock count = 2).
   - **Fix:** Add `withAdvisoryLock(lockId, fn)` in [`db.ts`](file:///root/trade-desk/server/db.ts) using `const client = await pool.connect()`, holding `client` while `fn()` runs, and unlocking on that **same `client`** in `finally` before `client.release()`.

2. **[HIGH / MONEY] Concurrent `lotteryBuy` calls in the same tick bypass `LOTTERY.maxOpen` and `LOTTERY.reserveSol`**
   - **Where:** [`tick.ts:138-140, 182, 220`](file:///root/trade-desk/server/desk/tick.ts#L138-L140), [`lottery.ts:145-151`](file:///root/trade-desk/server/desk/lottery.ts#L145-L151), [`swap.ts:58-60, 84`](file:///root/trade-desk/server/trading/swap.ts#L58-L60)
   - **Scenario:** [`tick.ts:138`](file:///root/trade-desk/server/desk/tick.ts#L138) launches `ladderScan` **without `await`** (only awaited at line 220), which calls `lotteryBuy(coinA)` in `onPass` at the same time the main tick reaches [`tick.ts:182`](file:///root/trade-desk/server/desk/tick.ts#L182) and calls `lotteryBuy(coinB)`. If 2 positions are open (`maxOpen = 3`) and the wallet has `0.0046 SOL`, both calls read `open = 2` and `sol = 0.0046` before either inserts or swaps. Because `coinA.mint !== coinB.mint`, both `INSERT ... ON CONFLICT (mint)` succeed and both execute real swaps—buying 4 positions, locking extra ATA rent (`~0.00204 SOL`), and dipping into `reserveSol`. Likewise, [`swap.ts:58`](file:///root/trade-desk/server/trading/swap.ts#L58) checks `spentTodayUsd` before `build` + `send` + `confirm` (up to 60s), only logging to `trade_log` at line 84.
   - **Fix:** Make the `lottery_positions` insert conditional (`INSERT INTO lottery_positions ... SELECT $1,$2,$3 WHERE (SELECT COUNT(*) FROM lottery_positions WHERE status IN ('buying','open')) < $4`) or guard `lotteryBuy` with an advisory lock; in [`swap.ts:78`](file:///root/trade-desk/server/trading/swap.ts#L78), insert a `'sent'` row into `trade_log` immediately when `sendRawTransaction` succeeds, then update its status after `confirm`.

3. **[HIGH / MONEY & ACCOUNTING] Unconfirmed lottery sales (`r.status === "unconfirmed"`) drop `sol_out` and leave `manual_sell` dirty**
   - **Where:** [`lottery.ts:214-227`](file:///root/trade-desk/server/desk/lottery.ts#L214-L227)
   - **Scenario:** `lotteryCheck` only runs its success branch when `r.status === "confirmed"` (line 222). If a sale times out `waitForConfirmation` (`"unconfirmed"`) and lands on-chain 2s later:
     - On `sell_all`: `sol_out` stays `0`, and 30s later line 214 sees `h.raw === 0n` and closes the position as a 100% loss (`sol_out = 0`) even though the SOL arrived.
     - On `sell_half`: 30s later line 216 sees `h.raw < 0.6 * raw_qty` and sets `half_sold = TRUE`, but **never clears `manual_sell = NULL`** and **never credits `sol_out`**.
   - **Fix:** On line 216 set `half_sold = TRUE, manual_sell = NULL`; record `last_sell_sig` on `"unconfirmed"` sales and credit `sol_out` when it confirms on a subsequent look.

4. **[MEDIUM / MONEY] `/api/owner/desk/lottery/floor` coerces `pct: null` or `""` to `0` (immediate break-even sale), and symbol matching can hit twins**
   - **Where:** [`server/index.ts:260-261`](file:///root/trade-desk/server/index.ts#L260-L261), [`lottery.ts:272, 281`](file:///root/trade-desk/server/desk/lottery.ts#L272-L281)
   - **Scenario:** `Number(null) === 0` and `Number("") === 0`. Sending `{"coin": "X", "pct": null}` to clear a floor sets `manual_floor_pct = 0`, which passes `pct >= -0.4 && pct <= 1` and immediately sells the entire position if `up <= 0`. Also, `WHERE status = 'open' AND (mint = $1 OR UPPER(symbol) = UPPER($1))` updates all open positions sharing a symbol.
   - **Fix:** Require `typeof req.body?.pct === "number" && Number.isFinite(req.body.pct)` in [`server/index.ts:260`](file:///root/trade-desk/server/index.ts#L260), and target a single row (`ORDER BY id DESC LIMIT 1`) in `orderSellHalf` / `orderFloor`.

5. **[MEDIUM / STUCK SLOT] Rugged lottery coin with `noRoute` is never written off if `price !== null`**
   - **Where:** [`lottery.ts:228-229`](file:///root/trade-desk/server/desk/lottery.ts#L228-L229)
   - **Scenario:** With [`priceCache.ts:27`](file:///root/trade-desk/server/desk/priceCache.ts#L27) falling back to DexScreener (or Jupiter returning a stale last trade price), a rugged coin can trigger `-40%` stop (`d.action === "sell_all"`) with `price !== null` while Jupiter `/quote` returns `no route`. Because line 228 requires `price === null`, it never writes off the position, occupying one of the 3 `maxOpen` slots.
   - **Fix:** Write off when `r.noRoute && d.action === "sell_all" && (price === null || Number(p.sell_tries) + 1 >= 6)`.

- **What looks fine in Group 1:** [`wallet.ts`](file:///root/trade-desk/server/trading/wallet.ts) signer verification, [`build.ts`](file:///root/trade-desk/server/tools/build.ts) `check_tx` + `tx_matches` + `token_safety` pre-sign gate, and [`server/index.ts`](file:///root/trade-desk/server/index.ts) `ownerOnlyDesk` / `traderOnly` auth gates are all solid.

---

### Group 2: Paper Lanes, Caches & Replay (`momo.ts`, `ladder.ts`, `tick.ts`, `pulseCache.ts`, `priceCache.ts`, `context.ts`, `tuner.ts`)

6. **[HIGH / PAPER & REAL] `priceCache.ts` skips DexScreener when Jupiter returns `200 OK` without pricing a mint**
   - **Where:** [`priceCache.ts:21-28, 56-71`](file:///root/trade-desk/server/desk/priceCache.ts#L21-L28)
   - **Scenario:** `dexScreenerPrices` only runs inside `catch` when Jupiter throws. When Jupiter returns `200 OK` `{}` (omitting a newly graduated coin `M`), line 23 caches `{ at: Date.now(), value: null }`. For the next 8s, `fresh(M)` is `true` with `value: null`, so `usdPrice` in `swap.ts`, `fastBuy`, and `buyInto` get no price and never ask DexScreener.
   - **Fix:** In `flush(q)`, call `dexScreenerPrices` for any mints in `chunk` that Jupiter returned no `usdPrice` for.

7. **[MEDIUM / PAPER & REAL] `pulseCache.ts` keys `inFlight` by `${mint}:${maxAgeMs}` and caches empty/null answers**
   - **Where:** [`pulseCache.ts:37-42`](file:///root/trade-desk/server/desk/pulseCache.ts#L37-L42)
   - **Scenario:** Including `maxAgeMs` in `inFlight`'s key causes simultaneous pull-watch (`90_000`) and buy (`600_000`) checks for the same `mint` to fire twice. And if `pulseTokenSafety` resolves to `null` or `{}` without throwing, `deps.write` caches it for 10 minutes, causing `lotteryBuy` and `ladderScan` to skip the coin as `"Pulse says nothing"`.
   - **Fix:** Key `inFlight` by `mint` alone, and only call `deps.write` when `answer && typeof answer.verdict === "string"`.

8. **[MEDIUM / PAPER] `momo.ts`: Cascading queue starvation on `LIMIT 8`, missing 30-trade pause rule, `< 600` scan window, and `deskReset` omission**
   - **Where:** [`momo.ts:10, 43, 63-69`](file:///root/trade-desk/server/desk/momo.ts#L43-L69), [`report.ts:70-76`](file:///root/trade-desk/server/desk/report.ts#L70-L76)
   - **Scenario:**
     1. When >8 candidates/min enter `desk_momo_queue`, the oldest undecided rows exceed `giveUpMin` (20m). `SELECT ... ORDER BY seen_at LIMIT 8` then spends all 8 slots/min marking old rows `"too late"`, starving fresh 6-minute-old rows until they also expire.
     2. Comment line 10 states `"pause if, after 30 trades, the mean or the median is 0% or worse"`, but no code implements it.
     3. Line 43 still uses `tradedAfter[0] - atSec < 600` instead of `<= 60` (from `entry-test.ts:45`).
     4. `deskReset` ([`report.ts:70-76`](file:///root/trade-desk/server/desk/report.ts#L70-L76)) omits `MOMO_LANE`.
   - **Fix:** Bulk-expire rows older than `giveUpMin` in SQL before `SELECT ... LIMIT 8`; enforce the 30-trade stop rule in `momoDecide`; change `< 600` to `<= 60` on line 43; add `MOMO_LANE` to `deskReset`.

9. **[MEDIUM / PAPER] `server/desk/tuner.ts` `simulate()` is missing the timeout and step-wick fixes from `scripts/entry-test.ts`**
   - **Where:** [`tuner.ts:54-94`](file:///root/trade-desk/server/desk/tuner.ts#L54-L94)
   - **Scenario:** Line 92 still fills timeouts at `last ?? entry` (stale last `$1,000+` candle before a rug) instead of the next candle's open (`afterEnd[1]`), and line 86 fills step targets at full target instead of `Math.min(target, (h + c) / 2)`. That biases the live tuner toward lengthening `maxMinutes`.
   - **Fix:** Port the `afterEnd` timeout fill and `(h + c) / 2` step cap from `scripts/entry-test.ts` into [`tuner.ts`](file:///root/trade-desk/server/desk/tuner.ts#L54-L94).

Full details are in [`plan.md`](file:///root/.gemini/antigravity-cli/brain/69b74602-2b14-4795-bc22-54d6e54646f4/plan.md). Ready to compare notes and move to `/root/pulse-site/server` whenever you are!
