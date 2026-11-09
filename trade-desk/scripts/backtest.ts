// Backtest: replay every bot's current exit rules on coins the desk really scanned (research/<dir>/coins.json),
// using the same replay the tuners use (server/desk/tuner.ts simulate: stop first inside a minute, crash minutes fill
// at the close, quiet minutes ignored). Candles: GeckoTerminal minute OHLCV, up to 1,000 minutes after the coin was seen.
//
// Superseded for results by scripts/entry-test.ts: this replay has no volume check or buy cost on the entry, so don't quote its numbers.
//   npx tsx scripts/backtest.ts fetch  <dir>  downloads candles + replays, writes <dir>/results.json (slow: ~2 s a coin)
//   npx tsx scripts/backtest.ts report <dir>   prints the summary from results.json
//   npx tsx scripts/backtest.ts replay <dir>   replays saved candles (candles-*.json) with the current rules
//
// The fetch runs in Cloud Build (scripts/backtest-cloud.sh), not on the phone.
import fs from "node:fs";
import path from "node:path";
import { exitOf, simulate, type BotId } from "../server/desk/tuner";

type Coin = { mint: string; pool: string; symbol: string; at: number; tier: "small" | "big" };
type Row = Coin & { entry: number; minutes: number; r: Record<string, number> } | Coin & { skip: string };
const BOT_IDS: BotId[] = ["main", "fast", "ladder", "ladderB"];
const NAMES: Record<BotId, string> = { main: "Main", fast: "Fast", ladder: "Ladder A", ladderB: "Ladder B" };
const COSTS = [0.005, 0.01];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let limited = 0;

// In Cloud Build: saves the results so far to Cloud Storage (BACKTEST_SAVE_TO=gs://bucket/path.json), so a build that
// runs out of time still leaves everything it fetched. Uses the build machine's own Google login (metadata server).
async function checkpoint(rows: unknown, suffix = "") {
  const to = process.env.BACKTEST_SAVE_TO?.replace(/\.json$/, `${suffix}.json`);
  if (!to) return;
  try {
    const m = to.match(/^gs:\/\/([^/]+)\/(.+)$/)!;
    const tok = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json() as any;
    await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${m[1]}/o?uploadType=media&name=${encodeURIComponent(m[2])}`, {
      method: "POST", headers: { authorization: `Bearer ${tok.access_token}`, "content-type": "application/json" }, body: JSON.stringify(rows) });
  } catch (e) { console.log(`checkpoint failed: ${e}`); }
}

async function candles(pool: string, at: number): Promise<number[][]> {
  const before = Math.min(Math.floor(Date.now() / 1000), at + 1000 * 60);
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute?aggregate=1&limit=1000&before_timestamp=${before}&currency=usd`;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429 || res.status >= 500) { limited++; await sleep(20_000 * (i + 1)); continue; }
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d: any = await res.json();
    return (d?.data?.attributes?.ohlcv_list ?? []).map((x: any[]) => x.map(Number)).sort((a: number[], b: number[]) => a[0] - b[0]);
  }
  throw new Error("rate limited");
}

// The price when the coin was seen: the last minute's close if it is under 10 minutes old, else the next minute's open.
export function replay(c: Coin, cs: number[][]): Row {
  const before = cs.filter((x) => x[0] <= c.at), after = cs.filter((x) => x[0] > c.at);
  if (!after.length) return { ...c, skip: "no trades after it was seen" };
  const prev = before[before.length - 1];
  const entry = prev && c.at - prev[0] < 600 ? prev[4] : after[0][1];
  if (!(entry > 0)) return { ...c, skip: "no price" };
  const r: Record<string, number> = {};
  for (const b of BOT_IDS) for (const cost of COSTS) r[`${b}@${cost}`] = simulate(exitOf(b), entry, c.at, after, cost);
  return { ...c, entry, minutes: Math.round((after[after.length - 1][0] - c.at) / 60), r };
}

async function fetchAll(dir: string) {
  const { coins } = JSON.parse(fs.readFileSync(path.join(dir, "coins.json"), "utf8")) as { coins: Coin[] };
  const out = path.join(dir, "results.json");
  const done: Row[] = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
  const have = new Set(done.map((d) => d.mint));
  let n = 0;
  const started = Date.now();
  // Every coin's candles are kept too (in batches of 50), so changed rules can be replayed later without refetching:
  //   npx tsx scripts/backtest.ts replay <dir>   (reads <dir>/candles-*.json)
  let batch: Record<string, number[][]> = {};
  for (const c of coins) {
    if (have.has(c.mint)) continue;
    const t = Date.now();
    try { const cs = await candles(c.pool, c.at); batch[c.mint] = cs; done.push(replay(c, cs)); } catch (e: any) { done.push({ ...c, skip: `fetch failed: ${e.message}` }); }
    if (++n % 50 === 0) {
      fs.writeFileSync(out, JSON.stringify(done));
      fs.writeFileSync(path.join(dir, `candles-${n}.json`), JSON.stringify(batch));
      console.log(`${done.length}/${coins.length} coins, ${((Date.now() - started) / 60_000 / n * 1000).toFixed(0)} min per 1,000, ${limited} rate-limit waits`);
      await checkpoint(done);
      await checkpoint(batch, `-candles-${n}`);
      batch = {};
    }
    await sleep(Math.max(0, 2100 - (Date.now() - t))); // GeckoTerminal's free limit is 30 calls a minute
  }
  fs.writeFileSync(out, JSON.stringify(done));
  fs.writeFileSync(path.join(dir, `candles-${n}.json`), JSON.stringify(batch));
  await checkpoint(done);
  await checkpoint(batch, `-candles-${n}`);
  report(dir);
}

