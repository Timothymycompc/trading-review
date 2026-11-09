"""WAIT-5 exits for losing trades (Tim 2026-11-09: "add better exits for losing trades on that one").
Same WAIT-5 entry as live (wait 5 min, never 20% below the scan price, within 10% of the high, traded every minute),
replayed on the 23k backtest's corrected '-pull' runs (silent PumpSwap pools written off), every exit in the grid.
Pick rule fixed in advance: the exit must beat the current one (tp100 sl40 t30) on BOTH halves at 2.2%/side.
Run: python3 -I wait5_exits.py"""
import csv, statistics as st

def f(v):
    try: return float(v)
    except (TypeError, ValueError): return None

for cost in ("0.01", "0.022"):
    rows = list(csv.DictReader(open(f"wait-{cost}.csv")))
    sel = [r for r in rows if f(r["wait_min"]) == 5 and (f(r["low_since_scan"]) or -9) > -0.20 and (f(r["off_high"]) or -9) > -0.10
           and (f(r["traded_minutes"]) or 0) >= 5]
    cols = [k for k in rows[0] if k.startswith("result_")]
    print(f"\n=== cost {float(cost)*100:.1f}%/side: {len(sel)} WAIT-5 entries (older {sum(r['half']=='older' for r in sel)}, newer {sum(r['half']=='newer' for r in sel)}) ===")
    out = []
    for c in cols:
        h = {k: [f(r[c]) for r in sel if r["half"] == k and f(r[c]) is not None] for k in ("older", "newer")}
        allv = h["older"] + h["newer"]
        if not allv: continue
        out.append((st.mean(allv), c[7:], st.mean(h["older"]), st.mean(h["newer"]), st.median(allv), sum(x <= -0.9 for x in allv) / len(allv)))
    cur = next(o for o in out if o[1] == "g_tp100_sl40_t30")
    for o in sorted(out, reverse=True)[:15] + [cur]:
        flag = "  <- current" if o is cur else ("  beats current on both halves" if o[2] > cur[2] and o[3] > cur[3] else "")
        print(f"  {o[1]:<26} mean {o[0]*100:+6.1f}%  older {o[2]*100:+6.1f}%  newer {o[3]*100:+6.1f}%  median {o[4]*100:+6.1f}%  lost 90%+ {o[5]*100:4.1f}%{flag}")
