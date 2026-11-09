// The LOTTERY LANE (REAL MONEY, started 2026-11-03). Tim: "allow the real wallet to look for memecoins that cost
// fractions of a cent", hoping to catch a big run cheaply. It spends real SOL from the trading wallet, so read this first:
//
// What our own data says (research/2026-11-02-fast-lane, 225 coins the desk checked, 6 hours after it first saw each):
// none reached 50x after the desk saw it (best ~15x), 1 in 5 reached 2-5x, and the coins that died 90%+ typically
// peaked at 1.15x first. The desk only sees a coin after its first big hour, so the launch run is already over. This lane
// is a small, capped bet that measures what real fills, fees and token-account rent cost; it is not expected to profit.
//
// What it buys: priced under $0.01 a token and not AVOID by Solana Pulse (build_tx refuses AVOID too; unknown = no buy),
// from two sources: coins that passed the desk's FILTER, and (Tim 2026-11-03: "any coin that's a fraction of a cent")
// every coin the ladder lane checks: $1,000+ 1h volume, Pump.fun bonding-curve coins included. "Fraction of a cent" says nothing about value (supply is set by the
// creator; almost every memecoin is under a cent), but it is Tim's rule. LOTTERY.buySol each, at most LOTTERY.maxOpen open, always keeping
// LOTTERY.reserveSol back for rent and fees, inside LOTTERY_LIMITS (limits.ts: $5 a buy, $15 a day) and TRADING_PAUSED.
// How it sells (every 10 s, Jupiter prices; buys and sales go through tradeSwap: build_tx with check_tx + tx_matches):
//   - at +100% it sells half: the cost is back, the rest rides for free
//   - before that, -40% sells everything (looser than the paper lanes' -6%, which one minute's noise kept hitting)
//   - after the half sale, a fall of 40% from the highest price sells the rest
//   - after 24 hours everything is sold; a coin Jupiter stops pricing is sold at once (or written off if no route is left)
// After a full sale the empty token account is closed, so its rent (~0.002 SOL) comes back.
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createCloseAccountInstruction } from "@solana/spl-token";
import { pool } from "../db";
import type { ToolContext } from "../tools/types";
import { tradeSwap, type SwapArgs } from "../trading/swap";
import { tradingPaused } from "../trading/limits";
import { tradeWallet } from "../trading/wallet";
import type { Candidate } from "./agents";
import { fastPrices } from "./fast";
import { cachedPriceFetch } from "./priceCache";
import { log } from "./store";
import { isRetired } from "./retired";

export const LOTTERY = {
  // Tim 2026-11-03: "micro of .0001". A new token account's rent (~0.00204 SOL, back when the account is closed after the
  // sale) is 20x the buy, and fees per trade are about the size of the buy: the wallet needs ~0.0025-0.003 SOL per coin.
  // per coin (~$0.19). Was 0.0001 (~$0.01) until 2026-11-04: each transaction's network fee (0.000005 SOL, the HAMSTER
  // buy) was 5% of that, 10-15% a trade with its sales, more than most coins move. At 0.002 the fees are under 1% a trade.
  buySol: 0.002,
  reserveSol: 0.0025, // never spent on buys: kept for the sale fees and the temporary wrapped-SOL account a sale to SOL opens
  // A buy also locks the new token account's rent (~0.00204 SOL, back when it is closed after the sale). Before
  // 2026-11-05 the check left it out, so a buy at ~0.0045 SOL could leave too little to ever sell (code review).
  tokenRentSol: 0.0021,
  maxOpen: 3, // Tim 2026-11-04 evening: "add one more coin" (was 2; 5 before that). Each open coin also locks ~0.0015 SOL of token-account rent
  maxPriceUsd: 0.01, // Tim's "fraction of a cent"
  // Skip launch-floor coins (2026-11-04, from the Claude x Gemini entry test, research/collab): a coin's total value at
  // the scan says far more than its price. Of 5,613 training coins worth $2.5k-4.5k (Pump.fun's launch floor), 1.7%
  // ever reached 2x after the scan; of 2,602 worth $8k-45k, 36% did. Under $8k is not bought; unknown value = no buy.
  minValueUsd: 8_000,
  halfAtPct: 1.0, // +100%: sell half
  stopPct: 0.4, // -40% before the half sale: sell all
  trailPct: 0.4, // 40% below the highest price after the half sale: sell the rest
  maxHours: 24,
  maxMisses: 6, // 6 looks (a minute) without a Jupiter price: sell
  checkSeconds: 10,
  sellRetrySeconds: 30, // one sale attempt per coin per 30 s, so a failing sale can't burn fees
  slippageBps: 300,
  // A sale sent but not confirmed in time can still land (MOGZ and PAIRS, Nov 5: a second sale went out while the first
  // was pending). Its transaction is dead by this long after the wait ends, so only then may the bot try again.
  pendingSaleSeconds: 120,
  // Jupiter has no route but still shows a price (a stale pool): after this many tries the coin is written off, so a dead
  // coin can't hold one of the maxOpen slots for a full day.
  noRouteTries: 20,
};
const RUN = "lottery"; // desk_events run_id for this lane
const LAMPORTS = 1e9;

