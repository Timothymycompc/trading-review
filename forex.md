# Forex: Night Desk FX

**Start:** a trader's tip from years ago — "a 5/16 moving-average crossover with Japanese candlesticks on EUR/USD is
profitable." We tested that, then everything people usually add to it, then effects from published research.

## Data (all real, all named)
| Source | What | Span |
|---|---|---|
| FRED `DEXUSEU` (US Federal Reserve) | EUR/USD daily close | 1999 → 2026 |
| Oanda v20 practice API | EUR/USD 15m / 1h / 4h / daily candles (mid) | 2016 → 2026 (270k 15-minute candles) |
| Oanda v20 practice API, with bid/ask | 4h candles for 10 pairs; 1h for EUR, GBP, JPY, AUD; **measured spreads** | 2016 → 2026; EUR/USD back to 2005 |
| Oanda index CFDs | S&P 500, Euro Stoxx 50, FTSE 100, Nikkei 225, ASX 200 (daily) | 2005 → 2026 |
| federalreserve.gov | Scheduled FOMC announcement dates (unscheduled/notation votes excluded) | 2005 → 2027 |

Costs: each pair's measured median spread (EUR/USD 1.5 pips). Overnight financing not included (noted where it matters).

## 1. Indicator systems (~1,500 versions)
| Tested | Result |
|---|---|
| 5/16 SMA and EMA crossover, daily 1999–2026 | Made a little before 2015, **lost since** (−2 to −3%/yr) |
| Same on 15m / 1h / 4h / daily, plus strong-candle or engulfing confirmation | 15m and 1h lose everywhere (15m: −19,795 pips 2016–21); **4h + engulfing** was the only positive one |
| EMA ribbon 5/16/35/68 (stacked; bounce off the 35), with ATR high/low-volatility gates | 0 of 45 combinations positive in all 3 periods |
| "Everything" system: EMA 35/68 trend + 5/16 trigger + Bollinger + ATR gate + strong candle, with ATR stop → breakeven → trailing stop | **4h: positive in all 3 periods.** Stops were the ingredient that mattered |
| Grid: 1,260 stop/breakeven/trail/take-profit/exit settings per timeframe | 4h: ~70–76% of settings positive; daily 76%; **1h and 15m: 0 of 1,260** |
| Self-tuning walk-forward ("learns as it goes") | Chased last period's winner; **did not beat** a fixed setting |
| No stop, take-profit only | Shows "100% wins" but held losers up to 5½ years at −2,000 pips. **A trap** |

Best EUR/USD results (2016 → 2026, top picks of many):
| System | Pips | Trades | Win % | Profit factor | Max DD |
|---|---|---|---|---|---|
| Daily: no Bollinger, no stop, TP 4×ATR, EMA-68 exit | +2,161 | 24 | 58% | 2.19 | 574 |
| 4h all hours: SL 2, breakeven 2, trail 1, TP 6 (×ATR) | +1,410 | 111 | 42% | 1.43 | 621 |
| 4h London/NY hours: SL 1.5, BE 1, trail 2, no TP | +812 | 51 | 39% | 1.79 | 427 |

**The hidden-data test** (script committed to git *before* it ran): the 4h system, unchanged, on **9 other pairs** lost
**−61.9R** over 515 trades, and on **EUR/USD 2005–2015** it lost −630 pips. Only 2 of 9 pairs were positive. The EUR/USD
result is most likely selection luck — or, as Tim argues, EUR/USD in this decade is its own market. Only forward testing can
settle that.

## 2. "Forced trader" effects from published papers (rules fixed from the papers, committed before running)
| Effect | Paper | Result |
|---|---|---|
| **FOMC day: sell USD from 17:00 NY the evening before a scheduled Fed announcement to 17:00 NY on the day** | Mueller, Tahbaz-Salehi & Vedolin, *Journal of Finance* 2017 | **Holds.** EUR/USD 2005–2026: 174 events, +2,717 pips, avg +15.6, t = 2.3; positive on GBP, JPY, AUD too. Same trade on all other days: −2 to −3 pips. Weak spot: last 12 months negative on all 4 pairs |
| Month-end hedge rebalancing into the London 4pm fix | Melvin & Prins, *Journal of Financial Markets* 2015 | **Fails.** EUR/USD −1,911 pips; others ~flat |
| Time of day: a currency weakens in its own trading hours | Breedon & Ranaldo, *JMCB* 2013 | **Real but not tradeable.** EUR/USD European-hours sell: +2.25 pips/day gross (t = 4.8), but the 1.5-pip spread eats it; lost after costs since 2016 |

## 3. Putting it together
| Portfolio (2016 → 2026) | Pips/yr | Max DD | Return ÷ drawdown |
|---|---|---|---|
| 3 EUR/USD trend systems | 404 | 979 | 0.41 |
| FOMC days, 4 pairs | 350 | 2,684 | 0.13 |
| **Trend ×3 + FOMC** | **754** | **1,195** | **0.63** |

Combining unrelated systems raised return-per-drawdown by half. Sized for a 25% max drawdown, that's ≈16%/yr in a typical
backtest year (35–48% in the best years, ~0% in the worst). Reaching 30%/yr at a survivable drawdown would need a ratio
around 1.2 — more independent systems.

## Now
All four systems run as a **forward paper test** from 2026-11-09: an hourly cloud job re-runs the exact backtest code on live
Oanda prices (a replay from June 2026 matched the backtest trade for trade), plus real demo orders for the daily system at
1 cent a pip.
