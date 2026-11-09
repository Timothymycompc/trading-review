// One shared Jupiter price check for every bot (fast lane, ladders A and B, the lottery, and the swap's dollar value).
// Why (2026-11-04): each bot asked Jupiter's price API on its own every 10 seconds, all on one Jupiter key shared with
// Solana Pulse, and Jupiter answered HTTP 429 (21 times in 6 hours in the logs). The lottery, the only bot with real
// money, lost its buys to it: "Jupiter's quote service couldn't be reached" and "USD value unknown".
// How: a price answer is reused for 8 seconds (the watchers look every 10), and every bot asking within the same 40 ms
// is served by one batched call (Jupiter takes 50 tokens a call). A token Jupiter doesn't price stays unknown.
// It wraps fetchJson and only touches price API addresses; everything else passes straight through. Tests pass their
// own fetchJson, so they never see this cache.
export const PRICE_CACHE = { maxAgeMs: 8_000, batchWaitMs: 40, perCall: 50 };

type Entry = { at: number; value: any | null }; // value: Jupiter's object for that token, null = Jupiter had no price
const cache = new Map<string, Entry>();
let queue: { base: string; mints: Set<string>; waiters: (() => void)[]; fetchJson: (u: string) => Promise<any> } | null = null;

const isPriceUrl = (u: string) => /\/price\/v3\?ids=/.test(u);

async function flush(q: NonNullable<typeof queue>) {
  const mints = [...q.mints];
  for (let i = 0; i < mints.length; i += PRICE_CACHE.perCall) {
    const chunk = mints.slice(i, i + PRICE_CACHE.perCall);
    try {
      const data = await q.fetchJson(q.base + chunk.join(","));
      for (const m of chunk) cache.set(m, { at: Date.now(), value: data?.[m] ?? null });
      // Jupiter answered but has no price for some: DexScreener, if that coin's pool still has money in it and traded in
      // the last hour. Otherwise it stays unknown. A brief gap in Jupiter alone should not write a live coin off at 0.
      const unpriced = chunk.filter((m) => !data?.[m]);
      if (unpriced.length) await dexScreenerPrices(q.fetchJson, unpriced, true).catch(() => {});
    } catch {
      // Jupiter's keyed and free hosts both failed (context.ts tries both): DexScreener's live price, from the coin's
      // deepest pool. Not cached when it fails too: the callers see no price and try again on their next look.
      await dexScreenerPrices(q.fetchJson, chunk).catch(() => {});
    }
  }
  if (cache.size > 2000) for (const [m, e] of cache) if (Date.now() - e.at > PRICE_CACHE.maxAgeMs) cache.delete(m);
  q.waiters.forEach((w) => w());
}

// The backup price source: DexScreener, 30 tokens a call, no key. Same shape as Jupiter's answer (usdPrice, liquidity),
// liquidity being the deepest pool's (lower than Jupiter's total, so the paper price impact comes out larger, not smaller).
export const DEXSCREENER = "https://api.dexscreener.com/tokens/v1/solana/";
async function dexScreenerPrices(fetchJson: (u: string) => Promise<any>, mints: string[], mustBeActive = false) {
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const pairs = await fetchJson(DEXSCREENER + chunk.join(","));
    const best = new Map<string, any>();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const m = p?.baseToken?.address, price = Number(p?.priceUsd), liq = Number(p?.liquidity?.usd ?? 0);
      if (!chunk.includes(m) || !(price > 0)) continue;
      if (mustBeActive && !(liq > 0 && Number(p?.volume?.h1) > 0)) continue; // an empty or silent pool's price is only its last trade
      if (!best.has(m) || liq > best.get(m).liquidity) best.set(m, { usdPrice: price, liquidity: liq > 0 ? liq : null, source: "dexscreener" });
    }
    for (const m of chunk) cache.set(m, { at: Date.now(), value: best.get(m) ?? null });
  }
}

export function cachedPriceFetch(fetchJson: (url: string) => Promise<any>): (url: string) => Promise<any> {
  return async (url: string) => {
    if (!isPriceUrl(url)) return fetchJson(url);
    const [base, ids] = [url.slice(0, url.indexOf("ids=") + 4), url.slice(url.indexOf("ids=") + 4)];
    const mints = ids.split(",").filter(Boolean);
    const fresh = (m: string) => { const e = cache.get(m); return e && Date.now() - e.at <= PRICE_CACHE.maxAgeMs; };
    const missing = mints.filter((m) => !fresh(m));
    if (missing.length) {
      await new Promise<void>((resolve) => {
        if (!queue || queue.base !== base) {
          const q = (queue = { base, mints: new Set(), waiters: [], fetchJson });
          setTimeout(() => { if (queue === q) queue = null; void flush(q); }, PRICE_CACHE.batchWaitMs);
        }
        missing.forEach((m) => queue!.mints.add(m));
        queue!.waiters.push(resolve);
      });
    }
    // Only answers younger than 8 seconds are used: an older price is never passed off as the current one.
    const out: Record<string, any> = {};
    for (const m of mints) { const v = fresh(m) ? cache.get(m)!.value : null; if (v) out[m] = v; }
    if (missing.length && missing.every((m) => !fresh(m))) throw new Error("Jupiter's price API couldn't be reached");
    return out;
  };
}

export const clearPriceCache = () => { cache.clear(); queue = null; };
