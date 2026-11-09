"""Wallet study (written 2026-11-09 BEFORE the scan results were read). Data: Solana Pulse token_traders reading
(pulse-site server/tools/traders.ts via scripts/wallet-scan.ts) on 100 random $10k+ volume coins the desk saw, 50 'early'
(before 2026-11-03 00:33 UTC) and 50 'late'.

Questions, with the pass line fixed in advance:
1. Who makes money on new coins? Profit by behavior: pool creator, launch-slot buyer, first buy < 10 s, 10-60 s, 1-10 min, later.
2. SKILL TEST: a "repeat winner" = in the EARLY coins, traded 3+ coins, profitable on 2/3+ of them, total profit > 0.
   PASS if, on the LATE coins, repeat winners that traded there are profitable on more than half of their coins AND their
   total late profit is > 0 AND they beat all late wallets' share of profitable coin-trades by 10+ points. Otherwise their
   early record was luck (or a style we can't copy).
3. Can we copy them? For repeat winners: how soon after launch they buy (seconds) and how long they hold. A desk that sees a
   coin minutes after launch can't copy launch-slot or <10 s buyers.
Limits: profit is inside the scan window only (2 h or 1,500 transactions from launch, whichever first); tokens still held
are not valued, so holders look worse and fast flippers look better. Run: python3 -I analyze.py wallets-coins.jsonl"""
import json, statistics as st, sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
ok = [r for r in rows if not r.get("error") and r.get("wallets")]
print(f"coins scanned {len(rows)}, usable {len(ok)} (errors {sum(1 for r in rows if r.get('error'))}); "
      f"window cut short on {sum(1 for r in ok if r.get('window_cut'))}; start reached on {sum(1 for r in ok if r.get('start_reached'))}")
print(f"transactions read {sum(r['read'] for r in ok):,}, trades {sum(r['trades'] for r in ok):,}, unread {sum(r['unread'] for r in ok):,}")

def kind(w):
    if w["created_pool"]: return "1 pool creator"
    if w["sold_more_than_bought"]: return "2 sold more than bought (got tokens elsewhere)"
    if w["bought_in_launch_slot"]: return "3 bought in launch slot"
    s = w["first_buy_after_launch_s"]
    if s is None: return "9 no buy"
    return "4 first buy <10 s" if s < 10 else "5 first buy 10-60 s" if s < 60 else "6 first buy 1-10 min" if s < 600 else "7 first buy 10+ min"

print("\n== 1. Who makes money (all coins; one line = one wallet on one coin) ==")
groups = defaultdict(list)
for r in ok:
    for w in r["wallets"]: groups[kind(w)].append(w["profit_sol"])
tot = sum(sum(v) for v in groups.values())
for k in sorted(groups):
    v = groups[k]
    print(f"  {k:<48} n={len(v):>6}  profitable {sum(x > 0 for x in v)/len(v)*100:5.1f}%  total {sum(v):+10.2f} SOL  median {st.median(v):+.4f}")
print(f"  ALL wallets total {tot:+.2f} SOL (negative = what buyers lost to sellers, the pool and fees)")

# Per-wallet records by period.
rec = {"early": defaultdict(list), "late": defaultdict(list)}
meta = defaultdict(list)
for r in ok:
    for w in r["wallets"]:
        rec[r["period"]][w["wallet"]].append(w["profit_sol"])
        meta[w["wallet"]].append(w)

repeat = {a for a, v in rec["early"].items() if len(v) >= 3 and sum(x > 0 for x in v) >= 2 * len(v) / 3 and sum(v) > 0}
print(f"\n== 2. Skill test ==\n  early wallets {len(rec['early']):,}; on 3+ early coins {sum(1 for v in rec['early'].values() if len(v) >= 3):,}; repeat winners {len(repeat)}")
late_all = [x for v in rec["late"].values() for x in v]
base = sum(x > 0 for x in late_all) / len(late_all) * 100 if late_all else 0
seen_late = [a for a in repeat if a in rec["late"]]
lt = [x for a in seen_late for x in rec["late"][a]]
print(f"  repeat winners that traded late coins: {len(seen_late)}  (coin-trades {len(lt)})")
if lt:
    share = sum(x > 0 for x in lt) / len(lt) * 100
    passed = share > 50 and sum(lt) > 0 and share >= base + 10
    print(f"  their late results: profitable {share:.1f}% of coin-trades, total {sum(lt):+.3f} SOL, median {st.median(lt):+.4f}")
    print(f"  all late wallets: profitable {base:.1f}% of coin-trades")
    print(f"  VERDICT: {'PASS: they keep winning on new coins' if passed else 'FAIL: early record did not carry over'}")
else:
    print("  VERDICT: FAIL: no repeat winner traded a late coin (nothing to test)")

print("\n== 3. What the repeat winners do (all their coin-trades) ==")
for a in sorted(repeat, key=lambda a: -sum(rec["early"][a]))[:25]:
    ws = meta[a]
    delays = [w["first_buy_after_launch_s"] for w in ws if w["first_buy_after_launch_s"] is not None]
    holds = [w["held_minutes"] for w in ws if w["held_minutes"] is not None]
    kinds = sorted({kind(w)[2:] for w in ws})
    print(f"  {a[:8]} early {len(rec['early'][a])} coins {sum(rec['early'][a]):+.3f} SOL | late {len(rec['late'].get(a, []))} coins {sum(rec['late'].get(a, [])):+.3f} SOL"
          f" | first buy median {st.median(delays) if delays else '?'} s | hold median {st.median(holds) if holds else '?'} min | spend median {st.median(w['sol_spent'] for w in ws):.3f} SOL | {', '.join(kinds)}")
