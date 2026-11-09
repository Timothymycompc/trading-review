// Download any Oanda instrument's candles WITH bid/ask (price=MBA) from the PRACTICE v20 API, so each pair's real spread
// is measured instead of assumed. Saves research/fx/<INSTRUMENT>_<gran>.json: mid OHLC + spread (ask close − bid close).
//   OANDA_PRACTICE_TOKEN=... npx tsx scripts/fx-fetch-pair.ts GBP_USD H4 2016-01-01
import { writeFileSync } from "node:fs";

const [inst = "GBP_USD", gran = "H4", from0 = "2016-01-01", to0 = ""] = process.argv.slice(2); // optional end date; argv[6] = file suffix
const token = process.env.OANDA_PRACTICE_TOKEN;
if (!token) throw new Error("set OANDA_PRACTICE_TOKEN");
const out: { t: string; o: number; h: number; l: number; c: number; spread: number }[] = [];
let from = new Date(from0 + "T00:00:00Z").toISOString();
for (;;) {
  const q = new URLSearchParams({ granularity: gran, price: "MBA", from, count: "5000" });
  const r = await fetch(`https://api-fxpractice.oanda.com/v3/instruments/${inst}/candles?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j: any = await r.json();
  const got = (j.candles ?? []).filter((x: any) => x.complete && x.time > (out.at(-1)?.t ?? ""));
  for (const x of got) out.push({ t: x.time, o: +x.mid.o, h: +x.mid.h, l: +x.mid.l, c: +x.mid.c, spread: +x.ask.c - +x.bid.c });
  if (got.length === 0) break;
  from = new Date(Date.parse(out.at(-1)!.t) + 1000).toISOString();
  if (got.length < 100) break;
  if (to0 && out.at(-1)!.t >= to0) break;
}
if (to0) while (out.length && out.at(-1)!.t >= to0) out.pop();
const pip = inst.includes("JPY") ? 0.01 : 0.0001;
const sp = out.map((x) => x.spread / pip).sort((a, b) => a - b);
writeFileSync(new URL(`../research/fx/${inst}_${gran}${process.argv[6] ?? ""}.json`, import.meta.url), JSON.stringify({
  source: `Oanda v20 practice API, ${inst}, mid + bid/ask, complete candles only`, instrument: inst, granularity: gran, pip,
  medianSpreadPips: sp[Math.floor(sp.length / 2)], fetchedAt: new Date().toISOString(), candles: out,
}));
console.log(`${inst} ${gran}: ${out.length} candles ${out[0]?.t.slice(0, 10)} → ${out.at(-1)?.t.slice(0, 10)}, median spread ${sp[Math.floor(sp.length / 2)].toFixed(2)} pips (p90 ${sp[Math.floor(sp.length * 0.9)].toFixed(2)})`);
