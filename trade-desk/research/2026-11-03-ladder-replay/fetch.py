# Minute candles (GeckoTerminal) for every coin the ladder bot bought, from 10 minutes before the buy to now (max ~16 h).
# Run: python3 -I fetch.py   (writes ohlcv/<pool>.json; skips pools already fetched)
import json, os, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
coins = json.load(open(f"{HERE}/ladder_coins.json"))
def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "trade-desk-research"})
            return json.load(urllib.request.urlopen(req, timeout=20))
        except Exception:
            time.sleep(6 * (i + 1))
    return None
for c in coins:
    out = f"{HERE}/ohlcv/{c['pool']}.json"
    if os.path.exists(out): continue
    d = get(f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{c['pool']}/ohlcv/minute?aggregate=1&limit=1000&currency=usd")
    cs = (d or {}).get("data", {}).get("attributes", {}).get("ohlcv_list", []) or []
    json.dump({"pool": c["pool"], "fetched": int(time.time()), "candles": cs}, open(out, "w"))
    print(c["symbol"], len(cs), flush=True)
    time.sleep(2.2)
