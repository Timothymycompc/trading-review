# How many coins the bots looked at reached +5/+10/+20/+50/+100% after the bot first saw (or bought) them?
# Two measures, from GeckoTerminal 1-minute candles: "touched" = a minute's high with $1,000+ traded that minute (what a
# resting sell order could catch); "held" = two minute closes in a row at or above it (what a 10-second watcher could
# realistically sell at). Fake spikes through emptied pools (>20x in one candle) are ignored.
# Sets: replay = every coin the desk safety-checked Nov 1-2 (research/2026-11-02-fast-lane, 6 h after the check);
#       ladder = every coin ladder bot A bought Nov 3 (ohlcv/, from the buy to the fetch).
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
FL = os.path.join(HERE, "..", "2026-11-02-fast-lane")
LEVELS = [0.05, 0.1, 0.2, 0.5, 1.0]

def series(cands, seen, horizon_s):
    cs = sorted(cands)
    at = [x for x in cs if x[0] <= seen]
    after = [x for x in cs if seen < x[0] <= seen + horizon_s]
    if not after: return None
    entry = at[-1][4] if at and seen - at[-1][0] < 600 else after[0][1]
    return entry, after

def peaks(entry, after):
    touched = max([x[2] for x in after if x[5] >= 1000 and x[2] < entry * 20] or [0]) / entry
    held = 0
    for a, b in zip(after, after[1:]):
        if a[5] >= 1000 and b[5] >= 1000 and b[0] - a[0] == 60: held = max(held, min(a[4], b[4]) / entry)
    return touched, held

def report(name, rows):
    n = len(rows)
    print(f"\n{name}: {n} coins with candles")
    for lv in LEVELS:
        t = sum(r[0] >= 1 + lv for r in rows); h = sum(r[1] >= 1 + lv for r in rows)
        print(f"  +{int(lv * 100):>3}%   touched {t:4} ({t / n * 100:4.1f}%)   held 2 closes {h:4} ({h / n * 100:4.1f}%)")

rep = {"all": [], "not AVOID": []}
for l in open(os.path.join(FL, "coins.jsonl")):
    c = json.loads(l); p = os.path.join(FL, "ohlcv", c["pool"] + ".json")
    if not os.path.exists(p): continue
    s = series(json.load(open(p))["candles"], c["seen"], 6 * 3600)
    if not s: continue
    r = peaks(*s); rep["all"].append(r)
    if c["verdict"] != "AVOID": rep["not AVOID"].append(r)
report("Desk-checked coins Nov 1-2, all verdicts (6 h after the check)", rep["all"])
report("  ...of those, not AVOID (what the ladder bots would buy)", rep["not AVOID"])

lad = []
for c in json.load(open(os.path.join(HERE, "ladder_coins.json"))):
    p = os.path.join(HERE, "ohlcv", c["pool"] + ".json")
    if not os.path.exists(p): continue
    s = series(json.load(open(p))["candles"], c["seen"], 24 * 3600)
    if s: lad.append(peaks(*s))
report("Coins ladder bot A bought Nov 3 (from the buy to now)", lad)

# The question that matters for a -4% stop: did it get to +X% BEFORE it ever fell 4% below the entry? Pessimistic inside a
# minute: if one candle touches both, the fall counts first. Uses minute highs/lows with $1,000+ traded.
def before_stop(entry, after, lv, stop=0.04):
    for x in after:
        if x[5] < 1000: continue
        if x[3] <= entry * (1 - stop): return False
        if x[2] >= entry * (1 + lv) and x[2] < entry * 20: return True
    return False
def report2(name, items):
    n = len(items)
    print(f"\n{name}: reached +X% before ever being 4% under the buy ({n} coins)")
    for lv in LEVELS:
        k = sum(before_stop(e, a, lv) for e, a in items)
        print(f"  +{int(lv * 100):>3}%   {k:4} ({k / n * 100:4.1f}%)")
items_all, items_ok = [], []
for l in open(os.path.join(FL, "coins.jsonl")):
    c = json.loads(l); p = os.path.join(FL, "ohlcv", c["pool"] + ".json")
    if not os.path.exists(p): continue
    s = series(json.load(open(p))["candles"], c["seen"], 6 * 3600)
    if not s: continue
    items_all.append(s)
    if c["verdict"] != "AVOID": items_ok.append(s)
report2("Desk-checked coins Nov 1-2, all", items_all)
report2("  ...not AVOID", items_ok)
lad2 = []
for c in json.load(open(os.path.join(HERE, "ladder_coins.json"))):
    p = os.path.join(HERE, "ohlcv", c["pool"] + ".json")
    if os.path.exists(p):
        s = series(json.load(open(p))["candles"], c["seen"], 24 * 3600)
        if s: lad2.append(s)
report2("Ladder A buys Nov 3", lad2)