// Replays saved candles with the bots' current rules (after a rule change), writing <dir>/results.json again.
function replayAll(dir: string) {
  const { coins } = JSON.parse(fs.readFileSync(path.join(dir, "coins.json"), "utf8")) as { coins: Coin[] };
  const all: Record<string, number[][]> = {};
  for (const f of fs.readdirSync(dir).filter((f) => /candles.*\.json$/.test(f))) Object.assign(all, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const rows = coins.filter((c) => all[c.mint]).map((c) => replay(c, all[c.mint]));
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(rows));
  report(dir);
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

function line(rs: number[], label: string) {
  const s = [...rs].sort((a, b) => b - a), top = Math.max(1, Math.round(rs.length * 0.01));
  const half = Math.floor(rs.length / 2);
  return `  ${label.padEnd(9)} ${String(rs.length).padStart(4)} trades  avg ${pct(avg(rs)).padStart(7)}  median ${pct(median(rs)).padStart(7)}  wins ${Math.round((rs.filter((x) => x > 0).length / (rs.length || 1)) * 100)}%`
    + `  $10 each ${(rs.reduce((a, b) => a + b, 0) * 10 >= 0 ? "+" : "-")}$${Math.abs(rs.reduce((a, b) => a + b, 0) * 10).toFixed(0)}`
    + `  without best 1% ${pct(avg(s.slice(top)))}  older/newer half ${pct(avg(rs.slice(0, half)))} / ${pct(avg(rs.slice(half)))}`;
}

export function report(dir: string) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, "coins.json"), "utf8"));
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
  const ok = rows.filter((r): r is Extract<Row, { r: any }> => "r" in r).sort((a, b) => a.at - b.at);
  const skips: Record<string, number> = {};
  for (const r of rows) if ("skip" in r) skips[r.skip.slice(0, 40)] = (skips[r.skip.slice(0, 40)] ?? 0) + 1;
  console.log(`Coins the desk saw ${data.universe.from.slice(0, 16)} to ${data.universe.to.slice(0, 16)} UTC with 1h volume >= $1k, not Pulse AVOID:`);
  console.log(`  ${data.universe.small} at $1k-$10k, ${data.universe.big} at $10k+. Replayed ${ok.length} of a random ${rows.length}; skipped ${JSON.stringify(skips)}`);
  console.log(`  median data after the buy: ${Math.round(median(ok.map((r) => r.minutes)) / 60)} h (the replay sells whatever is left at the last price)`);
  for (const cost of COSTS) {
    console.log(`\nCost ${cost * 100}% a side (fee + slippage):`);
    for (const b of BOT_IDS) {
      console.log(`${NAMES[b]}:`);
      for (const tier of ["small", "big"] as const) console.log(line(ok.filter((r) => r.tier === tier).map((r) => r.r[`${b}@${cost}`]), tier === "small" ? "$1k-10k" : "$10k+"));
      const wSmall = data.universe.small / (data.universe.small + data.universe.big);
      const all = (t: "small" | "big") => avg(ok.filter((r) => r.tier === t).map((r) => r.r[`${b}@${cost}`]));
      console.log(`  all coins >= $1k (weighted like the real flow): avg ${pct(wSmall * all("small") + (1 - wSmall) * all("big"))} a trade`);
    }
  }
  console.log(`\nBy day (Ladder B, 0.5% cost, all tiers):`);
  const days = new Map<string, number[]>();
  for (const r of ok) { const d = new Date(r.at * 1000).toISOString().slice(0, 10); days.set(d, [...(days.get(d) ?? []), r.r["ladderB@0.005"]]); }
  for (const [d, rs] of days) console.log(line(rs, d.slice(5)));
  console.log(`\nBest coins (Ladder B, 0.5%):`);
  for (const r of [...ok].sort((a, b) => b.r["ladderB@0.005"] - a.r["ladderB@0.005"]).slice(0, 8)) console.log(`  ${r.symbol.slice(0, 12).padEnd(12)} ${pct(r.r["ladderB@0.005"])}  (A ${pct(r.r["ladder@0.005"])}, fast ${pct(r.r["fast@0.005"])}, main ${pct(r.r["main@0.005"])})`);
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "fetch") fetchAll(dir).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "report") report(dir);
else if (cmd === "replay") replayAll(dir);
