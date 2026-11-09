// Export the FULL daily ETF history used by the stock tests (search years + the locked year), for publication.
// Source: Alpaca market data v2, IEX feed, 1Day bars, adjustment=all.   npx tsx scripts/export-full-data.ts
import { writeFileSync } from "node:fs";
import { bars } from "../src/alpaca.js";
import { SECTOR_ETFS } from "../src/universe.js";
const out: Record<string, unknown> = {};
for (const s of SECTOR_ETFS) out[s] = await bars(s, "1Day", 3000);
writeFileSync(new URL("../research/data/etf-full.json", import.meta.url), JSON.stringify({ source: "Alpaca market data v2, IEX feed, 1Day bars, adjustment=all", exportedAt: new Date().toISOString(), lockDate: "2025-11-07", bars: out }));
console.log("ok", Object.keys(out).length);
