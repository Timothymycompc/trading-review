import runpy, sys, io, contextlib
sys.argv = ["study2.py", sys.argv[1]]
buf = io.StringIO()
with contextlib.redirect_stdout(buf): g = runpy.run_path(sys.argv[1] + "/study2.py")
allres = g["allres"]
pos = [r for r in allres if r[2]["ret"] > 0 and r[3]["ret"] > 0 and r[2]["trades"] >= 10 and r[3]["trades"] >= 10]
print(f"Made money in both periods (not necessarily beating holding), 10+ trades each: {len(pos)} of {len(allres)}")
beat_tr = [r for r in allres if r[2]["trades"] >= 10 and r[2]["ret"] > max(0, r[4])]
print(f"Beat holding (and made money) in TRAIN: {len(beat_tr)}; of those, also beat holding in TEST: {sum(1 for r in beat_tr if r[3]['ret'] > max(0, r[5]))}; made money in TEST at all: {sum(1 for r in beat_tr if r[3]['ret'] > 0)}")
print("Best in both periods by the smaller of the two returns:")
for sym, name, tr, te, htr, hte in sorted(pos, key=lambda r: -min(r[2]["ret"], r[3]["ret"]))[:8]:
    print(f"  {sym:<4} {name}: train {tr['ret']*100:+.1f}% (hold {htr*100:+.1f}%, worst drop {tr['mdd']*100:.0f}%), test {te['ret']*100:+.1f}% (hold {hte*100:+.1f}%, worst drop {te['mdd']*100:.0f}%), {tr['trades']}+{te['trades']} trades")
