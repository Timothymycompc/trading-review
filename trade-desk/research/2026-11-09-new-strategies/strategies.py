"""New-strategy test (2026-11-09, Claude + agy). Rules are frozen in STRATEGIES below BEFORE the hidden day is looked at.

Data (from the 23k backtest, gs://x300-506418_cloudbuild/backtest/all-1104c/): candles-*.json = {mint: [[ts,o,h,l,c,vol_usd],...]}
(traded minutes only, from first sight to ~16 h / 1,000 traded minutes), coins.json = {coins:[{mint,pool,symbol,at,tier}]},
coins-0.01.csv = per-coin facts (pool_dex, pool_age_min). Costs/fills (BRIEF.md): COST per side (1% and 2.2%); a stop fills at
the minute's close when the low crossed it, never better than the stop; a target fills at min(target, (high+close)/2); holding
through 30+ silent minutes then coming back below half the last price = drained (fills at that price); data ending early
(fewer than 1,000 traded minutes and the last candle more than 30 min before the 16 h window ends) while holding = written off.

TRAIN = coins seen before 2026-11-03 00:33 UTC, split into older/newer halves by time. HIDDEN = the rest (run with --hidden).
LEAD = 100+ trades on TRAIN, mean > 0 on both halves, median > -1%, mean without the best 1% > 0.
Run: python3 -I strategies.py <data dir> [--hidden] > out.txt"""
import csv, glob, json, os, statistics as st, sys

SPLIT = 1793665980  # 2026-11-03T00:33:00Z
WINDOW = 1000 * 60  # the backtest asked for up to 1,000 minutes after first sight

def load(d):
    coins = {c["mint"]: c for c in json.load(open(os.path.join(d, "coins.json")))["coins"]}
    facts = {r["mint"]: r for r in csv.DictReader(open(os.path.join(d, "coins-0.01.csv")))}
    candles = {}
    for f in sorted(glob.glob(os.path.join(d, "*candles*.json"))):
        candles.update(json.load(open(f)))
    out = []
    for m, cs in candles.items():
        c = coins.get(m)
        if not c or m not in facts or len(cs) < 5: continue
        cs = sorted((x for x in cs if x[0] >= c["at"] - 60 and x[4] > 0), key=lambda x: x[0])
        if len(cs) >= 5: out.append((c, facts[m], cs))
    return out

# ---------- exits ----------
def run_exit(cs, i, entry, ex, cost, seen_at):
    """Hold from candle i (bought at its close = entry). ex: tp (0.3 = +30%), sl (0.3 = -30%), trail (gap once +trail_from),
    hours (max hold). Returns the trade's return after costs (both sides)."""
    peak, last_ts, last_c = entry, cs[i][0], entry
    tp = entry * (1 + ex["tp"]) if ex.get("tp") else None
    sl = ex["sl_price"] if ex.get("sl_price") else entry * (1 - ex["sl"]) if ex.get("sl") else None
    end_ts = cs[i][0] + ex["hours"] * 3600
    for j in range(i + 1, len(cs)):
        ts, o, h, l, c, v = cs[j]
        if ts > end_ts:  # time limit: sell at this minute's open
            return o / entry * (1 - cost) / (1 + cost) - 1
        if ts - last_ts >= 30 * 60 and c < last_c * 0.5:  # silent then came back drained
            return c / entry * (1 - cost) / (1 + cost) - 1
        stop = sl
        if ex.get("trail") and peak >= entry * (1 + ex.get("trail_from", 0)):
            t = peak * (1 - ex["trail"]); stop = max(stop or 0, t)
        if stop and l <= stop:
            return min(stop, c) / entry * (1 - cost) / (1 + cost) - 1
        if tp and h >= tp:
            return min(tp, (h + c) / 2) / entry * (1 - cost) / (1 + cost) - 1
        peak = max(peak, c); last_ts, last_c = ts, c
    # data ran out while holding
    if len(cs) < 1000 and cs[-1][0] < seen_at + WINDOW - 30 * 60 and cs[-1][0] < end_ts:
        return -1.0  # the coin stopped trading: written off
    return cs[-1][4] / entry * (1 - cost) / (1 + cost) - 1

# ---------- entries: each returns the candle index to buy at (its close), or None ----------
def survivor_dip(cs, seen, after_h, drop):
    """S1 SURVIVOR DIP: the coin is still trading after_h hours after first sight (a traded minute in each of the last 3
    half-hours) and is now down `drop` or more from its highest close so far; buy the first such minute."""
    hi = 0
    for j, (ts, o, h, l, c, v) in enumerate(cs):
        hi = max(hi, c)
        if ts < seen + after_h * 3600: continue
        recent = [x[0] for x in cs[max(0, j - 200): j + 1]]
        alive = all(any(ts - (k + 1) * 1800 <= t < ts - k * 1800 for t in recent) for k in range(3))
        if alive and c <= hi * (1 - drop): return j
    return None

