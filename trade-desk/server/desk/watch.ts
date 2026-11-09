// Learning from every coin, not just the ones bought: the desk records each coin it sees (traded or rejected) with what
// its rules said, then looks at its pool again 6 and 24 hours later. deskLessons() then shows, for each rule, how often
// the coins it flagged lost 90%+ against the ones it didn't. Market data: GeckoTerminal (the desk's own price source);
// safety facts: Solana Pulse token_safety, only for coins that reached the deep check.
import { pool } from "../db";
import { candidateFrom, valueToLiquidity, type Candidate } from "./agents";

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

export async function watchSeen(runId: string, cs: Candidate[]) {
  for (const c of cs) {
    await pool.query(`INSERT INTO desk_watch (mint, run_id, pool, symbol, dex, price0, liq0, fdv0, vol_h1, ratio0, buys_h1, sells_h1, same_ticker)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        (SELECT COUNT(*)::int FROM desk_watch w WHERE UPPER(w.symbol) = UPPER($4) AND w.mint <> $1 AND w.first_seen > NOW() - INTERVAL '2 days'))
      ON CONFLICT (mint) DO NOTHING`,
      [c.mint, runId, c.pool, c.symbol, c.dex, c.priceUsd, c.liquidityUsd, c.fdvUsd ?? null, c.volumeH1Usd, valueToLiquidity(c), c.buysH1, c.sellsH1]);
  }
}

export async function watchDeep(mint: string, facts: Record<string, any>) {
  await pool.query(`UPDATE desk_watch SET verdict = $2, top10 = $3, rug_chance = $4, creator_split = $5 WHERE mint = $1`,
    [mint, facts.verdict ?? null, typeof facts.top10Pct === "number" ? facts.top10Pct : null, facts.rugChance ? JSON.stringify(facts.rugChance) : null, facts.creatorSplit ?? null]);
}

// One GeckoTerminal call a minute: up to 30 coins whose 6- or 24-hour look is due. A pool GeckoTerminal no longer
// returns is recorded with no price (unknown), not as a loss.
export async function watchFollowUp(fetchJson: (url: string) => Promise<any>, nowMs: number) {
  const now = new Date(nowMs).toISOString();
  const due = (await pool.query(`SELECT mint, pool, first_seen, at_6h FROM desk_watch
    WHERE (at_6h IS NULL AND first_seen <= $1::timestamptz - INTERVAL '6 hours') OR (at_24h IS NULL AND first_seen <= $1::timestamptz - INTERVAL '24 hours')
    ORDER BY first_seen LIMIT 30`, [now])).rows;
  if (!due.length) return 0;
  const got = new Map<string, Candidate>();
  for (const p of (await fetchJson(`${GT}/pools/multi/${due.map((d: any) => d.pool).join(",")}`))?.data ?? []) { const c = candidateFrom(p); if (c) got.set(c.pool, c); }
  for (const d of due) {
    const c = got.get(d.pool), slot = d.at_6h ? "24h" : "6h";
    await pool.query(`UPDATE desk_watch SET at_${slot} = $2, price_${slot} = $3, liq_${slot} = $4 WHERE mint = $1`, [d.mint, now, c?.priceUsd ?? null, c?.liquidityUsd ?? null]);
  }
  return due.length;
}

// For each rule: of the coins it flagged and the ones it didn't, how many lost 90%+ of their price or pool cash within
// 24 hours (only coins already looked at 24 hours later, with a known price). Small groups say little: n is shown.
export async function deskLessons() {
  const rows = (await pool.query(`SELECT w.*, t.status, t.reason FROM desk_watch w LEFT JOIN desk_tokens t ON t.mint = w.mint AND t.run_id = w.run_id
    WHERE w.at_24h IS NOT NULL AND w.price_24h IS NOT NULL AND w.price0 > 0`)).rows;
  const lost = (r: any) => r.price_24h <= r.price0 * 0.1 || (r.liq0 > 0 && r.liq_24h !== null && r.liq_24h <= r.liq0 * 0.1);
  const pools = rows.filter((r: any) => r.dex !== "pump-fun");
  const group = (name: string, of: any[], flag: (r: any) => boolean | null) => {
    const known = of.filter((r) => flag(r) !== null), yes = known.filter((r) => flag(r)), no = known.filter((r) => !flag(r));
    const pct = (xs: any[]) => (xs.length ? Math.round((xs.filter(lost).length / xs.length) * 1000) / 10 : null);
    return { rule: name, flagged: yes.length, flagged_lost90_pct: pct(yes), not_flagged: no.length, not_flagged_lost90_pct: pct(no) };
  };
  return {
    coins_followed_24h: rows.length, in_a_pool: pools.length, on_bonding_curve: rows.length - pools.length,
    note: "lost90 = price or pool cash down 90%+ 24 hours after the desk first saw the coin. Coins in a pool only (bonding-curve coins have no pool to measure).",
    rules: [
      group("worth over 300x its pool cash (test cap)", pools, (r) => (r.ratio0 === null ? null : r.ratio0 > 300)),
      group("worth over 100x its pool cash (Pulse rug_chance line)", pools, (r) => (r.ratio0 === null ? null : r.ratio0 > 100)),
      group("Pulse rug_chance high (deep-checked coins)", pools, (r) => (r.verdict === null ? null : r.rug_chance?.level === "high")),
      group("creator sent equal amounts to 10+ wallets in a minute (Pulse creator_split fail)", pools, (r) => (r.creator_split === null || r.creator_split === "info" ? null : r.creator_split === "fail")),
      group("creator sent to 10+ wallets in a minute, any amounts (fail or warn)", pools, (r) => (r.creator_split === null || r.creator_split === "info" ? null : r.creator_split !== "pass")),
      group("top 10 holders under 1% (deep-checked coins)", pools, (r) => (r.top10 === null ? null : r.top10 < 1)),
      group("another coin with the same ticker in the last 2 days", pools, (r) => (r.same_ticker === null ? null : r.same_ticker > 0)),
      // XTO had 3,397 buys and 95 sells in the hour before the desk bought; AODF pfQB 2,149 and 59. The 5 coins that
      // weren't dumped had 1.3-1.7 buys per sell. Almost nobody selling while thousands buy looks staged.
      group("under 5% of the last hour's trades were sells", pools, (r) => (r.buys_h1 === null || r.sells_h1 === null || r.buys_h1 + r.sells_h1 === 0 ? null : r.sells_h1 / (r.buys_h1 + r.sells_h1) < 0.05)),
      group("1h volume under $50k when first seen", pools, (r) => (r.vol_h1 === null ? null : r.vol_h1 < 50_000)),
      group("bought by the desk", pools, (r) => r.status === "traded"),
    ],
  };
}
