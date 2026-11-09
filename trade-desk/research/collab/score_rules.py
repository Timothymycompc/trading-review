"""Scores entry rules on the training coins (coins-train.csv), for the Claude x Gemini work. Each rule is a Python
condition over one row (r), written by Claude from Gemini's proposal, plus the result column to score it on.
  python3 -I score_rules.py rules.json [coins.csv]
rules.json: [{"name": "...", "when": "r['volume_tier'] == 'big' and num(r['pool_age_min']) < 3", "exit": "result_ladder_b"}]
Prints, per rule and half: coins, mean, median, mean without the best coin, share that reached 2x, share rugged."""
import csv, json, statistics, sys

rules = json.load(open(sys.argv[1]))
rows = list(csv.DictReader(open(sys.argv[2] if len(sys.argv) > 2 else "coins-train.csv")))

def num(x):
    try: return float(x)
    except (TypeError, ValueError): return None

pct = lambda x: "n/a" if x is None else f"{x * 100:+.1f}%"
out = []
for rule in rules:
    out.append(f"\n{rule['name']}   [{rule['when']}]  scored on {rule['exit']}")
    for half in ("older", "newer", "all"):
        rs = [r for r in rows if (half == "all" or r["half"] == half) and eval(rule["when"], {"num": num}, {"r": r})]
        xs = sorted(float(r[rule["exit"]]) for r in rs)
        if not xs: out.append(f"   {half:5}: no coins"); continue
        mean = statistics.fmean(xs)
        without_best = statistics.fmean(xs[:-1]) if len(xs) > 1 else None
        out.append(f"   {half:5}: {len(xs):5} coins | mean {pct(mean):>8} | median {pct(statistics.median(xs)):>8} | without best coin {pct(without_best):>8}"
                   f" | reached 2x {pct(sum(r['reached_2x'] == '1' for r in rs) / len(rs))} | rugged {pct(sum(r['rugged'] == '1' for r in rs) / len(rs))}")
print("\n".join(out))
