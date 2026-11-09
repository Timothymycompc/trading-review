"""Edge search on Solana Pulse's own data (token watch readings + accuracy tokens).
Rules are found on the first part of the period (train) and judged only on the later part (test).
Every trade pays a round-trip cost. Prints the baseline, every rule that is profitable in BOTH periods, and how many
rules were tried (so the chance of a lucky survivor can be judged)."""
import json, math, statistics as st, sys, itertools
from datetime import datetime, timedelta

D = sys.argv[1]
def t(s): return datetime.fromisoformat(s.replace("Z", "+00:00"))

meta = {m["mint"]: m for m in map(json.loads, open(f"{D}/watchmeta.jsonl"))}
series = {}
for l in open(f"{D}/watch.jsonl"):
    r = json.loads(l); rd = r["r"] or {}
    p = rd.get("usd_price")
    if not p or p <= 0: continue
    series.setdefault(r["mint"], []).append((t(r["at"]), p, rd.get("liquidity_usd") or 0, rd.get("holders") or 0, rd.get("top10_share_pct")))
for v in series.values(): v.sort()

def cost(liq): return 0.03 if liq < 50_000 else 0.015  # round trip: fees + slippage both ways

def at_or_after(s, i, when):
    for j in range(i + 1, len(s)):
        if s[j][0] >= when: return j
    return None
def back(s, i, hours):
    when = s[i][0] - timedelta(hours=hours); best = None
    for j in range(i, -1, -1):
        if s[j][0] <= when: best = j; break
    return best

# Every possible entry, with features from the past only and the outcome at several horizons.
entries = []
for mint, s in series.items():
    fp = meta.get(mint, {}).get("first_pool_at")
    for i, (ts, p, liq, hold, top10) in enumerate(s):
        f = {"mint": mint, "ts": ts, "liq": liq, "holders": hold, "top10": top10 if top10 is not None else -1,
             "age_h": (ts - t(fp)).total_seconds() / 3600 if fp else -1}
        for h in (3, 12, 24):
            j = back(s, i, h)
            f[f"ret{h}"] = (p / s[j][1] - 1) if j is not None else None
            f[f"liqchg{h}"] = (liq / s[j][2] - 1) if j is not None and s[j][2] else None
            f[f"holdchg{h}"] = (hold / s[j][3] - 1) if j is not None and s[j][3] else None
        for H in (6, 24, 72):
            k = at_or_after(s, i, ts + timedelta(hours=H))
            f[f"out{H}"] = (s[k][1] / p - 1 - cost(liq)) if k is not None else None
        entries.append(f)

allts = sorted(e["ts"] for e in entries)
split = allts[int(len(allts) * 0.6)]
print(f"Watch data: {len(series)} tokens, {len(entries)} readings, {allts[0]:%b %d %H:%M} to {allts[-1]:%b %d %H:%M} UTC; train before {split:%b %d %H:%M}, test after.")

def trades(rule, H, part):
    out, last = [], {}
    for e in entries:
        if e[f"out{H}"] is None: continue
        if (e["ts"] < split) != (part == "train"): continue
        if not rule(e): continue
        # One trade per token per holding period: no overlapping trades on the same token.
        if e["mint"] in last and e["ts"] < last[e["mint"]] + timedelta(hours=H): continue
        last[e["mint"]] = e["ts"]; out.append((e["mint"], e[f"out{H}"]))
    return out

def summary(tr):
    if not tr: return None
    r = [x for _, x in tr]
    return {"n": len(r), "tokens": len({m for m, _ in tr}), "mean": st.mean(r), "median": st.median(r), "win": sum(x > 0 for x in r) / len(r)}

def fmt(s): return "none" if not s else f"{s['n']:>3} trades/{s['tokens']:>2} tokens, mean {s['mean']*100:+6.1f}%, median {s['median']*100:+6.1f}%, win {s['win']*100:3.0f}%"

print("\nBaseline (buy every token at every reading, after costs):")
for H in (6, 24, 72):
    print(f"  hold {H:>2}h  train {fmt(summary(trades(lambda e: True, H, 'train')))} | test {fmt(summary(trades(lambda e: True, H, 'test')))}")

