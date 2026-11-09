// Export daily ETF bars from Alpaca (free IEX feed, split/dividend adjusted) for the rule search — but ONLY up to the
// lock date. The newest LOCK_SESSIONS sessions are never written to disk here, so whoever searches for rules (agy) can't
// see them; the final check fetches them fresh from Alpaca (scripts/final-check.ts). Source: Alpaca market data API.
//   npx tsx scripts/export-search-data.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { bars, type Bar } from "../src/alpaca.js";
import { SECTOR_ETFS } from "../src/universe.js";

const HISTORY = 3000;       // ask for as much as the feed gives
const LOCK_SESSIONS = 252;  // ~1 year held back

const all = new Map<string, Bar[]>();
for (const s of SECTOR_ETFS) {
  try { const b = await bars(s, "1Day", HISTORY); if (b.length > 250) all.set(s, b); } catch (e) { console.error(s, String(e)); }
}
const spy = all.get("SPY");
if (!spy) throw new Error("no SPY bars");
const lockDate = spy[spy.length - LOCK_SESSIONS].t;
const out: Record<string, Bar[]> = {};
for (const [s, b] of all) out[s] = b.filter((x) => x.t < lockDate);
mkdirSync(new URL("../research/data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../research/data/etf-search.json", import.meta.url), JSON.stringify({
  source: "Alpaca market data v2, IEX feed, 1Day bars, adjustment=all",
  exportedAt: new Date().toISOString(),
  lockDate, // bars on/after this date are held back for the final check
  bars: out,
}));
for (const [s, b] of Object.entries(out)) console.log(`${s.padEnd(5)} ${b.length} bars  ${b[0]?.t.slice(0, 10)} → ${b.at(-1)?.t.slice(0, 10)}`);
console.log(`locked from ${lockDate.slice(0, 10)} (${LOCK_SESSIONS} sessions, not written)`);
