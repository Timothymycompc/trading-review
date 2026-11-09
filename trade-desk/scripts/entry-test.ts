// Entry-filter test (2026-11-04, Tim: "run that test on 24k coins"). The backtest (scripts/backtest.ts) showed every
// bot's exits losing on the 23,379 coins the desk scanned Nov 1-4, so the edge, if any, has to come from WHICH coins
// are bought. This splits the coins by what was knowable before the buy and replays each exit on every group:
//   - age: how old the coin's pool was when the desk saw it (GeckoTerminal pool_created_at; unknown if missing)
//   - tier: 1h volume $1k-10k or $10k+ (from the scan)
//   - run-up: the price move in the 60 minutes before the desk saw it (GeckoTerminal candles; unknown when too few)
//   - price under $0.01 (the lottery's rule)
// For each group: how often the coin reached 1.5x / 2x / 3x before a 40% fall, how often it rugged (a close 90% under
// the buy), and the average result per trade of each exit: the four paper bots' current rules and lottery variants
// (first sale at +20%, +50%, +100%). Same pessimistic replay as the tuners (tuner.ts simulate), 1% cost per sale.
// A group only counts as a lead when it averages above zero on the OLDER half of the coins AND on the NEWER half,
// with at least 100 coins in each. Candles cover at most ~16 hours after the coin was seen (1,000 minutes), not 24.
//
//   npx tsx scripts/entry-test.ts <dir with coins.json and candles-*.json> <out dir>
// Runs in Cloud Build (scripts/entry-test-cloud.sh); only the small summary comes back to the phone.
import fs from "node:fs";
import path from "node:path";
import { exitOf, type BotId, type Exit } from "../server/desk/tuner";

type Coin = { mint: string; pool: string; symbol: string; at: number; tier: "small" | "big" };
// Cost per side. COST=0.022 runs Gemini's estimate for young PumpSwap/Meteora pools (pool fee + impact + MEV).
const COST = Number(process.env.COST ?? 0.01);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The test's own, stricter copy of the tuners' replay (server/desk/tuner.ts simulate; the live tuners are unchanged).
// Differences, from Gemini's review and the sample run (2026-11-04):
//   - a thin minute (under $1,000 traded) can still trigger a stop: a live bot sells on Jupiter's price on the way
//     down, so a coin bleeding out in thin minutes no longer slips past a -6% stop to 0. Thin minutes still never
//     sell a ladder step or raise the peak (a dust trade at 1,000x is not a price). A stop in a thin minute fills 5%
//     under the lower of its close and the stop;
//   - a stop in a traded minute fills 2% under the lower of the open and the stop (a market sale after a 10 s look),
//     or at the close (never above the stop) when the minute fell 10%+ through the stop.
// Thin minutes stop on their close (Claude and Gemini agreed 2026-11-04; THIN_LOW=1 restores the harsher wick rule).
const THIN_CLOSE = !process.env.THIN_LOW;
// Gemini's red-team (2026-11-04), adopted:
//   - a ladder step / take-profit fills at the lower of its target and the middle of the minute's high and close: a
//     10-second look catches a brief spike to 2x only sometimes, and then not at the top;
//   - the time-limit sale no longer uses a price from minutes earlier: it fills at the open of the first candle after
//     the limit (within 5 minutes); with none, a pool whose liquidity can be pulled and that hadn't traded for 2
//     minutes before the limit is written off at 0 (a pull leaves no candle), while a PumpSwap/curve pool, whose
//     liquidity stays, sells at its last price.
function simulate(e: Exit, entry: number, openedSec: number, candles: number[][], cost: number, pullable = true): number {
  let qty = 1, cash = 0, peak = entry, done = 0, last: number | null = null, lastTradedT = openedSec, afterEnd: number[] | null = null;
  const end = openedSec + e.maxMinutes * 60;
  for (const cand of candles) {
    const [t, o, h, l, c, v] = cand;
    if (t <= openedSec - 60) continue;
    if (t > end) { afterEnd = cand; break; }
    const gain = peak / entry - 1;
    const trail = [...e.trails].sort((a, b) => b.fromPct - a.fromPct).find((x) => gain >= x.fromPct - 1e-12);
    const trailStop = trail ? peak * (1 - trail.gapPct) : null;
    const beStop = e.breakEven && gain >= e.breakEven.fromPct - 1e-12 ? entry * (1 + e.breakEven.floorPct) : null;
    const floor = trailStop !== null || beStop !== null ? Math.max(trailStop ?? 0, beStop ?? 0) : entry * (1 - e.stopPct);
    if (v < 1000) {
      if (c < (last ?? entry)) last = c;
      // THIN_CLOSE=1: a thin minute stops on its close, not its wick low (a lone dust sell prints a low that a
      // 10-second Jupiter price check rarely sees). Default: the low, the harsher choice.
      if ((THIN_CLOSE ? c : Math.min(l, c)) <= floor) { cash += qty * Math.min(c, floor) * 0.95 * (1 - cost); qty = 0; break; }
      continue;
    }
    if (c < entry * 20) last = c;
    lastTradedT = t;
    // A stop sale never fills above the stop: junk candles (low near 0, close 1,000x) made the "fill at the close" rule
    // pay out millions of percent on 15 coins in the first full run.
    if (l <= floor) { const fill = l < floor * 0.9 ? Math.min(c, floor) : Math.min(o, floor) * 0.98; cash += qty * fill * (1 - cost); qty = 0; break; }
    const real = h < entry * 20;
    while (real && done < e.steps.length && h >= entry * (1 + e.steps[done])) {
      const q = done === e.steps.length - 1 && e.lastStepSellsAll ? qty : Math.min(qty, e.stepShare);
      cash += q * Math.min(entry * (1 + e.steps[done]), (h + c) / 2) * (1 - cost); qty -= q; done++;
      if (qty <= 1e-9) break;
    }
    if (qty <= 1e-9) break;
    if (real) peak = Math.max(peak, h);
  }
  if (qty > 1e-9) {
    let px: number;
    if (afterEnd && afterEnd[0] <= end + 300 && afterEnd[1] < entry * 20) px = afterEnd[1];
    else if (pullable && lastTradedT < end - 120) px = 0; // no traded minute in the last 2 before the limit, none in the 5 after
    else px = last ?? entry;
    cash += qty * px * (1 - cost);
  }
  return cash / entry - 1;
}

