// Download EUR/USD mid-price candles from Oanda's PRACTICE v20 API (Tim's demo account token, OANDA_PRACTICE_TOKEN in
// Secret Manager) into research/fx/EUR_USD_<gran>.json. Source named in the file. Read-only: no orders.
//   OANDA_PRACTICE_TOKEN=... npx tsx scripts/fx-fetch-oanda.ts H1 2016-01-01
import { writeFileSync } from "node:fs";

const gran = process.argv[2] ?? "H1";
const from0 = process.argv[3] ?? "2016-01-01";
const token = process.env.OANDA_PRACTICE_TOKEN;
if (!token) throw new Error("set OANDA_PRACTICE_TOKEN");

interface C { t: string; o: number; h: number; l: number; c: number; v: number }
const out: C[] = [];
let from = new Date(from0 + "T00:00:00Z").toISOString();
for (;;) {
  const q = new URLSearchParams({ granularity: gran, price: "M", from, count: "5000" });
  const r = await fetch(`https://api-fxpractice.oanda.com/v3/instruments/EUR_USD/candles?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j: any = await r.json();
  const got = (j.candles ?? []).filter((x: any) => x.complete && x.time > (out.at(-1)?.t ?? ""));
  for (const x of got) out.push({ t: x.time, o: +x.mid.o, h: +x.mid.h, l: +x.mid.l, c: +x.mid.c, v: x.volume });
  if (got.length === 0) break;
  from = new Date(Date.parse(out.at(-1)!.t) + 1000).toISOString();
  if (got.length < 100) break;
}
writeFileSync(new URL(`../research/fx/EUR_USD_${gran}.json`, import.meta.url), JSON.stringify({
  source: "Oanda v20 practice API, EUR_USD, mid prices, complete candles only", granularity: gran, fetchedAt: new Date().toISOString(), candles: out,
}));
console.log(`${gran}: ${out.length} candles ${out[0]?.t.slice(0, 10)} → ${out.at(-1)?.t.slice(0, 16)}`);
