# Downloads GeckoTerminal 1-minute candles for every coin the desk fully checked (coins.jsonl), from the minute the
# desk checked it to 6 hours later. One file per pool in ohlcv/, so a rerun only fetches what is missing.
# GeckoTerminal's free API answers 429 above about 10 calls a minute in practice, so this waits 6 s between calls (~30 min for 294 coins).
# Run: python3 -I fetch.py
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
coins = [json.loads(l) for l in open(f"{HERE}/coins.jsonl")]
todo = [c for c in coins if not os.path.exists(f"{HERE}/ohlcv/{c['pool']}.json")]
print(f"{len(coins)} coins, {len(todo)} to fetch", flush=True)
for i, c in enumerate(todo, 1):
  url = (f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{c['pool']}/ohlcv/minute"
         f"?aggregate=1&limit=400&currency=usd&before_timestamp={c['seen'] + 6 * 3600}")
  data = None
  for attempt in range(5):
    try:
      data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "application/json"}), timeout=30))
      break
    except urllib.error.HTTPError as e:
      if e.code == 404: data = {"missing": True}; break
      time.sleep(30 * (attempt + 1))
    except Exception:
      time.sleep(30 * (attempt + 1))
  if data is None: print(f"{i}/{len(todo)} {c['symbol']}: failed, rerun later", flush=True); continue
  candles = data.get("data", {}).get("attributes", {}).get("ohlcv_list", []) if not data.get("missing") else []
  json.dump({"pool": c["pool"], "fetched": int(time.time()), "candles": candles}, open(f"{HERE}/ohlcv/{c['pool']}.json", "w"))
  if i % 25 == 0: print(f"{i}/{len(todo)}", flush=True)
  time.sleep(6)
print("done", flush=True)
