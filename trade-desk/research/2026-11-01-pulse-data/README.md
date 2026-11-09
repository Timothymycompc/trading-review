# Edge search on Solana Pulse data, 2026-11-01

Data: Pulse token watch (90 young tokens, readings every ~3h, Oct 23-Nov 1) and the accuracy test (100 young tokens, 7-day outcome). Exported read-only from the pulse database; the exports are not in git.

Method: 3,105 one- and two-condition rules x holding times (6h/24h/72h), entries only from past data, round-trip cost 1.5%-3%, one trade per token per holding period. Found on the first 60% of the period, judged on the last 40%.

Result: 0 rules profitable in both periods. 32 made money in the first period; in the second, 23 of the 30 that traded lost money, average -10%. The baseline lost in every period (buy-and-hold 24h: -24% then -7%). The accuracy tokens: 7 of 100 went up; no check or group made money on average.

Limits: only young memecoins, 9 days, small samples. Says nothing about SOL, JUP, BONK or WIF. Run: python3 study.py <folder with watch.jsonl, watchmeta.jsonl, acc.jsonl>