export async function ensureLotterySchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lottery_positions (
      id BIGSERIAL PRIMARY KEY, mint TEXT UNIQUE NOT NULL, symbol TEXT, opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'buying', buy_signature TEXT, sol_in NUMERIC, usd_in NUMERIC, raw_qty TEXT, decimals INT,
      entry_price NUMERIC, peak_price NUMERIC, last_price NUMERIC, misses INT NOT NULL DEFAULT 0, half_sold BOOLEAN NOT NULL DEFAULT FALSE,
      last_sell_at TIMESTAMPTZ, last_sell_status TEXT, sell_tries INT NOT NULL DEFAULT 0, sol_out NUMERIC NOT NULL DEFAULT 0,
      closed_at TIMESTAMPTZ, exit_reason TEXT
    )`);
  await pool.query(`ALTER TABLE lottery_positions ADD COLUMN IF NOT EXISTS manual_sell TEXT`);
  await pool.query(`ALTER TABLE lottery_positions ADD COLUMN IF NOT EXISTS manual_floor_pct NUMERIC`);
  await pool.query(`ALTER TABLE lottery_positions ADD COLUMN IF NOT EXISTS buy_sent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE lottery_positions ADD COLUMN IF NOT EXISTS pending_sale JSONB`);
  // What the tokens sold for is unknown: they left the wallet without a sale by this bot. Never counted as 0 back.
  await pool.query(`ALTER TABLE lottery_positions ADD COLUMN IF NOT EXISTS out_unknown BOOLEAN NOT NULL DEFAULT FALSE`);
  // PEPE, PIRATE, STANK (Nov 5): closed as "an earlier sale landed", but the bot had sent no sale. Their result is unknown.
  await pool.query(`UPDATE lottery_positions SET out_unknown = TRUE WHERE out_unknown = FALSE AND sol_out = 0 AND sell_tries <= 1 AND exit_reason LIKE 'nothing left to sell%'`);
}

type Holding = { raw: bigint; decimals: number; accounts: { pubkey: string; programId: string; raw: bigint }[] };
export type LotteryDeps = {
  wallet: () => string | null;
  solBalance: (owner: string) => Promise<number>;
  holding: (owner: string, mint: string) => Promise<Holding>;
  swap: (args: SwapArgs) => Promise<any>;
  prices: (mints: string[]) => Promise<Map<string, { price: number; liq: number | null }>>;
  closeAccounts: (owner: string, accounts: Holding["accounts"]) => Promise<string | null>;
  now: () => number;
};

export function liveLotteryDeps(ctx: ToolContext): LotteryDeps {
  const conn = () => ctx.connection("mainnet-beta");
  return {
    wallet: () => tradeWallet()?.publicKey.toBase58() ?? null,
    solBalance: async (owner) => (await conn().getBalance(new PublicKey(owner), "confirmed")) / LAMPORTS,
    holding: async (owner, mint) => {
      const r = await conn().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "confirmed");
      const accounts = r.value.map((a: any) => ({ pubkey: a.pubkey.toBase58(), programId: a.account.owner.toBase58(), raw: BigInt(a.account.data.parsed.info.tokenAmount.amount) }));
      const decimals = Number(r.value[0]?.account.data.parsed.info.tokenAmount.decimals ?? 0);
      return { raw: accounts.reduce((t, a) => t + a.raw, 0n), decimals, accounts };
    },
    swap: (args) => tradeSwap(ctx, args, undefined, "lottery"),
    prices: (mints) => fastPrices(cachedPriceFetch((u) => ctx.fetchJson(u, 10_000)), mints), // shared with the other bots (priceCache.ts)
    closeAccounts: async (owner, accounts) => {
      const wallet = tradeWallet();
      const empty = accounts.filter((a) => a.raw === 0n);
      if (!wallet || wallet.publicKey.toBase58() !== owner || !empty.length) return null;
      const { blockhash } = await conn().getLatestBlockhash("confirmed");
      const ixs = empty.map((a) => createCloseAccountInstruction(new PublicKey(a.pubkey), wallet.publicKey, wallet.publicKey, [], new PublicKey(a.programId)));
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      tx.sign([wallet]);
      return conn().sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    },
    now: Date.now,
  };
}

// Whole tokens as text from raw units ("1500000", 6 -> "1.5"), exact.
export function uiAmount(raw: bigint, decimals: number): string {
  if (!decimals) return raw.toString();
  const s = raw.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
}

// What to do with an open position at the latest price (null = Jupiter didn't price it this look).
export function lotteryDecision(p: { entry_price: number | null; peak_price: number | null; half_sold: boolean; opened_at: string | Date; misses: number; manual_sell?: string | null; manual_floor_pct?: number | string | null }, price: number | null, nowMs: number) {
  const hours = (nowMs - new Date(p.opened_at).getTime()) / 3_600_000;
  // Tim's own order (owner-only POST /api/owner/desk/lottery/sell-half): sell half now, then the rest follows the
  // usual after-half rules (40% trail, 24 h limit).
  if (p.manual_sell === "half" && !p.half_sold && price !== null) { const g = (price / Number(p.entry_price) - 1) * 100; return { action: "sell_half" as const, reason: `Tim asked to sell half (${g >= 0 ? "+" : ""}${g.toFixed(1)}% then)` }; }
  if (hours >= LOTTERY.maxHours) return { action: "sell_all" as const, reason: `time limit: ${LOTTERY.maxHours} h` };
  if (price === null || !p.entry_price)
    return p.misses + 1 >= LOTTERY.maxMisses ? { action: "sell_all" as const, reason: "no price for a minute (Jupiter stopped pricing it)" } : { action: "hold" as const, reason: "no price this look" };
  const up = price / Number(p.entry_price) - 1, pct = `${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}%`;
  // Tim's profit floor (owner-only POST /api/owner/desk/lottery/floor): sell everything left if the price falls back to
  // this gain over the entry (0.10 = +10%). Checked before the usual rules.
  if (p.manual_floor_pct != null && up <= Number(p.manual_floor_pct) + 1e-9) return { action: "sell_all" as const, reason: `Tim's floor: back to ${pct} (floor +${(Number(p.manual_floor_pct) * 100).toFixed(0)}%)` };
  if (!p.half_sold && up >= LOTTERY.halfAtPct) return { action: "sell_half" as const, reason: `${pct}: selling half, the cost is back` };
  if (!p.half_sold && up <= -LOTTERY.stopPct) return { action: "sell_all" as const, reason: `stop: ${pct}` };
  const peak = Math.max(Number(p.peak_price ?? price), price);
  if (p.half_sold && price <= peak * (1 - LOTTERY.trailPct)) return { action: "sell_all" as const, reason: `trail: ${(((price / peak) - 1) * 100).toFixed(1)}% from the high, ${pct} from the entry` };
  return { action: "hold" as const, reason: pct };
}

