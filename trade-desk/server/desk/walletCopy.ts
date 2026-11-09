// The REAL WALLET COPY (paper, Tim 2026-11-07: "a real wallet copy, buying everywhere the real wallet would").
// The real lottery wallet can't show whether its rules work when it has no SOL, so this lane buys every coin the lottery
// lane's rules would buy, at the same two places in the tick, with its own $1,000 on paper. Paper only: nothing here signs.
//
// The same: Pulse not AVOID, price under LOTTERY.maxPriceUsd, total value at least LOTTERY.minValueUsd, at most
// LOTTERY.maxOpen open, once per coin, and the lottery's exits (COPY_LANE in ladder.ts).
// Different, on purpose or because paper can't see it:
//   - it ignores the wallet's SOL balance (the point of the lane)
//   - $10 a coin, as on the other paper lanes (the real buy is 0.002 SOL), charging about 2.2% a side for young pools
//   - it can't see a real buy being refused (no Jupiter route, check_tx, tx_matches), so it can buy what the wallet couldn't
//   - a coin no source prices for 30 minutes is written off at 0; the real wallet tries to sell after 1 minute
import { pool } from "../db";
import { isRetired } from "./retired";
import type { Candidate } from "./agents";
import { fastPrices } from "./fast";
import { buyInto, COPY_LANE, currentLadder, startLadder } from "./ladder";
import { LOTTERY } from "./lottery";

// Why the lottery's rules wouldn't buy this coin; null = they would. The wallet's balance is deliberately not here.
export function copySkip(c: Pick<Candidate, "priceUsd" | "fdvUsd">, verdict: string | null | undefined, openNow: number) {
  if (!verdict || verdict === "AVOID") return `Pulse says ${verdict ?? "nothing"}`;
  if (!(c.priceUsd !== null && c.priceUsd > 0 && c.priceUsd < LOTTERY.maxPriceUsd)) return `price is not under $${LOTTERY.maxPriceUsd}`;
  if (!(typeof c.fdvUsd === "number" && c.fdvUsd >= LOTTERY.minValueUsd)) return "total value under the minimum or unknown";
  if (openNow >= LOTTERY.maxOpen) return `already ${openNow} open`;
  return null;
}

export async function walletCopyBuy(c: Candidate, verdict: string | null | undefined, fetchJson: (url: string) => Promise<any>, nowMs: number) {
  if (isRetired("copy")) return { bought: false, why: "retired" };
  const run = (await currentLadder(COPY_LANE)) ?? (await startLadder(1000, COPY_LANE));
  const open = Number((await pool.query(`SELECT COUNT(*) AS n FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL`, [run.run_id])).rows[0].n);
  const why = copySkip(c, verdict, open);
  if (why) return { bought: false, why };
  let live: { price: number; liq: number | null; source?: string } | undefined;
  try { live = (await fastPrices(fetchJson, [c.mint])).get(c.mint); } catch {}
  return { bought: await buyInto(COPY_LANE, c, verdict!, live, nowMs) };
}