# Simple one- and two-condition rules.
conds = []
for h in (3, 12, 24):
    for th in (-0.5, -0.3, -0.15):
        conds.append((f"price fell >{-th*100:.0f}% in {h}h", lambda e, h=h, th=th: e[f"ret{h}"] is not None and e[f"ret{h}"] <= th))
    for th in (0.15, 0.3, 0.5, 1.0):
        conds.append((f"price rose >{th*100:.0f}% in {h}h", lambda e, h=h, th=th: e[f"ret{h}"] is not None and e[f"ret{h}"] >= th))
    for th in (0.1, 0.25):
        conds.append((f"holders grew >{th*100:.0f}% in {h}h", lambda e, h=h, th=th: e[f"holdchg{h}"] is not None and e[f"holdchg{h}"] >= th))
        conds.append((f"liquidity grew >{th*100:.0f}% in {h}h", lambda e, h=h, th=th: e[f"liqchg{h}"] is not None and e[f"liqchg{h}"] >= th))
    conds.append((f"liquidity fell >20% in {h}h", lambda e, h=h: e[f"liqchg{h}"] is not None and e[f"liqchg{h}"] <= -0.2))
for th in (24, 72, 168):
    conds.append((f"older than {th}h", lambda e, th=th: e["age_h"] >= th))
conds.append(("younger than 24h", lambda e: 0 <= e["age_h"] < 24))
for th in (50_000, 200_000):
    conds.append((f"liquidity over ${th//1000}k", lambda e, th=th: e["liq"] >= th))
for th in (1000, 5000):
    conds.append((f"over {th} holders", lambda e, th=th: e["holders"] >= th))
conds.append(("top 10 hold under 25%", lambda e: 0 <= e["top10"] < 25))

rules = [(n, c) for n, c in conds] + [(f"{a} AND {b}", lambda e, ca=ca, cb=cb: ca(e) and cb(e)) for (a, ca), (b, cb) in itertools.combinations(conds, 2)]
found, tried = [], 0
for name, rule in rules:
    for H in (6, 24, 72):
        tried += 1
        tr, te = summary(trades(rule, H, "train")), summary(trades(rule, H, "test"))
        if not tr or not te or tr["n"] < 8 or te["n"] < 5 or tr["tokens"] < 4 or te["tokens"] < 3: continue
        if tr["mean"] > 0 and te["mean"] > 0 and tr["median"] > 0 and te["median"] > 0:
            found.append((te["mean"], name, H, tr, te))
print(f"\nRules tried: {tried} (rule x holding time). Profitable in train AND test (mean and median, after costs, >=8/5 trades): {len(found)}")
for m, name, H, tr, te in sorted(found, reverse=True)[:25]:
    print(f"  [{H:>2}h] {name}\n        train {fmt(tr)}\n        test  {fmt(te)}")

# Accuracy tokens: one look per token, 7-day outcome.
acc = [json.loads(l) for l in open(f"{D}/acc.jsonl")]
acc = [a for a in acc if a.get("price_then") and a.get("price_now") is not None]
print(f"\nAccuracy tokens with a 7-day result: {len(acc)} (all young, one check each).")
for a in acc:
    a["ret"] = a["price_now"] / a["price_then"] - 1 - cost(a.get("liq_then") or 0)
    a["age_h"] = (t(a["checked_at"]) - t(a["first_pool_at"])).total_seconds() / 3600 if a.get("first_pool_at") else -1
def ag(sel, label):
    r = [a["ret"] for a in acc if sel(a)]
    if r: print(f"  {label:<45} n={len(r):>3}  mean {st.mean(r)*100:+6.1f}%  median {st.median(r)*100:+6.1f}%  up {sum(x>0 for x in r)}")
ag(lambda a: True, "all")
for k in ("liquidity_pull", "creator_history", "insiders", "holder_concentration", "sell_test", "verified"):
    for v in ("pass", "warn", "fail"):
        ag(lambda a, k=k, v=v: (a.get("checks") or {}).get(k) == v, f"{k} = {v}")
ag(lambda a: a["age_h"] >= 30, "older than 30h")
ag(lambda a: (a.get("liq_then") or 0) >= 100_000, "liquidity over $100k")
