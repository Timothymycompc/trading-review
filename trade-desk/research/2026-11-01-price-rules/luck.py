import runpy, sys, io, contextlib, random
sys.argv = ["study2.py", sys.argv[1]]
buf = io.StringIO()
with contextlib.redirect_stdout(buf): g = runpy.run_path(sys.argv[1] + "/study2.py")
load, rules_for, run, random_like, COST = g["load"], g["rules_for"], g["run"], g["random_like"], g["COST"]
picks = [("JUP", "volume >5x avg and hour up, hold 24h"), ("SOL", "breakout above 24h high, sell below 12h low"),
         ("JUP", "uptrend + Bollinger(20,2) below lower, sell at middle or 48h"), ("WIF", "Bollinger(48,2.0) buy below lower, sell at middle or 24h"),
         ("WIF", "Bollinger(20,2.5) buy below lower, sell at middle or 72h"), ("SOL", "breakout above 72h high, sell below 12h low")]
rng = random.Random(11)
cache = {}
for sym, name in picks:
    if sym not in cache: x = load(sym); cache[sym] = (x, rules_for(x))
    x, R = cache[sym]; c = x["c"]; n = len(c); cut = int(n * 0.6); pos = R[name]
    out = []
    for a, b in ((0, cut), (cut, n)):
        mine = run(pos, c, a, b, COST[sym])["ret"]
        luck = [run(random_like(pos, a, b, rng), c, a, b, COST[sym])["ret"] for _ in range(300)]
        out.append((mine, sum(r >= mine for r in luck) / 300))
    print(f"{sym} {name}: train {out[0][0]*100:+.1f}% (random timing did as well {out[0][1]*100:.0f}% of the time), test {out[1][0]*100:+.1f}% (random {out[1][1]*100:.0f}%)")