// Called by the main tick for every coin that passed FILTER. Never throws into the tick.
export async function lotteryBuy(c: Candidate, facts: Record<string, unknown>, deps: LotteryDeps) {
  if (isRetired("lottery")) return { bought: false, why: "retired" };
  const owner = deps.wallet();
  if (!owner) return { bought: false, why: "no trading wallet" };
  if (tradingPaused()) return { bought: false, why: "paused" };
  const verdict = facts.verdict as string | null;
  const skip = async (why: string) => { await log(RUN, "LOTTERY", "skip", `${c.symbol}: ${why}`, { mint: c.mint, symbol: c.symbol }); return { bought: false, why }; };
  if (!verdict || verdict === "AVOID") return skip(`Pulse says ${verdict ?? "nothing"}; the lottery lane never buys AVOID.`);
  if (!(c.priceUsd !== null && c.priceUsd > 0 && c.priceUsd < LOTTERY.maxPriceUsd)) return skip(`price $${c.priceUsd ?? "unknown"} is not under $${LOTTERY.maxPriceUsd}.`);
  if (!(typeof c.fdvUsd === "number" && c.fdvUsd >= LOTTERY.minValueUsd)) return skip(typeof c.fdvUsd === "number"
    ? `total value $${Math.round(c.fdvUsd).toLocaleString("en-US")} is under $${LOTTERY.minValueUsd.toLocaleString("en-US")}: launch-floor coins almost never reach 2x.`
    : `total value unknown: not bought (unknown = no buy).`);
  const open = Number((await pool.query(`SELECT COUNT(*) AS n FROM lottery_positions WHERE status IN ('buying', 'open')`)).rows[0].n);
  if (open >= LOTTERY.maxOpen) return skip(`already ${open} open (at most ${LOTTERY.maxOpen}).`);
  const sol = await deps.solBalance(owner);
  if (sol < LOTTERY.buySol + LOTTERY.tokenRentSol + LOTTERY.reserveSol) return skip(`wallet has ${sol} SOL; a buy needs ${LOTTERY.buySol}, plus ${LOTTERY.tokenRentSol} for the token account's rent, plus ${LOTTERY.reserveSol} kept back so it can be sold.`);
  // Claim the coin first: one buy per coin, ever, even if two ticks overlap.
  const claimed = await pool.query(`INSERT INTO lottery_positions (mint, symbol, sol_in) VALUES ($1, $2, $3) ON CONFLICT (mint) DO NOTHING RETURNING id`, [c.mint, c.symbol, LOTTERY.buySol]);
  if (!claimed.rowCount) return { bought: false, why: "already traded" };
  const id = claimed.rows[0].id;
  let r: any;
  try { r = await deps.swap({ sell: "SOL", buy: c.mint, amount: String(LOTTERY.buySol), slippage_bps: LOTTERY.slippageBps, dry_run: false }); }
  catch (e: any) { r = { status: "error", summary: String(e?.message ?? e).slice(0, 200) }; }
  if (!["confirmed", "unconfirmed"].includes(r.status)) {
    await pool.query(`UPDATE lottery_positions SET status = 'failed', closed_at = NOW(), exit_reason = $2 WHERE id = $1`, [id, `buy ${r.status}: ${r.summary}`.slice(0, 300)]);
    await log(RUN, "LOTTERY", "buy_failed", `${c.symbol}: not bought. ${r.summary}`, { mint: c.mint, symbol: c.symbol, detail: r });
    return { bought: false, why: r.status };
  }
  // buy_sent_at: when the wait for confirmation ended, so a slow buy gets its full time to land.
  await pool.query(`UPDATE lottery_positions SET status = 'open', buy_signature = $2, usd_in = $3, buy_sent_at = $4 WHERE id = $1`, [id, r.signature, r.usd_value, new Date(deps.now()).toISOString()]);
  await setEntry(id, owner, c.mint, deps);
  await log(RUN, "LOTTERY", "buy", `REAL buy ${c.symbol}: ${LOTTERY.buySol} SOL (about $${Number(r.usd_value).toFixed(2)}), ${r.status}. Pulse: ${verdict}. Sells half at +100%, all at -40%, the rest on a 40% trail, all after ${LOTTERY.maxHours} h. ${r.solscan}`,
    { mint: c.mint, symbol: c.symbol, detail: { signature: r.signature, quote: r.quote } });
  return { bought: true };
}

