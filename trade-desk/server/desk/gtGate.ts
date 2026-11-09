// One queue for every GeckoTerminal call the server makes (scout, RISK and watch pools/multi, WAIT-5 and tuner candles).
// 2026-11-05: 50-100% of scans every hour since Nov 3 lost a page to HTTP 429; the callers fired up to ~20 calls a
// minute in bursts (scout 4, WAIT-5 8, tuner 6, pools/multi 2), each with no pause. Now calls go out one at a time,
// at least GT_GATE.gapMs apart, in the order they were asked for.
export const GT_GATE = { gapMs: 1000 };
const isGt = (url: string) => { try { return new URL(url).host === "api.geckoterminal.com"; } catch { return false; } };

let last = 0, chain: Promise<void> = Promise.resolve();
export function gtSlot(now = Date.now, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<void> {
  const mine = chain.then(async () => {
    const wait = last + GT_GATE.gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  });
  chain = mine.catch(() => {});
  return mine;
}

export const gtPaced = <T>(fetchJson: (url: string, timeoutMs?: number) => Promise<T>) =>
  async (url: string, timeoutMs?: number): Promise<T> => { if (isGt(url)) await gtSlot(); return fetchJson(url, timeoutMs); };

export function resetGtGate() { last = 0; chain = Promise.resolve(); }
