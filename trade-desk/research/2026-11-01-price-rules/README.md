# Price-rule search: SOL, JUP, BONK, WIF, 2026-11-01

Data: about 7 months of hourly price and volume (GeckoTerminal, each token's main Solana pool, Mar/Apr to Nov 1, 2026). Not in git; re-download with fetch.py.

436 rules (109 per token): SMA crosses, price above SMA, Bollinger bounce and breakout, RSI, breakouts above recent highs, momentum, volume spikes, hours of the day, days of the week, and dip buys inside an uptrend. Long-only (token or USDC), costs 0.1% (SOL) to 0.3% per side, decisions at each hour's close. Found on the first 60%, judged on the last 40%.

Result: 0 rules made money AND beat simply holding in both periods (random rules with the same trading produced 2). The test period rose 19-35% on every token, which is hard to beat by being out of the market part of the time.

25 rules made money in both periods. Three of them also beat random timing in both periods (luck.txt), which makes them candidates for a forward paper test, not proven edges (they were picked from 436):
- JUP: in an uptrend (above SMA168), buy below the Bollinger(20,2) lower band, sell at the middle band or after 48h.
- JUP: after an hour with volume over 5x its 48h average and the price up, hold 24h.
- WIF: buy below the Bollinger(20,2.5) lower band, sell at the middle band or after 72h.