// The entry price from what actually arrived: dollars paid / tokens received (fees and price impact included).
// true = set; false = the wallet holds none; null = the wallet couldn't be read, so nothing is known yet.
async function setEntry(id: number, owner: string, mint: string, deps: LotteryDeps) {
  const h = await deps.holding(owner, mint).catch(() => null);
  if (!h) return null;
  if (h.raw === 0n) return false;
  await pool.query(`UPDATE lottery_positions SET raw_qty = $2, decimals = $3, entry_price = usd_in / $4, peak_price = usd_in / $4 WHERE id = $1 AND usd_in IS NOT NULL`,
    [id, h.raw.toString(), h.decimals, Number(uiAmount(h.raw, h.decimals))]);
  return true;
}

// BURKAT (Nov 5): Jupiter's price said -96%, the bot sold, and the sale paid back more than the buy cost. Before a stop
// sells real coins, ask for a real quote. If selling now would pay more than the stop allows, the price was wrong: hold.
// A quote that can't be had says nothing, so the stop stands.
async function stopIsReal(p: any, h: Holding, deps: LotteryDeps) {
  try {
    const r = await deps.swap({ sell: p.mint, buy: "SOL", amount: uiAmount(h.raw, h.decimals), slippage_bps: LOTTERY.slippageBps, dry_run: true });
    const out = Number(r?.quote?.out_amount) / LAMPORTS;
    if (r?.status !== "dry_run" || !Number.isFinite(out)) return { real: true, out: null };
    return { real: out <= Number(p.sol_in) * (1 - LOTTERY.stopPct), out };
  } catch { return { real: true, out: null }; }
}