const lottery = (first: number): Exit => ({ stopPct: 0.4, steps: [first], stepShare: 0.5, lastStepSellsAll: false, trails: [{ fromPct: first, gapPct: 0.4 }], breakEven: null, maxMinutes: 24 * 60 });
const EXITS: Record<string, Exit> = {
  "Main": exitOf("main" as BotId), "Fast": exitOf("fast" as BotId), "Ladder A": exitOf("ladder" as BotId), "Ladder B": exitOf("ladderB" as BotId),
  "Lottery now (+100%)": lottery(1.0), "Lottery +50%": lottery(0.5), "Lottery +20%": lottery(0.2),
};

// Pool creation times from GeckoTerminal (pools/multi, 30 pools a call; it keeps dead pools too, DexScreener mostly
// doesn't). Its free limit is 30 calls a minute, so one call every 2.1 s: ~780 calls, about 28 minutes.
const DEX = new Map<string, string>(); // pool -> GeckoTerminal dex id (pump-fun, pumpswap, raydium, meteora...)
async function poolAges(coins: Coin[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pools = [...new Set(coins.map((c) => c.pool))];
  for (let i = 0; i < pools.length; i += 30) {
    const chunk = pools.slice(i, i + 30), t = Date.now();
    for (let tries = 0; tries < 5; tries++) {
      try {
        const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${chunk.join(",")}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
        if (res.status === 429 || res.status >= 500) { await sleep(20_000 * (tries + 1)); continue; }
        const d: any = await res.json();
        for (const p of d?.data ?? []) {
          const at = Date.parse(p?.attributes?.pool_created_at ?? ""), dex = p?.relationships?.dex?.data?.id;
          if (p?.attributes?.address && at) out.set(p.attributes.address, Math.floor(at / 1000));
          if (p?.attributes?.address && dex) DEX.set(p.attributes.address, String(dex));
        }
        break;
      } catch { await sleep(10_000); }
    }
    await sleep(Math.max(0, 2100 - (Date.now() - t)));
    if ((i / 30) % 50 === 0) console.log(`ages: ${i}/${pools.length} pools, ${out.size} found`);
  }
  return out;
}

// Gemini's catch (2026-11-04): a Pump.fun curve that graduates stops trading on its curve pool while the coin moves to a
// new pool, and the dead-coin rule wrote those winners off at 0 (165 training coins, 122 of them 2x+). Liquidity can't
// be pulled from a Pump.fun curve or a PumpSwap pool (its LP is burned at graduation), so silence there is a graduation
// or a quiet coin, sold at its last price. Only pools whose liquidity can be pulled (Raydium, Meteora, ...) are written
// off, and a pool whose dex is unknown is treated as pullable (the harsher choice).
// CORRECTION 2026-11-07: "its LP is burned at graduation" holds for a graduated pool, not for every PumpSwap pool. Live on
// WAIT-5, 6 of the first 11 trades went silent while priced at or near the buy and ended at -100%, while this replay sold
// such coins at their last price. PUMPSWAP_PULL=1 writes silent PumpSwap pools off too: the harsh end of the range, since
// some of them are only quiet. The truth is between the two runs.
const NEVER_PULLED = process.env.PUMPSWAP_PULL === "1" ? ["pump-fun"] : ["pump-fun", "pumpswap"];
const canPull = (pool: string) => !NEVER_PULLED.includes(DEX.get(pool) ?? "");

const ageGroup = (sec: number | null) => sec === null ? "unknown" : sec < 600 ? "under 10 min" : sec < 3600 ? "10-60 min" : sec < 6 * 3600 ? "1-6 h" : sec < 86400 ? "6-24 h" : sec < 7 * 86400 ? "1-7 days" : "over 7 days";
const runGroup = (m: number | null) => m === null ? "unknown" : m < -0.2 ? "fell 20%+" : m < 0.2 ? "flat (-20% to +20%)" : m < 1 ? "up 20-100%" : "up 100%+";

type Row = { c: Coin; half: "older" | "newer"; groups: Record<string, string>; reached: Record<string, boolean>; rug: boolean; r: Record<string, number>;
  entry: number; peak: number; peakMin: number; ageMin: number | null; runUp: number | null; preGain: number | null; preVol: number };

function analyse(c: Coin, cs: number[][], created: number | null): Omit<Row, "half"> | null {
  const before = cs.filter((x) => x[0] <= c.at), after = cs.filter((x) => x[0] > c.at);
  if (!after.length) return null;
  // The buy price must come from a minute that really traded ($1,000+): the last such minute's close if it is under 10
  // minutes before the scan, else the next such minute's open if under 10 minutes after. A near-empty minute's price
  // can't be bought at, and an entry taken from one made later prices look like 1,000x gains (2026-11-04 quick run).
  const tradedBefore = before.filter((x) => x[5] >= 1000).pop(), tradedAfter = after.find((x) => x[5] >= 1000);
  const price = tradedBefore && c.at - tradedBefore[0] < 600 ? tradedBefore[4] : tradedAfter && tradedAfter[0] - c.at < 600 ? tradedAfter[1] : NaN;
  if (!(price > 0)) return null;
  // Gemini's review (2026-11-04): simulate() expects the entry to include the buy's cost, as the live bots' entries do;
  // a raw candle price left one side of the round trip free. The buy is now charged the same 1% as each sale.
  const entry = price * (1 + COST);
  // The replay starts at the minute the buy happened (the scan, or the first traded minute after it).
  const boughtAt = tradedBefore && c.at - tradedBefore[0] < 600 ? c.at : tradedAfter![0] - 1;
  // Run-up: the close about 60 minutes before against the entry, only if a candle exists 45-75 minutes before.
  const ref = before.filter((x) => c.at - x[0] >= 45 * 60 && c.at - x[0] <= 75 * 60).pop();
  const runUp = ref && ref[4] > 0 ? entry / ref[4] - 1 : null;
  // Gemini's columns: the price multiple from the first saved candle's open to the scan (the climb since launch, for
  // pools young enough that their first minutes are in the candles) and the dollars traded before the scan.
  const preGain = before.length && before[0][1] > 0 ? price / before[0][1] : null;
  const preVol = before.reduce((a, x) => a + x[5], 0);
  // Reached Nx before a 40% fall (stop first inside a minute, like the replay); traded minutes only (volume $1,000+).
  const reached: Record<string, boolean> = { "1.5x": false, "2x": false, "3x": false };
  let stopped = false, rug = false, peak = 1, peakMin = 0, lastTradedClose: number | null = null;
  for (const [t, , h, l, cl, v] of after) {
    // Peak: the highest price that HELD for two traded minutes in a row (the lower of the two closes). A drained pool
    // prints absurd last prices (the sample showed "28,509x" on coins the replay lost money on); those don't hold.
    if (v >= 1000) { if (lastTradedClose !== null) { const held = Math.min(lastTradedClose, cl) / entry; if (held > peak) { peak = held; peakMin = Math.round((t - c.at) / 60); } } lastTradedClose = cl; }
    if (cl <= entry * 0.1) rug = true;
    if (v < 1000 || stopped) continue;
    if (l <= entry * 0.6) { stopped = true; continue; }
    if (h >= entry * 20) continue; // a one-minute 20x is an emptied pool, not a price
    for (const [k, m] of [["1.5x", 1.5], ["2x", 2], ["3x", 3]] as const) if (h >= entry * m) reached[k] = true;
  }
  // Gemini's review: when a coin stops trading, the replay sold what was left at its last price, but the live bots
  // write an unpriced coin off at 0. A coin whose candles stop completely (GeckoTerminal leaves out minutes with no
  // trade at all) for the last 2 hours of its window is dead: a final minute at (almost) 0 is added, so every exit
  // still holding it sells there. Only for windows that ended before the candles were fetched (from Nov 4, 06:00 UTC).
  const windowEnd = c.at + 1000 * 60, lastCandle = after[after.length - 1];
  const dead = windowEnd < Date.parse("2026-11-04T06:00:00Z") / 1000 && lastCandle[0] < windowEnd - 2 * 3600 && canPull(c.pool);
  const path = dead ? [...after, [windowEnd, entry * 1e-9, entry * 1e-9, entry * 1e-9, entry * 1e-9, 1e6]] : after;
  const r: Record<string, number> = {};
  for (const [name, e] of Object.entries({ ...EXITS, ...GRID })) r[name] = simulate(e, entry, boughtAt, path.filter((x) => x[0] > boughtAt), COST, canPull(c.pool));
  return {
    c, reached, rug, r, entry, peak, peakMin, runUp, preGain, preVol, ageMin: created === null ? null : Math.round((c.at - created) / 60),
    groups: { "Age when seen": ageGroup(created === null ? null : c.at - created), "1h volume": c.tier === "small" ? "$1k-10k" : "$10k+", "Run-up in the hour before": runGroup(runUp), "Price": entry < 0.01 ? "under $0.01" : "$0.01 or more" },
  };
}

// WAIT-AND-SEE entries (Tim 2026-11-04: "work together and find something profitable"): instead of buying at the
// scan, wait k minutes and record what the coin did meanwhile, using only candles up to the buy. Rules can then say
// "buy only if, after 15 minutes, it held its price and kept trading". One row per coin per wait.
const WAITS = [5, 15, 30, 60];
// A grid of simple exits for the wait-and-see buys (the bots' exits were built for buying at the scan): take profit at
// tp, stop at sl, sell after t minutes; and trailing versions (trail gap g once up f). Round numbers, chosen before
// looking. Every survivor still has to pass the hidden day.
const GRID: Record<string, Exit> = {};
for (const tp of [0.1, 0.2, 0.3, 0.5, 1.0]) for (const sl of [0.06, 0.1, 0.2, 0.4]) for (const t of [30, 120, 600])
  GRID[`g tp${tp * 100} sl${sl * 100} t${t}`] = { stopPct: sl, steps: [tp], stepShare: 1, lastStepSellsAll: true, trails: [], breakEven: null, maxMinutes: t };
for (const tp of [0.5, 0.8]) GRID[`g tp${tp * 100} sl35 t60`] = { stopPct: 0.35, steps: [tp], stepShare: 1, lastStepSellsAll: true, trails: [], breakEven: null, maxMinutes: 60 }; // Gemini's
for (const f of [0.1, 0.2]) for (const g of [0.05, 0.1, 0.2]) for (const sl of [0.1, 0.2])
  GRID[`g trail from${f * 100} gap${g * 100} sl${sl * 100}`] = { stopPct: sl, steps: [], stepShare: 0, lastStepSellsAll: false, trails: [{ fromPct: f, gapPct: g }], breakEven: null, maxMinutes: 600 };
type Delayed = { mint: string; half: string; k: number; feats: Record<string, number>; r: Record<string, number> };
function delayed(c: Coin, cs: number[][], _scanPrice: number): Delayed[] {
  const out: Delayed[] = [];
  // The scan price, as a live bot would know it at the scan (Gemini's red-team): the last traded minute's close up to
  // 10 minutes before, or the first traded minute's open within 60 seconds after; never a price from later.
  const tb = cs.filter((x) => x[0] <= c.at && x[5] >= 1000).pop(), ta = cs.find((x) => x[0] > c.at && x[5] >= 1000);
  const scanPrice = tb && c.at - tb[0] < 600 ? tb[4] : ta && ta[0] - c.at <= 60 ? ta[1] : NaN;
  if (!(scanPrice > 0)) return out;
  const windowEnd = c.at + 1000 * 60, lastCandle = cs[cs.length - 1];
  const dead = windowEnd < Date.parse("2026-11-04T06:00:00Z") / 1000 && lastCandle[0] < windowEnd - 2 * 3600 && canPull(c.pool);
  for (const k of WAITS) {
    const tK = c.at + k * 60;
    const seen = cs.filter((x) => x[0] > c.at && x[0] <= tK), traded = seen.filter((x) => x[5] >= 1000);
    const lastT = traded[traded.length - 1];
    if (!lastT || tK - lastT[0] > 300) continue; // no traded minute in the 5 minutes before the buy: nothing to buy at
    const price = lastT[4], entry = price * (1 + COST);
    const highs = traded.map((x) => x[2]).filter((h) => h < scanPrice * 20);
    const hi = Math.max(scanPrice, ...highs), lo = Math.min(scanPrice, ...traded.map((x) => x[3]));
    const recent = seen.filter((x) => x[0] > tK - 300);
    const feats = {
      move_since_scan: price / scanPrice - 1,                     // where the price is now against the scan
      high_since_scan: hi / scanPrice - 1,                         // the best it did meanwhile
      low_since_scan: lo / scanPrice - 1,                          // the worst it did meanwhile
      off_high: price / hi - 1,                                    // how far below its high it is now
      volume_usd: seen.reduce((a, x) => a + x[5], 0),              // dollars traded since the scan
      traded_minutes: traded.length,                               // minutes with $1,000+ traded
      volume_last5_usd: recent.reduce((a, x) => a + x[5], 0),      // dollars traded in the last 5 minutes
      green_share: traded.length ? traded.filter((x) => x[4] >= x[1]).length / traded.length : 0, // share of up-minutes
    };
    const after = cs.filter((x) => x[0] > tK);
    const path = dead ? [...after, [windowEnd, entry * 1e-9, entry * 1e-9, entry * 1e-9, entry * 1e-9, 1e6]] : after;
    const r: Record<string, number> = {};
    for (const [name, e] of Object.entries({ ...EXITS, ...GRID })) r[name] = path.length ? simulate(e, entry, tK, path, COST, canPull(c.pool)) : -COST * 2;
    out.push({ mint: c.mint, half: "", k, feats, r });
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
// The average without the best 1% of trades: a group that is only positive because of a handful of coins says so.
const trimmed = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return avg(s.slice(0, Math.max(1, Math.floor(s.length * 0.99)))); };
const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "n/a");

async function main() {
  const [dir, outDir] = process.argv.slice(2);
  const { coins } = JSON.parse(fs.readFileSync(path.join(dir, "coins.json"), "utf8")) as { coins: Coin[] };
  const all: Record<string, number[][]> = {};
  for (const f of fs.readdirSync(dir).filter((f) => /candles.*\.json$/.test(f))) Object.assign(all, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  const withCandles = coins.filter((c) => all[c.mint]?.length);
  console.log(`${coins.length} coins, ${withCandles.length} with candles`);
  // SKIP_AGES=1: a quick run without the ~2.5 h age lookup (every age is "unknown"), for the other groups.
  // Ages saved by the age builds (ages-*.json, see "ages" below) are used when present; SKIP_AGES=1 skips them.
  const ages = new Map<string, number>();
  for (const f of fs.readdirSync(dir).filter((f) => /^ages-.*\.json$/.test(f))) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) ages.set(k, v as number);
  for (const f of fs.readdirSync(dir).filter((f) => /^dex-.*\.json$/.test(f))) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))) DEX.set(k, v as string);
  if (!ages.size && !process.env.SKIP_AGES) for (const [k, v] of await poolAges(withCandles)) ages.set(k, v);
  const mid = [...withCandles].map((c) => c.at).sort((a, b) => a - b)[Math.floor(withCandles.length / 2)];
  const rows: Row[] = [], waits: Delayed[] = [];
  for (const c of withCandles) {
    const a = analyse(c, all[c.mint], ages.get(c.pool) ?? null);
    if (!a) continue;
    rows.push({ ...a, half: c.at < mid ? "older" : "newer" });
    for (const d of delayed(c, all[c.mint], a.entry / (1 + COST))) waits.push({ ...d, half: c.at < mid ? "older" : "newer" });
  }

  const lines: string[] = [], summary: any = { coins: coins.length, replayed: rows.length, ages_found: ages.size, split_at: new Date(mid * 1000).toISOString(), cost_per_sale: COST, groups: [] as any[], leads: [] as any[] };
  lines.push(`Entry-filter test: ${rows.length} of ${coins.length} coins replayed (${ages.size} pool ages found). Older/newer halves split at ${summary.split_at}. 1% cost per sale.`);
  const describe = (label: string, rs: Row[]) => {
    const g: any = { group: label, n: rs.length, older: rs.filter((r) => r.half === "older").length, newer: rs.filter((r) => r.half === "newer").length,
      reached_1_5x: avg(rs.map((r) => +r.reached["1.5x"])), reached_2x: avg(rs.map((r) => +r.reached["2x"])), reached_3x: avg(rs.map((r) => +r.reached["3x"])), rugged: avg(rs.map((r) => +r.rug)), exits: {} as any };
    lines.push(`\n${label}: ${rs.length} coins | reached 1.5x ${pct(g.reached_1_5x)}, 2x ${pct(g.reached_2x)}, 3x ${pct(g.reached_3x)} before -40% | rugged ${pct(g.rugged)}`);
    for (const name of Object.keys(EXITS)) {
      const o = avg(rs.filter((r) => r.half === "older").map((r) => r.r[name])), nw = avg(rs.filter((r) => r.half === "newer").map((r) => r.r[name])), a = avg(rs.map((r) => r.r[name]));
      g.exits[name] = { all: a, older: o, newer: nw };
      const xs = rs.map((r) => r.r[name]), med = median(xs), trim = trimmed(xs);
      g.exits[name].median = med; g.exits[name].without_top_1pct = trim;
      // A lead: positive on both halves, 100+ coins in each, and still positive without its best 1% of trades.
      const lead = o > 0 && nw > 0 && trim > 0 && g.older >= 100 && g.newer >= 100;
      if (lead) summary.leads.push({ group: label, exit: name, all: a, older: o, newer: nw, median: med, without_top_1pct: trim, n: rs.length });
      lines.push(`   ${name.padEnd(20)} avg ${pct(a).padStart(8)}  median ${pct(med).padStart(7)}  without best 1% ${pct(trim).padStart(7)}  (older ${pct(o)}, newer ${pct(nw)})${lead ? "   <-- LEAD" : ""}`);
    }
    summary.groups.push(g);
  };
  describe("ALL COINS", rows);
  for (const dim of Object.keys(rows[0].groups)) {
    lines.push(`\n========== by ${dim} ==========`);
    const values = [...new Set(rows.map((r) => r.groups[dim]))].sort();
    for (const v of values) describe(`${dim}: ${v}`, rows.filter((r) => r.groups[dim] === v));
  }
  // The lottery's own coins (under $0.01) split by age: the question Tim asked about the +100% sale.
  lines.push(`\n========== lottery coins (under $0.01) by age ==========`);
  for (const v of [...new Set(rows.map((r) => r.groups["Age when seen"]))].sort()) describe(`under $0.01, age ${v}`, rows.filter((r) => r.groups["Price"] === "under $0.01" && r.groups["Age when seen"] === v));
  // The biggest moves after the desk saw a coin, so a real 2,000x (or a bad price) can be looked at by name.
  const dallas = (sec: number) => new Date(sec * 1000).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  lines.push(`\n========== the 25 biggest moves after the desk saw the coin (traded minutes only) ==========`);
  for (const r of [...rows].sort((a, b) => b.peak - a.peak).slice(0, 25))
    lines.push(`  ${r.c.symbol.slice(0, 14).padEnd(14)} ${r.peak.toFixed(1).padStart(8)}x after ${r.peakMin} min | seen ${dallas(r.c.at)} Dallas, pool ${r.ageMin === null ? "age unknown" : `${r.ageMin} min old`} | buy $${r.entry.toPrecision(3)} | lottery ${pct(r.r["Lottery now (+100%)"])}, main ${pct(r.r["Main"])} | ${r.c.mint}`);
  lines.push(`\nLEADS (positive on both halves, 100+ coins each, still positive without the best 1%): ${summary.leads.length ? "" : "none"}`);
  for (const l of summary.leads) lines.push(`  ${l.group} + ${l.exit}: ${pct(l.all)} a trade on ${l.n} coins (older ${pct(l.older)}, newer ${pct(l.newer)})`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry-test.txt"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(outDir, "entry-test.json"), JSON.stringify(summary, null, 1));
  // One row per coin: what was knowable at the scan, then what happened (for BigQuery / other models).
  const names = Object.keys({ ...EXITS, ...GRID });
  const csv = [["mint", "symbol", "seen_at_utc", "half", "volume_tier", "pool_age_min", "pool_dex", "buy_price_usd", "run_up_1h", "pre_gain_from_open", "pre_vol_usd", "peak_x", "minutes_to_peak", "reached_1_5x", "reached_2x", "reached_3x", "rugged", ...names.map((n) => `result_${n.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "").toLowerCase()}`)].join(",")];
  for (const r of rows) csv.push([r.c.mint, JSON.stringify(r.c.symbol), new Date(r.c.at * 1000).toISOString(), r.half, r.c.tier, r.ageMin ?? "", DEX.get(r.c.pool) ?? "", r.entry, r.runUp ?? "", r.preGain === null ? "" : +r.preGain.toFixed(4), Math.round(r.preVol), r.peak.toFixed(4), r.peakMin, +r.reached["1.5x"], +r.reached["2x"], +r.reached["3x"], +r.rug, ...names.map((n) => r.r[n].toFixed(4))].join(","));
  fs.writeFileSync(path.join(outDir, "coins.csv"), csv.join("\n") + "\n");
  // The wait-and-see rows: one per coin per wait, joined to coins.csv by mint.
  const fk = waits.length ? Object.keys(waits[0].feats) : [];
  const wnames = waits.length ? Object.keys(waits[0].r) : names;
  const wcsv = [["mint", "seen_at_utc", "half", "wait_min", ...fk, ...wnames.map((n) => `result_${n.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "").toLowerCase()}`)].join(",")];
  const seenAt = new Map(rows.map((r) => [r.c.mint, new Date(r.c.at * 1000).toISOString()]));
  for (const w of waits) wcsv.push([w.mint, seenAt.get(w.mint), w.half, w.k, ...fk.map((k) => +w.feats[k].toFixed(5)), ...wnames.map((n) => w.r[n].toFixed(4))].join(","));
  fs.writeFileSync(path.join(outDir, "coins-wait.csv"), wcsv.join("\n") + "\n");
  console.log(lines.join("\n"));
}
// "ages <dir> <out> <shard> <of>": only the age lookup, for every <of>-th pool, saved as <out>/ages-<shard>.json,
// so several builds (each its own GeckoTerminal allowance) share the ~2.5 h of lookups.
async function agesOnly() {
  const [, dir, outDir, shard, of] = process.argv.slice(2);
  const { coins } = JSON.parse(fs.readFileSync(path.join(dir, "coins.json"), "utf8")) as { coins: Coin[] };
  const pools = [...new Set(coins.map((c) => c.pool))].filter((_, i) => i % Number(of) === Number(shard));
  const ages = await poolAges(pools.map((pool) => ({ pool } as Coin)));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `ages-${shard}.json`), JSON.stringify(Object.fromEntries(ages)));
  fs.writeFileSync(path.join(outDir, `dex-${shard}.json`), JSON.stringify(Object.fromEntries(DEX)));
  console.log(`saved ${ages.size} of ${pools.length} pool ages`);
}
(process.argv[2] === "ages" ? agesOnly() : main()).catch((e) => { console.error(e); process.exit(1); });
