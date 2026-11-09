# Regular stocks: Night Desk (US equities, paper)

**Goal:** an overnight research desk that finds rules for trading US stocks/ETFs and paper-trades only the ones that beat
simply holding the S&P 500 (SPY) after costs, on data the rules were not chosen on.

## Data
- Alpaca market data, free IEX feed, daily bars, split/dividend adjusted.
- Universe for backtests: **13 ETFs** (SPY, QQQ and the 11 S&P sector ETFs), **Jul 2020 → Nov 2026** (includes the 2022 bear
  market). ETFs instead of today's big winners, to avoid survivorship bias.
- Costs: 5 bps per side.

## Systems tried
| Round | Rules | How judged |
|---|---|---|
| 1 | 20-day momentum + breakout; 60-day momentum above the 50-day average; pullback in an uptrend | Walk-forward split, newest 40% out of sample, vs SPY buy-and-hold |
| 2 | AI-assisted search (Antigravity/Gemini): 27 rules — trend filters (200-day), sector rotation, panic dip-buying, volatility timing | Searched only on Jul 2020 → Nov 6 2025; the newest year (**Nov 7 2025 → Nov 2026**) was **never written to disk** and tested once |

## Results
- **Round 1:** no rule beat holding SPY out of sample (best +10% vs SPY +30%). Two rules passed a 18/25 quality score on their
  own but still lost to the index — so the gate was changed to also require beating SPY.
- **Round 2:** the 3 finalists (all "hold SPY in uptrends, step aside in downtrends, buy panic dips") beat SPY on the search data
  (+67.6% vs +61.5%, smaller drawdowns). On the locked year:

| Locked year (Nov 2025 → Nov 2026) | Return | Max drawdown |
|---|---|---|
| **Just hold SPY** | **+12.9%** | 8.9% |
| Trend + panic dip (20/200) | +4.9% | 8.9% |
| Trend + panic dip (15/200) | +4.0% | 8.9% |
| Trend only | +4.7% | 8.9% |

## What we found out about regular stocks
- **Holding the index beat every timing rule we built.** Momentum, breakouts, pullbacks, trend filters and sector rotation all
  either lost to SPY or only beat it on the data they were tuned on.
- Trend filters reduced drawdowns in some years, but cost more return than they saved.
- With 27 tries, the multiple-testing-adjusted confidence (deflated Sharpe) of the "winners" was only ~0.70 — below the usual 0.95
  bar — and the locked year confirmed it was luck.

## Mistakes caught along the way
- An early engine compounded overlapping trades as one all-in curve and showed a fake **88% drawdown**; a real one-pot portfolio
  simulation showed 5–9%.
- The deflated-Sharpe check was fed a yearly Sharpe instead of a per-day one, making rules look more trustworthy than they were.
- Only ~5 years of free data: enough for one bear market, not many.

## Verdict
For a regular investor, nothing here beats holding a broad index. The desk keeps running only tiny $50 "unproven" paper probes.
