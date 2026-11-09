"""Trading-rule search on 7 months of hourly SOL, JUP, BONK and WIF prices (GeckoTerminal, main Solana pool).
Long-only (hold the token or hold USDC), the way Trade Desk trades. Each rule decides at an hour's close using only
data up to then; the position earns the next hour's move. Every switch pays a cost. Rules are judged on the first 60%
(train) and, separately, the last 40% (test). A rule survives only if in BOTH periods it makes money, beats simply
holding the token, and trades at least 10 times. Survivors then face a luck test: the same number of trades and hours
in the market placed at random, 300 times, on the test period."""
import json, math, random, statistics as st, sys
from datetime import datetime, timezone

D = sys.argv[1]
COST = {"SOL": 0.001, "JUP": 0.003, "BONK": 0.003, "WIF": 0.003}  # per side: pool fee + slippage at $10-25

def load(sym):
    raw = json.load(open(f"{D}/{sym}.json"))
    by = {int(r[0]): r for r in raw}
    t0, t1 = min(by), max(by)
    ts, o, h, l, c, v = [], [], [], [], [], []
    last = None
    for t in range(t0, t1 + 1, 3600):  # fill missing hours: price unchanged, no volume
        r = by.get(t)
        if r: last = r[4]; ts.append(t); o.append(r[1]); h.append(r[2]); l.append(r[3]); c.append(r[4]); v.append(r[5])
        else: ts.append(t); o.append(last); h.append(last); l.append(last); c.append(last); v.append(0.0)
    return {"t": ts, "o": o, "h": h, "l": l, "c": c, "v": v}

def sma(x, n):
    out, s = [None] * len(x), 0.0
    for i, val in enumerate(x):
        s += val
        if i >= n: s -= x[i - n]
        if i >= n - 1: out[i] = s / n
    return out
def stdev(x, n, m):
    out = [None] * len(x)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]; mu = m[i]
        out[i] = math.sqrt(sum((a - mu) ** 2 for a in w) / n)
    return out
def rsi(c, n=14):
    out = [None] * len(c); g = lo = 0.0
    for i in range(1, len(c)):
        d = c[i] - c[i - 1]; up, dn = max(d, 0), max(-d, 0)
        if i <= n: g += up / n; lo += dn / n
        else: g = (g * (n - 1) + up) / n; lo = (lo * (n - 1) + dn) / n
        if i >= n: out[i] = 100 - 100 / (1 + g / lo) if lo > 0 else 100
    return out

# ---------- rules: each returns a list of 0/1 positions (decided at close of hour i, held for hour i+1) ----------
def stateful(n, enter, exit_, max_h=None):
    pos, inn, since = [0] * n, False, 0
    for i in range(n):
        if inn:
            since += 1
            if exit_(i) or (max_h and since >= max_h): inn = False
        elif enter(i): inn, since = True, 0
        pos[i] = 1 if inn else 0
    return pos

