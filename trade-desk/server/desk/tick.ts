// One minute of the desk (Cloud Scheduler calls it every minute). Order: RISK checks open positions first (exits
// never wait on scouting), then SCOUT -> FILTER -> ANALYST -> EXECUTOR, with LOGGER recording every decision.
// A Postgres advisory lock stops two ticks from running at once. Paper trading only.
import { pool } from "../db";
import type { ToolContext } from "../tools/types";
import { rugReport } from "../tools/lib";
import { cachedPulseSafety, PULSE_CACHE } from "./pulseCache";
import { cachedPriceFetch } from "./priceCache";
import { gtPaced } from "./gtGate";
import { analyst, candidateFrom, executorPlan, exitFill, filterDeep, filterVolume, ladderFor, ladderSellShare, ladderSells, pullSignals, pullSnapshot, pullWatched, riskDecision, RULES, scout, type Candidate } from "./agents";
import { currentRun, log, saveRun, startRun, type Run } from "./store";
import { isRetired } from "./retired";
import { watchDeep, watchFollowUp, watchSeen } from "./watch";
import { currentFast, fastBuy, fastWatch, startFast } from "./fast";
import { buyInto, currentLadder, LADDER_B, ladderScan, ladderWatch, MOMO_LANE } from "./ladder";
import { momoDecide, momoPaused, momoQueue } from "./momo";
import { healthTick } from "./health";
import { walletCopyBuy } from "./walletCopy";
import { applyTuning, tunerTick } from "./tuner";
import { liveLotteryDeps, lotteryBuy, lotteryWatch, type LotteryDeps } from "./lottery";

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const LOCK = 7_331_001;

// fastWatchMs: how long the fast lane's price watcher keeps looking (every 10 s) inside this tick; 0 = one look (tests).
// safety: Solana Pulse's token_safety, for the pull watch (tests pass a stand-in; none = the watch is off).
export type TickDeps = { fetchJson: (url: string) => Promise<any>; deep: typeof filterDeep; now: () => number; fastWatchMs?: number; safety?: (mint: string) => Promise<any>; lottery?: LotteryDeps; ladderSafety?: (mint: string) => Promise<any>; tune?: boolean; momo?: boolean; scoutPace?: boolean };
// scoutPace: space the scout's GeckoTerminal pages out (agents.ts SCOUT_PACE); left out (tests) = no waiting.
// ladderSafety: Pulse token_safety for the ladder lane's own checks; left out (tests) = the ladder lane buys nothing.
// lottery: the REAL-money lottery lane (server/desk/lottery.ts); left out (tests) = off.
// Open trades in every lane are looked at every 10 s. Cloud Scheduler starts a tick at the top of each minute; the
// watchers keep looking until second 52 of that minute (last look ~:50), so the next tick's first look lands ~10 s later:
// no gap between minutes. (Was a fixed 45 s window, which left ~15 s unwatched every minute.)
export const watchWindowMs = (nowMs: number) => Math.max(0, 52_000 - (nowMs % 60_000));
// Every bot asks Pulse through one shared memory (pulseCache.ts): buy checks reuse an answer up to 10 minutes old, the
// pull watch only up to 90 seconds, so it still sees a pull starting.
const liveDeps = (ctx: ToolContext): TickDeps => ({
  fetchJson: cachedPriceFetch(gtPaced((u) => ctx.fetchJson(u, 15_000))), deep: (c2, c) => filterDeep(c2, c, { safety: (m) => cachedPulseSafety(m), rug: (m) => rugReport(c2, m) }),
  now: Date.now, fastWatchMs: watchWindowMs(Date.now()), safety: (m) => cachedPulseSafety(m, PULSE_CACHE.pullMaxAgeMs),
  ladderSafety: (m) => cachedPulseSafety(m), lottery: liveLotteryDeps(ctx), tune: true, momo: true, scoutPace: true,
});

async function equityOf(run: Run) {
  const r = await pool.query(`SELECT COALESCE(SUM(qty * COALESCE(last_price, entry_price)), 0) AS v FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL`, [run.run_id]);
  return run.cash + Number(r.rows[0].v);
}