async function close(p: any, reason: string, owner: string, deps: LotteryDeps, accounts?: Holding["accounts"]) {
  await pool.query(`UPDATE lottery_positions SET status = 'closed', closed_at = NOW(), exit_reason = $2 WHERE id = $1`, [p.id, reason]);
  let rent = "";
  if (accounts) { try { const sig = await deps.closeAccounts(owner, accounts); if (sig) rent = ` Token account closed, rent back: https://solscan.io/tx/${sig}`; } catch (e: any) { rent = ` Token account not closed: ${String(e?.message ?? e).slice(0, 100)}`; } }
  const row = (await pool.query(`SELECT sol_out, out_unknown FROM lottery_positions WHERE id = $1`, [p.id])).rows[0], out = Number(row.sol_out);
  const result = row.out_unknown ? "out unknown" : `out about ${out.toFixed(4)} SOL (${((out / Number(p.sol_in) - 1) * 100).toFixed(1)}%)`;
  await log(RUN, "LOTTERY", "closed", `${p.symbol}: ${reason}. In ${Number(p.sol_in)} SOL, ${result}.${rent}`, { mint: p.mint, symbol: p.symbol });
}

// One look at every open position.
export async function lotteryCheck(deps: LotteryDeps) {
  const owner = deps.wallet();
  // The kill switch stops everything that signs here, closing token accounts too, and the failed-sale log spam.
  if (!owner || tradingPaused()) return { open: 0, sales: 0 };
  const open = (await pool.query(`SELECT * FROM lottery_positions WHERE status = 'open' ORDER BY id`)).rows;
  if (!open.length) return { open: 0, sales: 0 };
  let prices = new Map<string, { price: number; liq: number | null }>();
  try { prices = await deps.prices(open.map((p: any) => p.mint)); } catch {}
  let sales = 0;
  const nowMs = deps.now();
  for (const p of open) {
    if (p.entry_price === null) {
      // The buy wasn't confirmed when it was sent: see whether the tokens arrived.
      // An unreadable wallet says nothing: never mark a buy as failed on that, or its tokens would be left untracked.
      if ((await setEntry(p.id, owner, p.mint, deps)) !== false) continue;
      if (nowMs - new Date(p.buy_sent_at ?? p.opened_at).getTime() > 3 * 60_000) {
        await pool.query(`UPDATE lottery_positions SET status = 'failed', closed_at = NOW(), exit_reason = 'buy never landed (no tokens after 3 min)' WHERE id = $1`, [p.id]);
        await log(RUN, "LOTTERY", "buy_failed", `${p.symbol}: the buy never landed; nothing was bought.`, { mint: p.mint, symbol: p.symbol });
      }
      continue;
    }
    const price = prices.get(p.mint)?.price ?? null;
    if (price === null) await pool.query(`UPDATE lottery_positions SET misses = misses + 1 WHERE id = $1`, [p.id]);
    else await pool.query(`UPDATE lottery_positions SET last_price = $2, peak_price = GREATEST(peak_price, $2), misses = 0 WHERE id = $1`, [p.id, price]);
    // A sale that was sent but not confirmed: book it if the tokens left, wait while it can still land, then allow a retry.
    if (p.pending_sale) {
      const s = p.pending_sale, h = await deps.holding(owner, p.mint).catch(() => null);
      if (!h) continue;
      const landed = h.raw < BigInt(s.before_raw);
      if (!landed && nowMs - Number(s.at) < LOTTERY.pendingSaleSeconds * 1000) continue;
      await pool.query(`UPDATE lottery_positions SET pending_sale = NULL WHERE id = $1`, [p.id]);
      p.pending_sale = null;
      if (landed) {
        sales++;
        await pool.query(`UPDATE lottery_positions SET sol_out = sol_out + $2 WHERE id = $1`, [p.id, Number(s.out)]);
        await log(RUN, "LOTTERY", "sell", `REAL sale of ${s.action === "sell_half" ? "half of " : ""}${p.symbol} landed after the wait: ${s.reason}. About ${Number(s.out).toFixed(4)} SOL back (Jupiter's quote). https://solscan.io/tx/${s.signature}`, { mint: p.mint, symbol: p.symbol, detail: { signature: s.signature } });
        if (s.action === "sell_half") await pool.query(`UPDATE lottery_positions SET half_sold = TRUE, manual_sell = NULL WHERE id = $1`, [p.id]);
        else if (h.raw === 0n) await close(p, s.reason, owner, deps, h.accounts);
        continue;
      }
    }
    const d = lotteryDecision(p, price, nowMs);
    if (d.action === "hold") continue;
    if (p.last_sell_at && nowMs - new Date(p.last_sell_at).getTime() < LOTTERY.sellRetrySeconds * 1000) continue;
    await pool.query(`UPDATE lottery_positions SET last_sell_at = $2, sell_tries = sell_tries + 1 WHERE id = $1`, [p.id, new Date(nowMs).toISOString()]);
    const h = await deps.holding(owner, p.mint).catch(() => null);
    if (!h) continue;
    // No sale of ours is waiting, so something else moved the tokens: another app holding this wallet's key, for example.
    // Said as it is: the bot doesn't know what they sold for, and it isn't counted as 0 back.
    if (h.raw === 0n) {
      await pool.query(`UPDATE lottery_positions SET out_unknown = TRUE WHERE id = $1`, [p.id]);
      await close(p, "tokens left the wallet without a sale by this bot; what they sold for is unknown", owner, deps, h.accounts);
      continue;
    }
    // An earlier half sale that wasn't confirmed in time may have landed: don't sell half of the half.
    if (d.action === "sell_half" && p.raw_qty && h.raw * 10n < BigInt(p.raw_qty) * 6n) { await pool.query(`UPDATE lottery_positions SET half_sold = TRUE WHERE id = $1`, [p.id]); continue; }
    if (d.action === "sell_all" && d.reason.startsWith("stop")) {
      const q = await stopIsReal(p, h, deps);
      if (!q.real) {
        await log(RUN, "LOTTERY", "stop_refused", `${p.symbol}: the price said ${d.reason}, but a real quote pays ${q.out} SOL on ${Number(p.sol_in)} SOL in. The price is wrong; holding.`, { mint: p.mint, symbol: p.symbol, detail: { price, quote_out_sol: q.out } });
        continue;
      }
    }
    const amount = uiAmount(d.action === "sell_half" ? h.raw / 2n : h.raw, h.decimals);
    let r: any;
    try { r = await deps.swap({ sell: p.mint, buy: "SOL", amount, slippage_bps: LOTTERY.slippageBps, dry_run: false }); }
    catch (e: any) { r = { status: "error", summary: String(e?.message ?? e).slice(0, 200), noRoute: /no route/i.test(String(e?.message)) }; }
    await pool.query(`UPDATE lottery_positions SET last_sell_status = $2 WHERE id = $1`, [p.id, r.status]);
    if (r.status === "confirmed") {
      sales++;
      await pool.query(`UPDATE lottery_positions SET sol_out = sol_out + $2 WHERE id = $1`, [p.id, Number(r.quote?.out_amount ?? 0) / LAMPORTS]);
      await log(RUN, "LOTTERY", "sell", `REAL sale of ${d.action === "sell_half" ? "half of " : ""}${p.symbol}: ${d.reason}. About ${(Number(r.quote?.out_amount ?? 0) / LAMPORTS).toFixed(4)} SOL back. ${r.solscan}`, { mint: p.mint, symbol: p.symbol, detail: { signature: r.signature } });
      if (d.action === "sell_half") await pool.query(`UPDATE lottery_positions SET half_sold = TRUE, manual_sell = NULL WHERE id = $1`, [p.id]);
      else { const after = await deps.holding(owner, p.mint).catch(() => null); await close(p, d.reason, owner, deps, after?.accounts); }
    } else if (r.status === "unconfirmed") {
      // Stamped now, not when the look began: the wait for confirmation takes about a minute.
      await pool.query(`UPDATE lottery_positions SET pending_sale = $2, last_sell_at = $3 WHERE id = $1`,
        [p.id, JSON.stringify({ action: d.action, reason: d.reason, signature: r.signature, out: Number(r.quote?.out_amount ?? 0) / LAMPORTS, before_raw: h.raw.toString(), at: deps.now() }), new Date(deps.now()).toISOString()]);
      await log(RUN, "LOTTERY", "sell_pending", `${p.symbol}: sale (${d.reason}) sent, not confirmed yet. No new sale for ${LOTTERY.pendingSaleSeconds} s. ${r.solscan}`, { mint: p.mint, symbol: p.symbol, detail: { signature: r.signature } });
    } else if (r.noRoute && (price === null || Number(p.sell_tries) + 1 >= LOTTERY.noRouteTries)) {
      // Half sales count too: a dead pool still showing 2x asks for "sell half" forever, and would hold its slot for 24 hours.
      await close(p, `written off: ${price === null ? "no price and" : "still priced, but"} no route left to sell (rugged)`, owner, deps);
    } else {
      await log(RUN, "LOTTERY", "sell_failed", `${p.symbol}: sale (${d.reason}) ${r.status}: ${r.summary ?? ""} Trying again in ${LOTTERY.sellRetrySeconds} s.`, { mint: p.mint, symbol: p.symbol });
    }
  }
  return { open: open.length, sales };
}

