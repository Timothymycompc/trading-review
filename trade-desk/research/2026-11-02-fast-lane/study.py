# Fast-lane replay: would "buy young coins the desk checked, take a quick profit, cut a quick loss" have made money?
# Data: coins.jsonl (every coin the desk ran its full safety check on, Nov 1-2, with Pulse's verdict and whether it
# passed the desk's filter) and ohlcv/<pool>.json (GeckoTerminal 1-minute candles for the 6 hours after that check).
#
# How a trade is simulated, on purpose on the strict side:
#   entry  = close of the minute the desk checked the coin in (its price at the check), plus costs; the trade
#            runs on the minutes after it
#   costs  = COST per side (swap fee + price impact + slippage), 1% by default, 2% as a harsh case
#   take profit, two ways:
#     "minute" - the desk looks once a minute: sells when a candle CLOSES at or above the target, at that close
#     "limit"  - a resting limit sell (Jupiter Trigger) at the target: fills when a candle's HIGH reaches it
#   stop   = sells when a candle CLOSES at or below the stop, at that close (a rug candle closes near zero, so a
#            one-swap rug costs nearly everything, as it would for real)
#   both in one candle -> the stop wins (we can't see the order inside a minute)
#   a take-profit only fills in a minute with at least MIN_VOL_USD traded: when a pool is emptied, GeckoTerminal
#            shows absurd prices (up to 800,000x) on tiny trades, and nobody can sell into that; minutes priced
#            over 20x the entry are skipped for the same reason
#   time   = sells at the close of the last candle before the time limit
# A rule only counts if it makes money in BOTH halves (coins split by the time the desk saw them).
# Run: python3 -I study.py > result.txt
import json, os, itertools, statistics

HERE = os.path.dirname(os.path.abspath(__file__))
coins = sorted((json.loads(l) for l in open(f"{HERE}/coins.jsonl")), key=lambda c: c["seen"])
for c in coins:
  p = f"{HERE}/ohlcv/{c['pool']}.json"
  cs = json.load(open(p))["candles"] if os.path.exists(p) else []
  cs = sorted(cs, key=lambda x: x[0])  # [t, o, h, l, c, volume_usd]
  at = [x for x in cs if x[0] <= c["seen"]]  # the minute of the check (or the last trade before it)
  after = [x for x in cs if x[0] > c["seen"]]
  c["entry_price"] = at[-1][4] if at and c["seen"] - at[-1][0] < 600 else (after[0][1] if after else None)
  c["candles"] = after if c["entry_price"] else []
MIN_VOL_USD = 1000

def trade(c, tp, stop, hold_min, mode, cost):
  cs = c["candles"]
  if not cs or not c["entry_price"]: return None
  entry = c["entry_price"] * (1 + cost)
  end = c["seen"] + hold_min * 60
  last = c["entry_price"]
  for t, o, h, l, cl, v in cs:
    if t > end: break
    if cl <= entry * (1 - stop): return cl * (1 - cost) / entry - 1, "stop"
    if v >= MIN_VOL_USD and cl <= entry * 20:  # over 20x in 6 h on a checked coin: an emptied pool's glitch
      last = cl
      if mode == "limit" and h >= entry * (1 + tp): return (1 + tp) * (1 - cost) - 1, "tp"
      if mode == "minute" and cl >= entry * (1 + tp): return cl * (1 - cost) / entry - 1, "tp"
  return last * (1 - cost) / entry - 1, "time"

GROUPS = {
  "passed desk filter, not AVOID": lambda c: c["action"] == "pass" and c["verdict"] != "AVOID",
  "Pulse not AVOID (any filter result)": lambda c: c["verdict"] != "AVOID",
  "all checked coins": lambda c: True,
}
TPS, STOPS, HOLDS = [0.05, 0.08, 0.10, 0.15, 0.20, 0.30], [0.04, 0.06, 0.10, 0.15], [10, 20, 30, 60, 120]

def summary(rs):
  if not rs: return None
  return {"n": len(rs), "avg": statistics.mean(rs), "win": sum(r > 0 for r in rs) / len(rs), "worst": min(rs)}

print(f"coins: {len(coins)}, with candles: {sum(bool(c['candles']) for c in coins)}")
for gname, keep in GROUPS.items():
  pool_ = [c for c in coins if keep(c) and c["candles"]]
  if len(pool_) < 4: print(f"\n=== {gname}: only {len(pool_)} coins with candles, skipped ==="); continue
  half = len(pool_) // 2
  a, b = pool_[:half], pool_[half:]
  print(f"\n=== {gname}: {len(pool_)} coins with candles (first half {len(a)}, second half {len(b)}) ===")
  # What the coins did on their own: best high and close after 6 h, from the entry.
  best = [max([x[2] for x in c["candles"] if x[5] >= MIN_VOL_USD] or [0]) / c["entry_price"] - 1 for c in pool_]
  close = [c["candles"][-1][4] / c["entry_price"] - 1 for c in pool_]
  print(f"  went up 10%+ at some point: {sum(x >= .10 for x in best)}/{len(pool_)}; up 25%+: {sum(x >= .25 for x in best)}; "
        f"6h later down 50%+: {sum(x <= -.5 for x in close)}/{len(pool_)}")
  for mode, cost in [("limit", 0.01), ("minute", 0.01), ("limit", 0.02)]:
    rows = []
    for tp, stop, hold in itertools.product(TPS, STOPS, HOLDS):
      ra = [r[0] for r in (trade(c, tp, stop, hold, mode, cost) for c in a) if r]
      rb = [r[0] for r in (trade(c, tp, stop, hold, mode, cost) for c in b) if r]
      sa, sb = summary(ra), summary(rb)
      if sa and sb: rows.append((tp, stop, hold, sa, sb, summary(ra + rb)))
    both = [r for r in rows if r[3]["avg"] > 0 and r[4]["avg"] > 0]
    print(f"  [{mode} take-profit, {cost*100:.0f}% cost per side] {len(both)} of {len(rows)} rules made money in both halves")
    for tp, stop, hold, sa, sb, s in sorted(both, key=lambda r: -min(r[3]["avg"], r[4]["avg"]))[:5]:
      print(f"    tp +{tp*100:.0f}% stop -{stop*100:.0f}% max {hold:3} min: avg/trade {s['avg']*100:+5.1f}% "
            f"(halves {sa['avg']*100:+5.1f}% / {sb['avg']*100:+5.1f}%), wins {s['win']*100:.0f}%, worst {s['worst']*100:.0f}%, n={s['n']}")
    if not both:
      top = sorted(rows, key=lambda r: -r[5]["avg"])[:3]
      for tp, stop, hold, sa, sb, s in top:
        print(f"    best overall: tp +{tp*100:.0f}% stop -{stop*100:.0f}% max {hold} min: avg {s['avg']*100:+5.1f}% (halves {sa['avg']*100:+5.1f}% / {sb['avg']*100:+5.1f}%)")
  # The rule from the 7-coin look (sell at +10%, stop -6%), in detail.
  for mode in ["limit", "minute"]:
    rs = [trade(c, 0.10, 0.06, 60, mode, 0.01) for c in pool_]
    rs = [r for r in rs if r]
    kinds = {k: sum(1 for r in rs if r[1] == k) for k in ["tp", "stop", "time"]}
    print(f"  tp +10% / stop -6% / 60 min, {mode}: avg {statistics.mean(r[0] for r in rs)*100:+.1f}%, "
          f"exits {kinds}, total on $80 a trade: ${sum(r[0] for r in rs) * 80:+.0f}")
