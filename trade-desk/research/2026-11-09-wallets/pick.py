"""Picks the coins for the wallet scan: 50 random $10k+ volume coins seen before 2026-11-03 00:33 UTC (period 'early')
and 50 after ('late'), seed 1109, from the 23k backtest's coins. Run: python3 -I pick.py > coins.json"""
import csv, json, random
pools = {c["mint"]: c for c in json.load(open("../2026-11-04-backtest/coins.json"))["coins"]}
rows = [r for r in csv.DictReader(open("../2026-11-09-new-strategies/coins-0.01.csv")) if r["volume_tier"] == "big" and r["mint"] in pools]
split = "2026-11-03T00:33:00"
early = sorted([r for r in rows if r["seen_at_utc"] < split], key=lambda r: r["mint"]); late = sorted([r for r in rows if r["seen_at_utc"] >= split], key=lambda r: r["mint"])
rnd = random.Random(1109)
pick = [(r, "early") for r in rnd.sample(early, 50)] + [(r, "late") for r in rnd.sample(late, 50)]
print(json.dumps([{"mint": r["mint"], "pool": pools[r["mint"]]["pool"], "symbol": pools[r["mint"]]["symbol"], "at": pools[r["mint"]]["at"], "period": p, "peak_x": r["peak_x"], "rugged": r["rugged"]} for r, p in pick]))
