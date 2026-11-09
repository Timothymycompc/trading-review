# Night Desk FX — what we tested and found (2026-11-09)

All data is real: Oanda v20 practice candles (mid + measured bid/ask spreads), FRED DEXUSEU, Oanda index CFDs,
federalreserve.gov FOMC calendars. Costs = each pair's measured median spread. Overnight financing NOT included.
Periods: 2016–2021 / 2022–Nov 2025 / last 12 months; EUR/USD 2005–2015 and other pairs used as hidden checks.

## Keepers (to forward-test on the Oanda demo)
| System | Rules | Backtest | Script |
|---|---|---|---|
| **Daily trend** | EUR/USD daily. EMA 35>68 trend, EMA 5/16 cross ≤3 candles ago, ATR(14) > its 100-avg, strong candle (body ≥ ½ range). No Bollinger, no stop; take-profit 4×ATR; exit on close past EMA 68 | +2,161 pips 2016→, PF 2.19, 58% wins, DD 574, worst trade −342 | `src/fxSystem.ts`, `scripts/fx-nostop.ts` |
| **4h trend A** | EUR/USD 4h, same entry + Bollinger(20,2) between middle and outer band. SL 2×ATR, breakeven at +2×ATR, trail 1×ATR, TP 6×ATR, EMA 68 exit | +1,410, PF 1.43, 111 trades, DD 621 | `scripts/fx-adapt.ts` |
| **4h trend B** | Same entry, London/NY fills only (07–17 UTC). SL 1.5, BE +1, trail 2×ATR, no TP, EMA 68 exit | +812, PF 1.79, 51 trades, DD 427 | `scripts/fx-best.ts` |
| **FOMC day** | Sell USD 17:00 NY the evening before each SCHEDULED FOMC statement → buy back 17:00 NY on the day (Mueller, Tahbaz-Salehi & Vedolin, J. Finance 2017). EUR/USD, GBP/USD, USD/JPY, AUD/USD | EUR/USD 2005–2026 +2,717 pips, 174 events, t 2.3; positive on all 4 pairs; last 12 months negative on all 4 | `scripts/fx-flows.ts` |

Combined (trend ×3 + FOMC 4 pairs), 2016→: 754 pips/yr, max DD 1,195 → return/DD **0.63** (trend alone 0.41).
≈16%/yr if sized for a 25% max drawdown. 30%/yr at 25% DD needs return/DD ≈ 1.2 → need more unrelated systems.

## Honest warnings
- The trend systems were picked from ~1,500 versions on EUR/USD 2016–2026. The same rules **lost** on 9 other pairs
  (−61.9R) and on EUR/USD 2005–2015 (−7.5R) — `scripts/fx-hidden.ts`. Tim's view: EUR/USD is its own market and a decade
  changes things. Only the forward test can settle it.
- "Take-profit only, no other exit" shows 100% wins but holds losers for years (−2,000 pips open) — never trade it.
- Self-tuning ("learns as it goes") walk-forward did NOT beat a fixed setting (`scripts/fx-adapt.ts`).

## Rejected (lost money)
- 5/16 SMA/EMA crossover on 15m / 1h / 4h / daily, with strong-candle or engulfing confirmation (`fx-crossover.ts`, `fx-candles.ts`)
- EMA ribbon 5/16/35/68 (stacked / bounce off 35), with ATR high/low-volatility gates (`fx-ribbon.ts`)
- Everything on 15-minute and 1-hour charts: 0 of 1,260 stop/trail/TP settings profitable
- Time-of-day (Breedon & Ranaldo 2013): real gross effect on EUR/USD (EU-hours sell +2.25 pips/day, t 4.8) but net of
  the 1.5-pip spread it lost since 2016; GBP/JPY/AUD lose outright (`fx-tod.ts`) — banks can trade it, retail cannot
- Month-end hedge rebalancing (Melvin & Prins 2015): EUR/USD −1,911 pips (`fx-flows.ts`)
- Stocks: no rule beat holding SPY (agy's 27 rules failed the locked year, `scripts/final-check.ts`)