export async function tick(ctx: ToolContext, deps: TickDeps = liveDeps(ctx)) {
  // The fast lane's price watcher runs next to the main desk (its own lock), so a slow safety check never delays its sales.
  // Each bot's tuner may have changed its exits (server/desk/tuner.ts): put them in force before anything looks.
  await applyTuning();
  if (!(await currentFast())) await startFast();
  const fast = fastWatch(deps.fetchJson, deps.now, deps.fastWatchMs ?? 0).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 200) }));
  const ladder = ladderWatch(deps.fetchJson, deps.now, deps.fastWatchMs ?? 0).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 200) }));
  const lottery = deps.lottery ? lotteryWatch(deps.lottery, deps.fastWatchMs ?? 0).catch((e: any) => ({ error: String(e?.message ?? e).slice(0, 200) })) : Promise.resolve(null);
  const got = await pool.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
  if (!got.rows[0]?.ok) return { skipped: "another tick is running", fast: await fast, ladder: await ladder, lottery: await lottery };
  let main;
  try { main = await tickLocked(ctx, deps); }
  finally { await pool.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
  return { ...main, fast: await fast, ladder: await ladder, lottery: await lottery };
}

async function tickLocked(ctx: ToolContext, deps: TickDeps) {
  let run = (await currentRun()) ?? (await startRun());
  const id = run.run_id;
  const out = { run_id: id, exits: 0, scanned: 0, rejected: 0, scored: 0, bought: 0, errors: [] as string[] };

  // ---- RISK: open positions first ----
  const open = (await pool.query(`SELECT * FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL ORDER BY id`, [id])).rows;
  if (open.length) {
    const prices = new Map<string, { price: number | null; liq: number | null }>();
    let answered = false; // a failed price call says nothing about the coins, so it doesn't count toward a write-off
    try {
      const data = (await deps.fetchJson(`${GT}/pools/multi/${open.map((p: any) => p.pool).join(",")}`))?.data ?? [];
      for (const p of data) { const c = candidateFrom(p); if (c) prices.set(c.pool, { price: c.priceUsd, liq: c.liquidityUsd }); }
      answered = true;
    } catch (e: any) { out.errors.push(`RISK prices: ${String(e?.message ?? e).slice(0, 100)}`); }
    for (const p of open) {
      const now = prices.get(p.pool);
      if (!now?.price) {
        // A coin with no price for 30 minutes is written off, as on the other lanes; before 2026-11-07 it stayed open for
        // good at its last price, flattering the balance. The buying and selling rules are unchanged.
        if (answered && p.misses + 1 >= RULES.writeOffMinutes) {
          const banked = Number(p.realized_usd ?? 0), reason = `no price for ${RULES.writeOffMinutes} min: written off`;
          await pool.query(`UPDATE desk_positions SET closed_at = NOW(), exit_price = 0, proceeds_usd = $2, exit_reason = $3 WHERE id = $1`, [p.id, banked, reason]);
          out.exits++; p.closed_at = new Date();
          await log(id, "RISK", "exit", `${p.symbol}: ${reason}. In $${Number(p.size_usd).toFixed(2)}, out $${banked.toFixed(2)}, ${((banked / p.size_usd - 1) * 100).toFixed(1)}%.`, { mint: p.mint, symbol: p.symbol });
          continue;
        }
        await pool.query(`UPDATE desk_positions SET misses = misses + 1 WHERE id = $1`, [p.id]);
        await log(id, "RISK", "no_price", `No price for ${p.symbol} this minute (${p.misses + 1} in a row); holding, stop still armed.`, { mint: p.mint, symbol: p.symbol });
        continue;
      }
      const d = riskDecision(p, now.price);
      if (d.exit) {
        const fill = exitFill(now.price, p.qty * p.entry_price, now.liq);
        const last = Math.max(0, p.qty * fill), proceeds = last + Number(p.realized_usd ?? 0);
        await pool.query(`UPDATE desk_positions SET closed_at = NOW(), exit_price = $2, proceeds_usd = $3, exit_reason = $4, last_price = $5, last_liq = $6, peak_price = $7, trail_active = $8 WHERE id = $1`,
          [p.id, fill, proceeds, d.reason, now.price, now.liq, d.peak, d.trail]);
        run.cash += last; out.exits++; p.closed_at = new Date();
        const banked = Number(p.realized_usd ?? 0) > 0 ? ` (rest of it; $${Number(p.realized_usd).toFixed(2)} was banked earlier by the ladder)` : "";
        await log(id, "RISK", "exit", `${p.symbol}: ${d.reason}. Sold for $${last.toFixed(2)}${banked}. In $${Number(p.size_usd).toFixed(2)}, out $${proceeds.toFixed(2)}, ${((proceeds / p.size_usd - 1) * 100).toFixed(1)}%.`, { mint: p.mint, symbol: p.symbol, detail: { price: now.price, fill, peak: d.peak } });
        await log(id, "EXECUTOR", "sell", `Paper sell ${p.symbol} at $${fill.toPrecision(6)} after fee and price impact.`, { mint: p.mint, symbol: p.symbol });
      } else {
        // The ladder (likely-rug tier): sell one share of the starting position at each step the price has reached.
        const steps = ladderSells(p, now.price);
        if (steps) {
          const startQty = p.size_usd / p.entry_price;
          const share = ladderSellShare(p.ladder) * steps, qty = Math.min(p.qty, startQty * share);
          const fill = exitFill(now.price, qty * p.entry_price, now.liq), got = Math.max(0, qty * fill);
          await pool.query(`UPDATE desk_positions SET qty = qty - $2, realized_usd = realized_usd + $3, ladder_done = ladder_done + $4 WHERE id = $1`, [p.id, qty, got, steps]);
          p.qty -= qty; run.cash += got;
          const done = p.ladder_done + steps, at = (p.ladder as number[]).slice(p.ladder_done, done).map((s) => `+${+(s * 100).toFixed(1)}%`).join(", ");
          await log(id, "RISK", "ladder", `${p.symbol} is up ${((now.price / p.entry_price - 1) * 100).toFixed(1)}%: ladder step ${done} of ${p.ladder.length} (${at}). Sold ${+(share * 100).toFixed(1)}% of the position for $${got.toFixed(2)}; ${p.qty > 0 ? "the rest holds" : "nothing left"}.`, { mint: p.mint, symbol: p.symbol, detail: { price: now.price, fill, steps } });
          await log(id, "EXECUTOR", "sell", `Paper sell ${+(share * 100).toFixed(1)}% of ${p.symbol} at $${fill.toPrecision(6)} after fee and price impact.`, { mint: p.mint, symbol: p.symbol });
        }
        await pool.query(`UPDATE desk_positions SET last_price = $2, last_liq = $3, peak_price = $4, trail_active = $5, misses = 0 WHERE id = $1`, [p.id, now.price, now.liq, d.peak, d.trail]);
        if (d.trail && !p.trail_active) await log(id, "RISK", "trail_on", `${p.symbol} is up ${((d.peak / p.entry_price - 1) * 100).toFixed(1)}%: trailing stop on (sells ${RULES.trailPct * 100}% below the peak).`, { mint: p.mint, symbol: p.symbol });
      }
    }
    // ---- RISK, the Pulse pull watch: likely-rug positions get Solana Pulse's token_safety again every 2 minutes, and are
    // sold in full when Pulse sees the pull starting compared with what it saw at the buy. Unknown = hold and log it.
    const w = RULES.pullWatch;
    const due = deps.safety ? open.filter((p: any) => !p.closed_at && p.qty > 0 && pullWatched(p) && (!p.pull_checked_at || deps.now() - Date.parse(p.pull_checked_at) >= w.everyMinutes * 60_000))
      .sort((a: any, b: any) => (a.pull_checked_at ? Date.parse(a.pull_checked_at) : 0) - (b.pull_checked_at ? Date.parse(b.pull_checked_at) : 0)).slice(0, w.maxPerTick) : [];
    for (const p of due) {
      await pool.query(`UPDATE desk_positions SET pull_checked_at = $2 WHERE id = $1`, [p.id, new Date(deps.now()).toISOString()]);
      let s: any;
      try { s = await deps.safety!(p.mint); } catch (e: any) {
        await log(id, "RISK", "pull_unknown", `${p.symbol}: Pulse pull watch couldn't check it (${String(e?.message ?? e).slice(0, 80)}); holding, stop still armed.`, { mint: p.mint, symbol: p.symbol });
        continue;
      }
      const snap = pullSnapshot(s), why = pullSignals(p.entry_detail?.filter?.pull, snap, s?.history);
      if (!why.length) {
        await log(id, "RISK", "pull_ok", `${p.symbol}: Pulse pull watch, no sign of a pull (${s?.verdict ?? "?"}; liquidity $${snap.liquidityUsd === null ? "unknown" : Math.round(snap.liquidityUsd).toLocaleString("en-US")}, insiders ${snap.insiderPct ?? "unknown"}%, top 10 ${snap.top10Pct ?? "unknown"}%).`, { mint: p.mint, symbol: p.symbol, detail: { snapshot: snap } });
        continue;
      }
      const price = prices.get(p.pool)?.price ?? p.last_price ?? p.entry_price, liq = prices.get(p.pool)?.liq ?? p.last_liq ?? null;
      const fill = exitFill(price, p.qty * p.entry_price, liq), last = Math.max(0, p.qty * fill), proceeds = last + Number(p.realized_usd ?? 0);
      const reason = `Pulse pull watch: ${why.join("; ")}`;
      await pool.query(`UPDATE desk_positions SET closed_at = NOW(), exit_price = $2, proceeds_usd = $3, exit_reason = $4, last_price = $5, last_liq = $6 WHERE id = $1`, [p.id, fill, proceeds, reason, price, liq]);
      run.cash += last; out.exits++;
      await log(id, "RISK", "exit", `${p.symbol}: ${reason}. Sold for $${last.toFixed(2)}. In $${Number(p.size_usd).toFixed(2)}, out $${proceeds.toFixed(2)}, ${((proceeds / p.size_usd - 1) * 100).toFixed(1)}%.`, { mint: p.mint, symbol: p.symbol, detail: { price, fill, snapshot: snap, then: p.entry_detail?.filter?.pull ?? null } });
      await log(id, "EXECUTOR", "sell", `Paper sell ${p.symbol} at $${fill.toPrecision(6)} after fee and price impact.`, { mint: p.mint, symbol: p.symbol });
    }
    await saveRun(run);
  }

  // ---- SCOUT ----
  const { candidates, errors } = await scout(deps.fetchJson, deps.scoutPace ? undefined : async () => {});
  out.errors.push(...errors); out.scanned = candidates.length;
  // The ladder lane looks at everything the scout found (its own rules, its own Pulse checks), side by side with the main desk.
  const ladderBuys = ladderScan(candidates, deps.ladderSafety, deps.fetchJson, deps.now(),
    // The REAL lottery lane buys from the ladder lane's checks too (Tim: "any coin that's a fraction of a cent").
    // The real wallet's paper copy buys wherever those rules would (walletCopy.ts).
    deps.lottery ? async (c, verdict) => { await walletCopyBuy(c, verdict, deps.fetchJson, deps.now()).catch((e: any) => out.errors.push(`wallet copy: ${String(e?.message ?? e).slice(0, 100)}`)); return lotteryBuy(c, { verdict }, deps.lottery!); } : undefined).catch((e: any) => { out.errors.push(`ladder: ${String(e?.message ?? e).slice(0, 100)}`); return null; });
  // The WAIT-5 lane (paper, momo.ts): queue what the scout saw, and decide on the coins whose first 5 minutes are over.
  if (deps.momo && !isRetired("momo")) {
    try {
      await momoQueue(candidates, deps.now());
      const m = await momoDecide(deps.fetchJson, deps.now(), (c, live, why) => buyInto(MOMO_LANE, c, `WAIT-5 passed: ${why}`, live, deps.now()), momoPaused);
      (out as any).momo = m;
    } catch (e: any) { out.errors.push(`wait-5: ${String(e?.message ?? e).slice(0, 100)}`); }
  }
  const known = new Map<string, any>((await pool.query(`SELECT mint, status, retry_after FROM desk_tokens WHERE run_id = $1`, [id])).rows.map((r: any) => [r.mint, r]));
  const fresh = candidates.filter((c) => { const k = known.get(c.mint); return !k || (k.status === "retry" && Date.parse(k.retry_after) <= deps.now()); });
  try { await watchSeen(id, candidates.filter((c) => !known.has(c.mint))); } catch (e: any) { out.errors.push(`watch: ${String(e?.message ?? e).slice(0, 100)}`); }
  await log(id, "SCOUT", "scan", `Scanned ${candidates.length} pools (new + trending 1h); ${fresh.length} not yet decided.`, { detail: { errors } });

  // ---- FILTER stage 1 (volume), then stage 2 (safety) on the busiest few ----
  const deepQueue: Candidate[] = [];
  for (const c of fresh) {
    const f = filterVolume(c);
    if (!f.pass) {
      // Low volume and "still on the bonding curve" both change with time: look again later. (2026-11-05: curve coins were
      // rejected for good, so a coin that graduated to a real pool was never checked again: 39,091 such rejections.)
      const retry = f.reasons.every((r) => r.startsWith("1h volume") || r.startsWith("still on the Pump.fun bonding curve"));
      await pool.query(`INSERT INTO desk_tokens (run_id, mint, symbol, pool, status, retry_after, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (run_id, mint) DO UPDATE SET status = EXCLUDED.status, retry_after = EXCLUDED.retry_after, reason = EXCLUDED.reason`,
        [id, c.mint, c.symbol, c.pool, retry ? "retry" : "rejected", retry ? new Date(deps.now() + RULES.volumeRetryMinutes * 60_000).toISOString() : null, f.reasons.join("; ")]);
      if (!known.has(c.mint)) await log(id, "FILTER", "reject", `${c.symbol}: ${f.reasons.join("; ")}`, { mint: c.mint, symbol: c.symbol, detail: f.facts });
      out.rejected++;
    } else deepQueue.push(c);
  }
  deepQueue.sort((a, b) => (b.volumeH1Usd ?? 0) - (a.volumeH1Usd ?? 0));
  for (const c of deepQueue.slice(0, RULES.maxDeepChecksPerTick)) {
    const f = await deps.deep(ctx, c);
    try { await watchDeep(c.mint, f.facts); } catch {}
    if (!f.pass) {
      await pool.query(`INSERT INTO desk_tokens (run_id, mint, symbol, pool, status, reason) VALUES ($1,$2,$3,$4,'rejected',$5)
        ON CONFLICT (run_id, mint) DO UPDATE SET status = 'rejected', reason = EXCLUDED.reason, retry_after = NULL`, [id, c.mint, c.symbol, c.pool, f.reasons.join("; ")]);
      await log(id, "FILTER", "reject", `${c.symbol}: ${f.reasons.join("; ")}`, { mint: c.mint, symbol: c.symbol, detail: f.facts });
      out.rejected++;
      continue;
    }
    await log(id, "FILTER", "pass", `${c.symbol}: passed every rule (mint revoked, LP ${f.facts.lpLockedPct}% locked, top 10 ${f.facts.top10Pct}%, $${Math.round(c.volumeH1Usd ?? 0).toLocaleString("en-US")} 1h volume, clean creator).`, { mint: c.mint, symbol: c.symbol, detail: f.facts });
    // The fast lane buys here, on the safety rules alone (no score); it never stops the main desk.
    try { await fastBuy(c, f.facts, deps.fetchJson, deps.now()); } catch (e: any) { out.errors.push(`fast lane buy: ${String(e?.message ?? e).slice(0, 100)}`); }
    // The lottery lane (REAL money) buys here too, under its own rules and limits.
    if (deps.lottery) try { await lotteryBuy(c, f.facts, deps.lottery); } catch (e: any) { out.errors.push(`lottery buy: ${String(e?.message ?? e).slice(0, 100)}`); }
    if (deps.lottery) try { await walletCopyBuy(c, f.facts.verdict as string | null, deps.fetchJson, deps.now()); } catch (e: any) { out.errors.push(`wallet copy: ${String(e?.message ?? e).slice(0, 100)}`); }

    // The main desk's own buys are retired (retired.ts); its scan and safety checks above keep running.
    if (isRetired("main")) continue;

    // ---- ANALYST ----
    const a = analyst(c, deps.now());
    out.scored++;
    const why = Object.entries(a.parts).map(([k, p]) => `${k} ${p.value.toFixed(2)} (${p.why})`).join(", ");
    if (!a.pass) {
      await pool.query(`INSERT INTO desk_tokens (run_id, mint, symbol, pool, status, reason, score) VALUES ($1,$2,$3,$4,'rejected',$5,$6)
        ON CONFLICT (run_id, mint) DO UPDATE SET status = 'rejected', reason = EXCLUDED.reason, score = EXCLUDED.score`, [id, c.mint, c.symbol, c.pool, `score ${a.score} < 0.6`, a.score]);
      await log(id, "ANALYST", "reject", `${c.symbol}: score ${a.score} < 0.6. ${why}`, { mint: c.mint, symbol: c.symbol, detail: a });
      continue;
    }
    await log(id, "ANALYST", "pass", `${c.symbol}: score ${a.score}. ${why}`, { mint: c.mint, symbol: c.symbol, detail: a });

    // ---- EXECUTOR (paper): one position per token, ever; 8% of equity at most ----
    const held = (await pool.query(`SELECT 1 FROM desk_positions WHERE run_id = $1 AND mint = $2`, [id, c.mint])).rowCount;
    if (held) { await log(id, "EXECUTOR", "skip", `${c.symbol}: already traded this run (no averaging down, no re-entry).`, { mint: c.mint, symbol: c.symbol }); continue; }
    // Tokens with the same ticker: both may be held, they share one 8%, and both go in the likely-rug tier.
    const twins = (await pool.query(`SELECT id, symbol, qty, entry_price FROM desk_positions WHERE run_id = $1 AND closed_at IS NULL AND UPPER(symbol) = UPPER($2)`, [id, c.symbol])).rows;
    const plan = executorPlan(c, await equityOf(run), run.cash, twins.reduce((t: number, w: any) => t + w.qty * w.entry_price, 0));
    if (!plan.ok) { await log(id, "EXECUTOR", "skip", `${c.symbol}: ${plan.reason}.`, { mint: c.mint, symbol: c.symbol }); continue; }
    // The likely-rug tier: Pulse's rug_chance "high", or another open token with the same ticker. Traded, with the ladder.
    const rug: any = f.facts.rugChance;
    const ladder = ladderFor(rug?.level === "high", twins.length > 0);
    await pool.query(`INSERT INTO desk_positions (run_id, mint, symbol, pool, entry_price, size_usd, qty, peak_price, last_price, last_liq, score, entry_detail, ladder)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8,$9,$10,$11,$12)`, [id, c.mint, c.symbol, c.pool, plan.fill, plan.size, plan.qty, c.priceUsd, c.liquidityUsd, a.score, JSON.stringify({ candidate: c, filter: f.facts }), ladder ? JSON.stringify(ladder) : null]);
    if (twins.length) await pool.query(`UPDATE desk_positions SET ladder = $2 WHERE id = ANY($1::bigint[])`, [twins.map((t: any) => t.id), JSON.stringify(ladder)]);
    await pool.query(`INSERT INTO desk_tokens (run_id, mint, symbol, pool, status, score) VALUES ($1,$2,$3,$4,'traded',$5)
      ON CONFLICT (run_id, mint) DO UPDATE SET status = 'traded', score = EXCLUDED.score`, [id, c.mint, c.symbol, c.pool, a.score]);
    run.cash -= plan.size; out.bought++;
    await saveRun(run);
    await log(id, "EXECUTOR", "buy", `Paper buy ${c.symbol}: $${plan.size.toFixed(2)} (${twins.length ? `what's left of the 8% the ${c.symbol} pair shares` : "8% of equity"}) at $${plan.fill.toPrecision(6)} incl. fee and ${(plan.impact * 100).toFixed(2)}% impact. Stop at -6%, trail after +12%.${ladder ? ` Likely-rug tier (${twins.length ? `another ${c.symbol} is already held, so both go in the likely-rug tier with the finer ladder` : `Pulse: ${(rug.reasons ?? []).join(" ")}`}): sells ${+(ladderSellShare(ladder) * 100).toFixed(1)}% at each of ${ladder.map((s) => `+${+(s * 100).toFixed(1)}%`).join(", ")}, the last ${+(ladderSellShare(ladder) * 100).toFixed(1)}% on the trail.` : ""}`, { mint: c.mint, symbol: c.symbol, detail: { ...plan, ladder, rug_chance: rug ?? null } });
  }
  if (deepQueue.length > RULES.maxDeepChecksPerTick) await log(id, "FILTER", "queue", `${deepQueue.length - RULES.maxDeepChecksPerTick} more passed volume; checked next minute.`);

  // ---- learning: look again at coins seen 6 and 24 hours ago (one GeckoTerminal call) ----
  try { await watchFollowUp(deps.fetchJson, deps.now()); } catch (e: any) { out.errors.push(`watch follow-up: ${String(e?.message ?? e).slice(0, 100)}`); }

  await ladderBuys;

  // ---- the tuners: every 20 closed trades (40+ in all), replay and maybe change one exit rule per bot ----
  if (deps.tune) {
    try {
      const ids = { main: id, fast: (await currentFast())?.run_id, ladder: (await currentLadder())?.run_id, ladderB: (await currentLadder(LADDER_B))?.run_id, momo: (await currentLadder(MOMO_LANE))?.run_id };
      await tunerTick(deps.fetchJson, deps.now(), ids);
    } catch (e: any) { out.errors.push(`tuner: ${String(e?.message ?? e).slice(0, 100)}`); }
  }

  // ---- equity point ----
  run = (await currentRun())!;
  const equity = await equityOf(run);
  await pool.query(`INSERT INTO desk_equity (run_id, cash, equity) VALUES ($1,$2,$3)`, [id, run.cash, equity]);
  if (deps.momo) await healthTick(deps.now()).catch((e: any) => out.errors.push(`health: ${String(e?.message ?? e).slice(0, 100)}`));
  return { ...out, cash: run.cash, equity };
}