def rules_for(x):
    c, h, l, v, t = x["c"], x["h"], x["l"], x["v"], x["t"]
    n = len(c); R = {}
    smas = {k: sma(c, k) for k in (6, 12, 20, 24, 48, 96, 168, 240)}
    hour = [datetime.fromtimestamp(s, timezone.utc).hour for s in t]
    dow = [datetime.fromtimestamp(s, timezone.utc).weekday() for s in t]
    r14 = rsi(c)
    vavg = sma(v, 48)
    ret = lambda i, k: c[i] / c[i - k] - 1 if i >= k else None
    for f in (6, 12, 24, 48):
        for s in (24, 48, 96, 168, 240):
            if f < s: R[f"SMA {f}h above SMA {s}h"] = [1 if smas[f][i] and smas[s][i] and smas[f][i] > smas[s][i] else 0 for i in range(n)]
    for k in (24, 48, 96, 168, 240):
        R[f"price above SMA {k}h"] = [1 if smas[k][i] and c[i] > smas[k][i] else 0 for i in range(n)]
    for bn in (20, 48):
        m = smas[bn] if bn in smas else sma(c, bn); sd = stdev(c, bn, m)
        for kk in (2.0, 2.5):
            lo = [m[i] - kk * sd[i] if sd[i] is not None else None for i in range(n)]
            up = [m[i] + kk * sd[i] if sd[i] is not None else None for i in range(n)]
            for mh in (24, 72):
                R[f"Bollinger({bn},{kk}) buy below lower, sell at middle or {mh}h"] = stateful(n, lambda i: lo[i] is not None and c[i] < lo[i], lambda i: c[i] >= m[i], mh)
            R[f"Bollinger({bn},{kk}) breakout above upper, sell below middle"] = stateful(n, lambda i: up[i] is not None and c[i] > up[i], lambda i: c[i] < m[i])
    for lvl in (20, 25, 30):
        for ex in (50, 60):
            R[f"RSI14 below {lvl}, sell above {ex} or 72h"] = stateful(n, lambda i: r14[i] is not None and r14[i] < lvl, lambda i: r14[i] is not None and r14[i] > ex, 72)
    for N in (24, 72, 168):
        for M in (12, 24, 72):
            R[f"breakout above {N}h high, sell below {M}h low"] = stateful(n,
                lambda i: i > N and c[i] > max(h[i - N:i]), lambda i: i > M and c[i] < min(l[i - M:i]))
    for L in (24, 72, 168):
        R[f"momentum: up over last {L}h"] = [1 if (ret(i, L) or 0) > 0 else 0 for i in range(n)]
    for k in (3, 5):
        for H in (6, 24):
            R[f"volume >{k}x avg and hour up, hold {H}h"] = stateful(n, lambda i: vavg[i] and v[i] > k * vavg[i] and c[i] > (c[i - 1] if i else c[i]), lambda i: False, H)
            R[f"volume >{k}x avg and hour down, hold {H}h"] = stateful(n, lambda i: vavg[i] and v[i] > k * vavg[i] and c[i] < (c[i - 1] if i else c[i]), lambda i: False, H)
    for start in range(0, 24, 2):
        for w in (4, 8, 12):
            hrs = {(start + j) % 24 for j in range(w)}
            # Position at close of hour i earns hour i+1: to hold during hours in `hrs`, be in at the close before them.
            R[f"hold only {start:02d}:00-{(start + w) % 24:02d}:00 UTC"] = [1 if (hour[i] + 1) % 24 in hrs else 0 for i in range(n)]
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for d in range(7):
        R[f"hold only on {days[d]} (UTC)"] = [1 if ((dow[i] + (1 if hour[i] == 23 else 0)) % 7) == d else 0 for i in range(n)]
    R["hold only weekends (UTC)"] = [1 if ((dow[i] + (1 if hour[i] == 23 else 0)) % 7) >= 5 else 0 for i in range(n)]
    R["hold only weekdays (UTC)"] = [1 if ((dow[i] + (1 if hour[i] == 23 else 0)) % 7) < 5 else 0 for i in range(n)]
    # Dip buys only while the bigger trend is up.
    up168 = [bool(smas[168][i] and c[i] > smas[168][i]) for i in range(n)]
    for lvl in (25, 30):
        R[f"uptrend (above SMA168) + RSI14 below {lvl}, sell above 55 or 72h"] = stateful(n, lambda i: up168[i] and r14[i] is not None and r14[i] < lvl, lambda i: r14[i] is not None and r14[i] > 55, 72)
    m20 = smas[20]; sd20 = stdev(c, 20, m20)
    R["uptrend + Bollinger(20,2) below lower, sell at middle or 48h"] = stateful(n, lambda i: up168[i] and sd20[i] is not None and c[i] < m20[i] - 2 * sd20[i], lambda i: c[i] >= m20[i], 48)
    R["uptrend + volume >3x avg and hour down, hold 24h"] = stateful(n, lambda i: up168[i] and vavg[i] and v[i] > 3 * vavg[i] and i and c[i] < c[i - 1], lambda i: False, 24)
    return R

def run(pos, c, a, b, cost):
    """Equity over hours a..b-1 with positions decided at each close; returns total return, trades, exposure, max drawdown."""
    eq, peak, mdd, trades, prev, held = 1.0, 1.0, 0.0, 0, 0, 0
    for i in range(a, b - 1):
        p = pos[i]
        if p != prev:
            eq *= (1 - cost); trades += p  # count entries
        if p: eq *= c[i + 1] / c[i]; held += 1
        prev = p; peak = max(peak, eq); mdd = max(mdd, 1 - eq / peak)
    if prev: eq *= (1 - cost)  # close out at the end
    return {"ret": eq - 1, "trades": trades, "exposure": held / max(1, b - 1 - a), "mdd": mdd}