// The lane's price watcher, next to the fast lane's (own lock): looks every 10 s for forMs.
const LOCK = 7_331_003;
export async function lotteryWatch(deps: LotteryDeps, forMs: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  if (!deps.wallet()) return { off: "no trading wallet" };
  const got = await pool.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
  if (!got.rows[0]?.ok) return { skipped: "another lottery watcher is running" };
  try {
    const t0 = deps.now(), out = { checks: 0, sales: 0, errors: [] as string[] };
    for (;;) {
      try { const r = await lotteryCheck(deps); out.checks++; out.sales += r.sales; if (!r.open) break; }
      catch (e: any) { out.errors.push(String(e?.message ?? e).slice(0, 100)); }
      if (deps.now() - t0 + LOTTERY.checkSeconds * 1000 > forMs) break;
      await sleep(LOTTERY.checkSeconds * 1000);
    }
    return out;
  } finally { await pool.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
}

// For the owner: the wallet, every position and the totals. Owner key only (real money, not on the public page).
export async function lotteryState(deps: LotteryDeps) {
  const owner = deps.wallet();
  const rows = (await pool.query(`SELECT * FROM lottery_positions ORDER BY id DESC`)).rows;
  const all = rows.filter((r: any) => r.status === "closed");
  // Totals only from coins whose result is known; the others are counted apart (closed_unknown_result), never as 0 back.
  const done = all.filter((r: any) => !r.out_unknown);
  const solIn = done.reduce((t: number, r: any) => t + Number(r.sol_in), 0), solOut = done.reduce((t: number, r: any) => t + Number(r.sol_out), 0);
  return {
    wallet: owner, sol: owner ? await deps.solBalance(owner).catch(() => null) : null, paused: tradingPaused(), rules: LOTTERY,
    open: rows.filter((r: any) => r.status === "open" || r.status === "buying"), closed: all.slice(0, 20), failed_buys: rows.filter((r: any) => r.status === "failed").length,
    closed_count: all.length, closed_unknown_result: all.length - done.length, wins: done.filter((r: any) => Number(r.sol_out) > Number(r.sol_in)).length, sol_in_closed: solIn, sol_out_closed: solOut,
    activity: (await pool.query(`SELECT at, action, symbol, reason FROM desk_events WHERE run_id = $1 ORDER BY id DESC LIMIT 15`, [RUN])).rows,
  };
}

// Tim's order to sell half of an open coin at the next look. Returns the position, or null if no such open coin.
export async function orderSellHalf(mintOrSymbol: string) {
  await ensureLotterySchema();
  const r = await pool.query(`UPDATE lottery_positions SET manual_sell = 'half' WHERE status = 'open' AND half_sold = FALSE AND (mint = $1 OR UPPER(symbol) = UPPER($1)) RETURNING id, mint, symbol`, [mintOrSymbol]);
  if (!r.rowCount) return null;
  await log(RUN, "LOTTERY", "order", `Tim ordered: sell half of ${r.rows[0].symbol} at the next look.`, { mint: r.rows[0].mint, symbol: r.rows[0].symbol });
  return r.rows[0];
}

// Tim's profit floor for an open coin: sell everything left if the price falls back to entry x (1 + pct).
export async function orderFloor(mintOrSymbol: string, pct: number) {
  await ensureLotterySchema();
  const r = await pool.query(`UPDATE lottery_positions SET manual_floor_pct = $2 WHERE status = 'open' AND (mint = $1 OR UPPER(symbol) = UPPER($1)) RETURNING id, mint, symbol`, [mintOrSymbol, pct]);
  if (!r.rowCount) return null;
  await log(RUN, "LOTTERY", "order", `Tim ordered: sell what's left of ${r.rows[0].symbol} if it falls back to +${(pct * 100).toFixed(0)}% over the entry.`, { mint: r.rows[0].mint, symbol: r.rows[0].symbol });
  return r.rows[0];
}
