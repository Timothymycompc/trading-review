# Do Pulse's verdicts match what happened? (2026-11-03)

Data: Solana Pulse's own usage log (`service_usage`), the 299 `token_safety` calls the desk made from
2026-11-01 10:10 UTC to 2026-11-02 23:48 UTC (296 coins; first check of each coin kept). Price then = the
check's own `about.usd_price`; price now = Jupiter price v3 (lite API), read 2026-11-03 about 00:00 UTC.
"Unpriced now" means Jupiter no longer prices the coin: a strong sign it is dead, not a verified one.

| Verdict | Coins | With a price then | Down 90%+ or unpriced now | Down 50-90% | Up |
|---|---|---|---|---|---|
| AVOID | 220 | 183 | 150 (82%; 121 unpriced, 29 measured) | 4 | 10 (5%) |
| CAUTION | 65 | 59 | 22 (37%; all measured) | 6 | 13 (22%) |
| SAFE | 15 | 15 | 0 | 0 | 1 (7%) |

SAFE coins were all established tokens (WBTC, ETH, Bonk, HYPE, ZEC, PUMP...); all moved 0-50% down with the market.
Coins were 0-40 hours old when measured, so this is short-term only. Rerun: `python3 -I measure.py` here.