def random_like(pos, a, b, rng):
    """Same number of entries and the same hours in the market, placed at random in a..b."""
    runs, i = [], a
    while i < b - 1:
        if pos[i]:
            j = i
            while j < b - 1 and pos[j]: j += 1
            runs.append(j - i); i = j
        else: i += 1
    total = b - 1 - a; free = total - sum(runs)
    if free < 0 or not runs: return [0] * len(pos)
    gaps = sorted(rng.sample(range(free + len(runs)), len(runs)))
    out = [0] * len(pos); k, start, used = 0, a, 0
    rng.shuffle(runs)
    cursor = a; prev_g = 0
    for g, r in zip(gaps, runs):
        cursor += g - prev_g; prev_g = g + 1
        for j in range(cursor, min(cursor + r, b - 1)): out[j] = 1
        cursor += r
    return out

rng = random.Random(7)
tried, survivors, allres = 0, [], []
for sym in ("SOL", "JUP", "BONK", "WIF"):
    x = load(sym); c = x["c"]; n = len(c); cut = int(n * 0.6); cost = COST[sym]
    hold_tr = c[cut - 1] / c[0] - 1; hold_te = c[-1] / c[cut] - 1
    d0, d1, d2 = (datetime.fromtimestamp(x["t"][k], timezone.utc).strftime("%b %d") for k in (0, cut, -1))
    print(f"\n{sym}: {n} hours. Train {d0}-{d1}: holding {hold_tr*100:+.1f}%. Test {d1}-{d2}: holding {hold_te*100:+.1f}%.")
    for name, pos in rules_for(x).items():
        tried += 1
        tr, te = run(pos, c, 0, cut, cost), run(pos, c, cut, n, cost)
        allres.append((sym, name, tr, te, hold_tr, hold_te))
        if tr["trades"] >= 10 and te["trades"] >= 10 and tr["ret"] > 0 and te["ret"] > 0 and tr["ret"] > hold_tr and te["ret"] > hold_te:
            luck = [run(random_like(pos, cut, n, rng), c, cut, n, cost)["ret"] for _ in range(300)]
            p = sum(r >= te["ret"] for r in luck) / len(luck)
            survivors.append((sym, name, tr, te, hold_tr, hold_te, p))

print(f"\nRules tried: {tried} ({tried // 4} per token).")
print(f"Survivors (made money AND beat holding, in both periods, 10+ trades each): {len(survivors)}")
for sym, name, tr, te, htr, hte, p in sorted(survivors, key=lambda s: s[6]):
    print(f"  {sym:<4} {name}\n       train {tr['ret']*100:+6.1f}% ({tr['trades']} trades, in market {tr['exposure']*100:.0f}%, worst drop {tr['mdd']*100:.0f}%) vs hold {htr*100:+.1f}%"
          f"\n       test  {te['ret']*100:+6.1f}% ({te['trades']} trades, in market {te['exposure']*100:.0f}%, worst drop {te['mdd']*100:.0f}%) vs hold {hte*100:+.1f}%"
          f"\n       luck test: random trades with the same timing beat it {p*100:.0f}% of the time")
# How many survivors would pure chance produce? Same check on rules with their positions shuffled at random.
fake = 0
for sym in ("SOL", "JUP", "BONK", "WIF"):
    x = load(sym); c = x["c"]; n = len(c); cut = int(n * 0.6); cost = COST[sym]
    htr, hte = c[cut - 1] / c[0] - 1, c[-1] / c[cut] - 1
    for name, pos in list(rules_for(x).items()):
        rp = random_like(pos, 0, cut, rng)[:cut] + random_like(pos, cut, n, rng)[cut:]
        tr, te = run(rp, c, 0, cut, cost), run(rp, c, cut, n, cost)
        if tr["trades"] >= 10 and te["trades"] >= 10 and tr["ret"] > 0 and te["ret"] > 0 and tr["ret"] > htr and te["ret"] > hte: fake += 1
print(f"\nFor comparison: the same number of RANDOM rules (same trade counts and time in market) produced {fake} 'survivors'.")
# Rules that worked on most tokens in the test period (consistency across markets).
from collections import defaultdict
by = defaultdict(list)
for sym, name, tr, te, htr, hte in allres: by[name].append((sym, te["ret"] > max(0, hte) and te["trades"] >= 10, tr["ret"] > max(0, htr) and tr["trades"] >= 10))
wide = [(name, v) for name, v in by.items() if sum(a and b for _, a, b in v) >= 3]
print(f"Rules that made money and beat holding in both periods on 3+ of the 4 tokens: {len(wide)}")
for name, v in wide: print("  ", name, [s for s, a, b in v if a and b])