def survivor_breakout(cs, seen, after_h, look_h):
    """S2 SURVIVOR BREAKOUT: after after_h hours alive, buy the first close above the highest close of the previous
    look_h hours, on a minute whose volume is at least 3x the AVERAGE traded-minute volume of that window (20+ minutes)."""
    from collections import deque
    k, vsum, dq = 0, 0.0, deque()  # window cs[k:j]; dq holds indexes with falling closes (front = window max)
    for j, (ts, o, h, l, c, v) in enumerate(cs):
        while k < j and cs[k][0] < ts - look_h * 3600:
            vsum -= cs[k][5]
            if dq and dq[0] == k: dq.popleft()
            k += 1
        n = j - k
        if ts >= seen + after_h * 3600 and n >= 20 and c > cs[dq[0]][4] and v >= 3 * vsum / n: return j
        while dq and cs[dq[-1]][4] <= c: dq.pop()
        dq.append(j); vsum += v
    return None

def first_hour_survivor(cs, seen, min_frac, _):
    """S3 QUIET HOLDER: 60 min after first sight, the coin never fell below min_frac of its first price and traded in at least
    40 of those minutes (steady, no dump); buy at the first candle at or after 60 min."""
    p0 = cs[0][4]; first = [x for x in cs if x[0] < seen + 3600]
    if len(first) < 40 or min(x[3] for x in first) < p0 * min_frac: return None
    for j, x in enumerate(cs):
        if x[0] >= seen + 3600: return j
    return None

def tmin(x, seen): return (x[0] - seen) / 60

def agy_second_wave(cs, seen, K, TP):
    """agy #1 SECOND-WAVE RECLAIM: t in [30,180]; the coin has pulled back 30%+ from its high but never below 25% of its first
    price; no gap of 25+ min in the last 30 min; this minute closes above every high of the last 15 min, closes green,
    trades $2.5k+ and K x the median volume of the last 15 min. Exit: +TP / -12% / 45 min."""
    c0 = cs[0][4]
    for j in range(1, len(cs)):
        t = tmin(cs[j], seen)
        if t < 30: continue
        if t > 180: return None
        prev = cs[:j]; lo = min(x[3] for x in prev); hi = max(x[2] for x in prev)
        if lo < 0.25 * c0 or lo > 0.70 * hi: continue
        last30 = [x[0] for x in prev if x[0] >= cs[j][0] - 1800] + [cs[j][0]]
        if len(last30) < 2 or max(b - a for a, b in zip(last30, last30[1:])) >= 1500: continue
        w15 = [x for x in prev if x[0] >= cs[j][0] - 900]
        if len(w15) < 3: continue
        ts, o, h, l, c, v = cs[j]
        if c > max(x[2] for x in w15) and c > o and v >= 2500 and v >= K * st.median(x[5] for x in w15): return j
    return None

def agy_capitulation(cs, seen, D, TP):
    """agy #2 SELLING-CLIMAX BOUNCE: t in [6,45]; the previous minute's low is D or more below the first price (but not below
    30% of it) on 2x the median volume so far; this minute closes above that minute's high, green, $2k+. Exit: +TP, stop just
    under the flush low (0.95 x), 20 min. Returns (index, stop price)."""
    c0 = cs[0][4]
    for j in range(2, len(cs)):
        t = tmin(cs[j], seen)
        if t < 6: continue
        if t > 45: return None
        p = cs[j - 1]; before = cs[: j - 1]
        if not (0.30 * c0 <= p[3] <= (1 - D) * c0): continue
        if not before or p[5] < 2 * st.median(x[5] for x in before): continue
        ts, o, h, l, c, v = cs[j]
        if c > p[2] and c > o and v >= 2000: return (j, 0.95 * p[3])
    return None

def agy_flow(cs, seen, M, R, facts=None):
    """agy #3 CONTINUOUS FLOW: $10k+ tier only; a traded candle in every minute 1..M, never below 80% of the first price, at
    minute M the price is 1.05-1.80x the first and the second half's volume is R x the first half's. Exit: +35%, trail 15%
    from the peak, 60 min."""
    if facts is not None and facts.get("volume_tier") != "big": return None
    c0 = cs[0][4]; mins = {}
    for j, x in enumerate(cs):
        t = int(tmin(x, seen))
        if 1 <= t <= M: mins.setdefault(t, j)
    if len(mins) < M: return None
    win = [x for x in cs if 1 <= tmin(x, seen) < M + 1]
    if min(x[3] for x in win) < 0.80 * c0: return None
    j = max(mins.values()); c = cs[j][4]
    if not (1.05 * c0 <= c <= 1.80 * c0): return None
    half = M / 2
    a = sum(x[5] for x in win if tmin(x, seen) < half + 1); b = sum(x[5] for x in win if tmin(x, seen) >= half + 1)
    return j if a > 0 and b >= R * a else None

