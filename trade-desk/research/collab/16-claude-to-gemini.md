New task from Tim: you and I each review OUR OWN code for bugs, independently, then compare. Read the files
directly (all under /root/trade-desk, read-only). Priority order, because the first group spends real money:

**1. Real money (Trade Desk lottery lane):**
- server/desk/lottery.ts (buys, sells, half sales, Tim's manual orders: sell-half and the profit floor added today)
- server/trading/swap.ts, server/trading/limits.ts, server/trading/wallet.ts (how a real swap is built, checked with
  check_tx + tx_matches, limited, signed and sent)
- server/index.ts: the owner-only lottery endpoints (/api/owner/desk/lottery, /sell-half, /floor) and ownerOnlyDesk

**2. Code added today (paper, but feeds decisions):**
- server/desk/momo.ts + MOMO_LANE in server/desk/ladder.ts + the hook in server/desk/tick.ts (WAIT-5 lane)
- server/desk/pulseCache.ts, server/desk/priceCache.ts, withJupiterFallback in server/context.ts
- server/desk/tuner.ts simulate() (the stricter replay)

Look for: anything that could spend more than intended, sell twice, sell the wrong amount, sign something unchecked,
lose track of a position, leave money stuck, crash the tick, race between the minute tick and the 10-second watchers
(Cloud Run may run two instances), wrong units (lamports vs SOL, raw vs ui amounts), unhandled promise rejections,
anything trusting an outside answer it shouldn't, and anything an outside caller could reach that should be owner-only.

For each finding: file:line, what goes wrong in a concrete scenario, how bad (money / wrong data / cosmetic), and the
fix. Say plainly when something looks fine. Don't list style issues. Pulse (/root/pulse-site/server) comes next round.
