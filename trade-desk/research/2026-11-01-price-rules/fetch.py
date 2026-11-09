"""Hourly OHLCV (USD, base token) for the main pool of each allowed token, from GeckoTerminal's free API.
Pages back 1000 hours at a time until the API stops returning data or MAX_PAGES."""
import json, sys, time, urllib.request

OUT = sys.argv[1]
POOLS_ALL = {
    "SOL": "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    "JUP": "C8Gr6AUuq9hEdSYJzoEpNcdjpojPZwqG5MtQbeouNNwg",
    "BONK": "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9",
    "WIF": "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx",
}
MAX_PAGES = 9
POOLS = {k: v for k, v in POOLS_ALL.items() if k in sys.argv[2].split(",")}

def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "trade-desk-research/0.1"})
            return json.load(urllib.request.urlopen(req, timeout=40))
        except Exception as e:
            print("  retry", attempt, str(e)[:80], flush=True); time.sleep(10 * (attempt + 1))
    return None

for sym, pool in POOLS.items():
    rows, before = {}, None
    for page in range(MAX_PAGES):
        url = f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&token=base" + (f"&before_timestamp={before}" if before else "")
        d = get(url)
        lst = (((d or {}).get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []
        if not lst: break
        for ts, o, h, l, c, v in lst: rows[int(ts)] = (float(o), float(h), float(l), float(c), float(v))
        before = min(int(x[0]) for x in lst)
        print(sym, "page", page, len(lst), "candles, oldest", time.strftime("%Y-%m-%d", time.gmtime(before)), flush=True)
        time.sleep(2.5)
        if len(lst) < 1000: break
    with open(f"{OUT}/{sym}.json", "w") as f: json.dump(sorted([ts, *v] for ts, v in rows.items()), f)
    print(sym, "total", len(rows), flush=True)
