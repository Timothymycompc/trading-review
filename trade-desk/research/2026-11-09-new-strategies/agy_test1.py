"""agy's test 1 (2026-11-08 review), rule fixed before this run:
PumpSwap pool + 1h volume $50k-$200k + 1h buys/sells 1.0-1.5 at first sight. Exits: every bot's exit already replayed in
coins-<cost>.csv (corrected replay with silent PumpSwap write-offs). Pass line (agy's): > 0% mean on BOTH halves, n >= 100,
still > 0 without the best 1%. Entry facts come from desk_watch (watch.csv), joined by mint.
Run: python3 -I agy_test1.py"""
import csv, statistics as st

watch = {r["mint"]: r for r in csv.DictReader(open("watch.csv"))}

def f(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def picked(w):
    vol, ratio = f(w.get("vol_h1")), f(w.get("ratio0"))
    return w.get("dex") == "pumpswap" and vol is not None and 50_000 <= vol < 200_000 and ratio is not None and 1.0 <= ratio <= 1.5

def summary(xs):
    if not xs: return "n=0"
    xs = sorted(xs); trim = xs[: len(xs) - max(1, len(xs) // 100)] if len(xs) >= 100 else xs[:-1]
    return f"n={len(xs):>4} mean {st.mean(xs)*100:+6.1f}%  median {st.median(xs)*100:+6.1f}%  w/o best 1% {st.mean(trim)*100 if trim else 0:+6.1f}%  won {sum(x>0 for x in xs)/len(xs)*100:3.0f}%"

for cost in ("0.01", "0.022"):
    rows = list(csv.DictReader(open(f"coins-{cost}.csv")))
    joined = [r for r in rows if r["mint"] in watch]
    sel = [r for r in joined if picked(watch[r["mint"]])]
    exits = [k for k in rows[0] if k.startswith("result_") and not k.startswith("result_g_")]
    print(f"\n=== cost {float(cost)*100:.1f}%/side: {len(rows)} replayed coins, {len(joined)} with desk_watch facts, {len(sel)} match the rule ===")
    for e in exits:
        for half in ("older", "newer"):
            xs = [f(r[e]) for r in sel if r["half"] == half and f(r[e]) is not None]
            print(f"  {e[7:]:<20} {half}: {summary(xs)}")
    base = [f(r["result_ladder_a"]) for r in joined if f(r["result_ladder_a"]) is not None]
    print(f"  (all joined coins, Ladder A exit: {summary(base)})")
