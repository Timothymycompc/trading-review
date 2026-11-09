"""Searches wait-and-see entry rules on the TRAINING coins only (seen before the hidden day), for the Claude x Gemini
work. A rule = wait k minutes, then buy only if up to 3 conditions on what the coin did meanwhile hold, scored on one
exit. It reports how many rules were tried, so a "winner" can be weighed against luck, and every survivor still has to
pass the hidden day (Claude runs that separately; this script never reads it).
  python3 -I wait_search.py coins-wait-train.csv
Bar to survive: mean > 0 in the older AND newer half, 100+ coins in each half, and still > 0 without the best coin."""
import csv, itertools, statistics, sys

rows = list(csv.DictReader(open(sys.argv[1])))
EXITS = [k for k in rows[0] if k.startswith("result_")]
num = lambda r, k: float(r[k])

# Conditions: (label, test). Thresholds are round numbers chosen before looking, not tuned to the data.
CONDS = [
    ("held: now >= scan price", lambda r: num(r, "move_since_scan") >= 0),
    ("up 20%+ since scan", lambda r: num(r, "move_since_scan") >= 0.2),
    ("up 50%+ since scan", lambda r: num(r, "move_since_scan") >= 0.5),
    ("down 20%+ since scan", lambda r: num(r, "move_since_scan") <= -0.2),
    ("never fell 20% below scan", lambda r: num(r, "low_since_scan") > -0.2),
    ("within 10% of its high", lambda r: num(r, "off_high") > -0.1),
    ("30%+ off its high", lambda r: num(r, "off_high") <= -0.3),
    ("$20k+ traded since scan", lambda r: num(r, "volume_usd") >= 20_000),
    ("$100k+ traded since scan", lambda r: num(r, "volume_usd") >= 100_000),
    ("$5k+ in the last 5 min", lambda r: num(r, "volume_last5_usd") >= 5_000),
    ("60%+ up-minutes", lambda r: num(r, "green_share") >= 0.6),
    ("traded every minute", lambda r: num(r, "traded_minutes") >= int(r["wait_min"])),
]

def stats(xs):
    xs = sorted(xs)
    return len(xs), statistics.fmean(xs), statistics.median(xs), (statistics.fmean(xs[:-1]) if len(xs) > 1 else -1)

tried, survivors = 0, []
for k in sorted({r["wait_min"] for r in rows}, key=int):
    base = [r for r in rows if r["wait_min"] == k]
    for n in (1, 2, 3):
        for combo in itertools.combinations(CONDS, n):
            picked = [r for r in base if all(t(r) for _, t in combo)]
            if len(picked) < 200: tried += len(EXITS); continue
            for ex in EXITS:
                tried += 1
                o = [num(r, ex) for r in picked if r["half"] == "older"]; nw = [num(r, ex) for r in picked if r["half"] == "newer"]
                if len(o) < 100 or len(nw) < 100: continue
                so, sn = stats(o), stats(nw)
                if so[1] > 0 and sn[1] > 0 and so[3] > 0 and sn[3] > 0:
                    survivors.append((min(so[1], sn[1]), k, " AND ".join(l for l, _ in combo), ex, so, sn))

print(f"Rules tried: {tried}. Survivors (positive on both halves, 100+ coins each, still positive without the best coin): {len(survivors)}")
print("With this many tries, a few survivors are expected from luck alone; the hidden day decides.\n")
pct = lambda x: f"{x * 100:+.1f}%"
for worst, k, label, ex, so, sn in sorted(survivors, reverse=True)[:25]:
    print(f"wait {k:>2} min | {label} | {ex.replace('result_', '')}")
    print(f"   older: {so[0]:5} coins, mean {pct(so[1])}, median {pct(so[2])} | newer: {sn[0]:5} coins, mean {pct(sn[1])}, median {pct(sn[2])}")
