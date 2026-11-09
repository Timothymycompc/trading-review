# Does "reached +20% before -4%" turn into money? Replay the simplest rule on the same minute candles:
# buy at the check, sell everything at +TP% (a resting sell: fills when a minute's high reaches it), stop at -4%
# (fills at the stop, or at the open if the minute opened below it; a minute whose low is 10%+ under the stop is a
# crash and fills at its close), otherwise sell at the last close (6 h). Pessimistic order inside a minute: stop first.
# Costs: 1% per side (swap fee, price impact, slippage). Split by time into halves.
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
FL = os.path.join(HERE, "..", "2026-11-02-fast-lane")
COST = 0.01

def trade(entry, after, tp, stop=0.04):
    s_px = entry * (1 - stop)
    for x in after:
        if x[5] < 1000: continue
        o, h, l, c = x[1], x[2], x[3], x[4]
        if l <= s_px:
            fill = c if l < s_px * 0.9 else min(o, s_px)
            return fill / entry * (1 - COST) / (1 + COST) - 1
        if h >= entry * (1 + tp) and h < entry * 20:
            return (1 + tp) * (1 - COST) / (1 + COST) - 1
    return after[-1][4] / entry * (1 - COST) / (1 + COST) - 1

coins = []
for l in open(os.path.join(FL, "coins.jsonl")):
    c = json.loads(l); p = os.path.join(FL, "ohlcv", c["pool"] + ".json")
    if not os.path.exists(p) or c["verdict"] == "AVOID": continue
    cs = sorted(json.load(open(p))["candles"])
    at = [x for x in cs if x[0] <= c["seen"]]; after = [x for x in cs if c["seen"] < x[0] <= c["seen"] + 6 * 3600]
    if not after: continue
    entry = at[-1][4] if at and c["seen"] - at[-1][0] < 600 else after[0][1]
    coins.append((c["seen"], entry, after))
coins.sort()
half = len(coins) // 2
print(f"{len(coins)} coins Pulse didn't call AVOID (Nov 1-2), 1% cost per side")
for tp in [0.05, 0.1, 0.2, 0.3, 0.5]:
    r = [trade(e, a, tp) for _, e, a in coins]
    a1, a2 = r[:half], r[half:]
    avg = lambda xs: sum(xs) / len(xs) * 100
    print(f"  sell all at +{int(tp*100):>2}%, stop -4%: avg {avg(r):+.1f}%/trade, wins {sum(x > 0 for x in r)}/{len(r)}, "
          f"worst {min(r)*100:.0f}%, halves {avg(a1):+.1f}% / {avg(a2):+.1f}%, $10 each -> ${sum(r)*10:+.2f}")
