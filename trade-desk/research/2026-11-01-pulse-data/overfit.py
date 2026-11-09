import runpy, sys, statistics as st
sys.argv = ["study.py", sys.argv[1]]
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf): g = runpy.run_path(sys.argv[1] + "/study.py")
trades, summary, rules = g["trades"], g["summary"], g["rules"]
best = []
for name, rule in rules:
    for H in (6, 24):
        tr, te = summary(trades(rule, H, "train")), summary(trades(rule, H, "test"))
        if tr and tr["n"] >= 8 and tr["tokens"] >= 4 and tr["mean"] > 0: best.append((tr["mean"], name, H, tr, te))
best.sort(reverse=True)
print("Rules that made money in the TRAIN period:", len(best))
tested = [b for b in best if b[4]]
print("  of those with test trades:", len(tested), "| still profitable (mean) in TEST:", sum(b[4]["mean"] > 0 for b in tested),
      "| test mean of them all: %+.1f%%" % (st.mean(b[4]["mean"] for b in tested) * 100 if tested else 0))
for m, name, H, tr, te in best[:6]:
    print(f"  [{H}h] {name}: train mean {tr['mean']*100:+.1f}% ({tr['n']} trades) -> test " + (f"mean {te['mean']*100:+.1f}% ({te['n']} trades)" if te else "no trades"))