STRATEGIES = {
    # name: (entry fn, grid of (a, b) entry numbers, exit)
    "S1 survivor dip": (survivor_dip, [(h, d) for h in (2, 4) for d in (0.6, 0.8)], {"tp": 0.5, "sl": 0.3, "hours": 4}),
    "S2 survivor breakout": (survivor_breakout, [(h, 2) for h in (2, 4)] + [(h, 4) for h in (2, 4)], {"sl": 0.2, "trail": 0.2, "trail_from": 0.2, "hours": 6}),
    "S3 quiet holder": (first_hour_survivor, [(f, None) for f in (0.7, 0.85)], {"tp": 0.3, "sl": 0.2, "hours": 4}),
    # agy's: the take-profit is one of the two tuned numbers, so the exit is built per grid cell (see exit_for)
    "A1 second-wave reclaim": (agy_second_wave, [(k, tp) for k in (3, 5, 8) for tp in (0.15, 0.25, 0.40)], {"sl": 0.12, "hours": 0.75, "tp_from_b": True}),
    "A2 capitulation bounce": (agy_capitulation, [(d, tp) for d in (0.35, 0.45, 0.55) for tp in (0.12, 0.18, 0.25)], {"hours": 20 / 60, "tp_from_b": True}),
    "A3 continuous flow": (agy_flow, [(m, r) for m in (10, 14, 20) for r in (1.2, 1.5, 2.0)], {"tp": 0.35, "trail": 0.15, "trail_from": 0, "hours": 1, "needs_facts": True}),
}

def summary(xs):
    if not xs: return "n=0"
    s = sorted(xs); trim = s[: len(s) - max(1, len(s) // 100)]
    return f"n={len(s):>5} mean {st.mean(s)*100:+6.1f}% median {st.median(s)*100:+6.1f}% w/o best 1% {st.mean(trim)*100 if trim else 0:+6.1f}% won {sum(x > 0 for x in s)/len(s)*100:3.0f}%"

def one_coin(item):
    """Every strategy, grid cell and cost for one coin: [(strategy, cell, cost, at, return)]."""
    c, f, cs = item; out = []
    for name, (fn, grid, ex) in STRATEGIES.items():
        for a, b in grid:
            i = fn(cs, c["at"], a, b, f) if ex.get("needs_facts") else fn(cs, c["at"], a, b)
            e = dict(ex)
            if e.get("tp_from_b"): e["tp"] = b
            if isinstance(i, tuple): i, e["sl_price"] = i
            if i is None or i >= len(cs) - 1: continue
            for cost in (0.01, 0.022): out.append((name, (a, b), cost, c["at"], run_exit(cs, i, cs[i][4], e, cost, c["at"])))
    return out

def main():
    import multiprocessing as mp
    d = sys.argv[1]; hidden = "--hidden" in sys.argv
    data = load(d)
    train = [x for x in data if x[0]["at"] < SPLIT]; test = [x for x in data if x[0]["at"] >= SPLIT]
    mid = sorted(x[0]["at"] for x in train)[len(train) // 2]
    print(f"{len(data)} coins with candles; TRAIN {len(train)} (halves split {mid}), HIDDEN {len(test)}{' (SHOWN)' if hidden else ' (not looked at)'}", flush=True)
    with mp.Pool() as pool: results = [r for rs in pool.imap_unordered(one_coin, data if hidden else train, chunksize=50) for r in rs]
    leads = []
    for name, (fn, grid, ex) in STRATEGIES.items():
        print(f"\n=== {name}  exit {ex} ===")
        for a, b in grid:
            for cost in (0.01, 0.022):
                res = {"older": [], "newer": [], "hidden": []}
                for n, cell, co, at, r in results:
                    if n == name and cell == (a, b) and co == cost:
                        res["hidden" if at >= SPLIT else "older" if at < mid else "newer"].append(r)
                tr = res["older"] + res["newer"]
                lead = (len(tr) >= 100 and res["older"] and res["newer"] and st.mean(res["older"]) > 0 and st.mean(res["newer"]) > 0
                        and st.median(tr) > -0.01 and st.mean(sorted(tr)[: len(tr) - max(1, len(tr) // 100)]) > 0)
                if lead: leads.append((name, (a, b), cost))
                print(f"  ({a},{b}) cost {cost*100:.1f}%  older {summary(res['older'])}\n{'':24}newer {summary(res['newer'])}  {'LEAD' if lead else ''}")
                if hidden: print(f"{'':24}HIDDEN {summary(res['hidden'])}")
    print("\nLEADS on TRAIN:", leads or "none")

if __name__ == "__main__":
    main()
