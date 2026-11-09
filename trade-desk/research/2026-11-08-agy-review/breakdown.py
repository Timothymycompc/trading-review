"""Breaks the closed paper trades since the 2026-11-07 12:11 UTC reset down by each entry fact.
Run: python3 -I breakdown.py trades.csv > breakdown.txt"""
import csv, sys, statistics as st

rows = list(csv.DictReader(open(sys.argv[1])))
for r in rows:
    r["pct"] = float(r["pct"]); r["pnl"] = float(r["back"]) - float(r["size"])

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def tier(v, edges, unit=""):
    v = num(v)
    if v is None: return "unknown"
    for e in edges:
        if v < e: return f"<{e:g}{unit}"
    return f">={edges[-1]:g}{unit}"

def ratio(r):
    b, s = num(r["buys_h1"]), num(r["sells_h1"])
    if not b or not s: return "unknown"
    x = b / s
    return "<1.0" if x < 1 else "1.0-1.5" if x < 1.5 else ">=1.5"

def exit_kind(r):
    e = r["exit_reason"].lower()
    for k in ("stop-loss", "trailing", "liquidity", "write", "time", "ladder", "take", "pull", "unpriced"):
        if k in e: return k
    return e.split(":")[0][:30]

groups = {
    "Pulse verdict": lambda r: r["verdict"] or "none",
    "exchange": lambda r: r["dex"] or "unknown",
    "liquidity at buy ($)": lambda r: tier(r["liq_usd"], [10000, 25000, 50000, 100000]),
    "1h volume ($)": lambda r: tier(r["vol_h1"], [10000, 50000, 200000]),
    "buys/sells 1h": ratio,
    "pool age at buy (min)": lambda r: tier(r["pool_age_min"], [10, 60, 360, 1440, 10080]),
    "price change 1h before (%)": lambda r: tier(r["chg_h1"], [-20, 0, 20, 100, 500]),
    "fdv ($)": lambda r: tier(r["fdv"], [50000, 200000, 1000000, 10000000]),
    "held (min)": lambda r: tier(r["held_min"], [1, 5, 30, 120]),
    "exit": exit_kind,
    "UTC hour bucket": lambda r: f"{int(r['opened_utc'][6:8])//6*6:02d}-{int(r['opened_utc'][6:8])//6*6+5:02d}h",
}

def line(name, rs):
    p = [r["pct"] for r in rs]
    wipe = sum(1 for x in p if x <= -50)
    return (f"  {name:<14} n={len(rs):>4}  avg {st.mean(p):+7.1f}%  median {st.median(p):+7.1f}%  "
            f"won {sum(1 for x in p if x > 0)/len(p)*100:4.0f}%  wipeouts(<=-50%) {wipe:>3}  pnl ${sum(r['pnl'] for r in rs):+8.2f}")

lanes = sorted({r["lane"] for r in rows})
print("Closed paper trades since reset 2026-11-07 12:11 UTC. pct = money back / money in - 1 (paper costs ~0.3%/side).")
print("lane names: 2026 = Main, fast = Fast, ladder = Ladder A, ladderB = Ladder B, momo = WAIT-5, copy = Real Wallet Copy\n")
print("== by lane ==")
for l in lanes: print(line(l, [r for r in rows if r["lane"] == l]))
print(line("ALL", rows))

# Ladder A and B bought the same coins; use Ladder A as the main sample, then all lanes pooled.
for title, sample in (("LADDER A only", [r for r in rows if r["lane"] == "ladder"]), ("ALL LANES pooled", rows)):
    print(f"\n########## {title} ##########")
    for g, f in groups.items():
        print(f"\n== {g} ==")
        buckets = {}
        for r in sample: buckets.setdefault(f(r), []).append(r)
        for k in sorted(buckets): print(line(k, buckets[k]))

# Best and worst Ladder A trades with their entry facts.
la = sorted([r for r in rows if r["lane"] == "ladder"], key=lambda r: r["pct"])
cols = ["symbol", "pct", "held_min", "exit_reason", "verdict", "dex", "liq_usd", "vol_h1", "buys_h1", "sells_h1", "pool_age_min", "chg_h1"]
for title, sel in (("15 worst Ladder A", la[:15]), ("15 best Ladder A", la[-15:][::-1])):
    print(f"\n== {title} ==")
    for r in sel: print("  " + " | ".join(str(r[c]) for c in cols))
