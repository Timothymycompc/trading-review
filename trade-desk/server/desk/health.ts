// Is each paper lane still working? On 2026-11-05 Main, Fast and WAIT-5 had nearly stopped trading because of rate limits,
// and nothing said so. This reads the lanes' own records. "Quiet" means no buy for longer than that lane has gone in normal
// running; it doesn't say why, and a quiet market can be the reason. No wallet or real-money numbers here: the page is public.
import { pool } from "../db";
import { isRetired } from "./retired";

export const HEALTH = {
  // Hours without a buy before a lane counts as quiet (each is above the longest normal gap seen on Nov 3-7).
  lanes: [
    { id: "main", name: "Main", key: "run", quietHours: 48 },
    { id: "fast", name: "Fast", key: "fast_run", quietHours: 24 },
    { id: "ladder", name: "Ladder A", key: "ladder_run", quietHours: 2 },
    { id: "ladderB", name: "Ladder B", key: "ladderB_run", quietHours: 2 },
    { id: "momo", name: "WAIT-5", key: "momo_run", quietHours: 24 },
    { id: "copy", name: "Real wallet copy", key: "copy_run", quietHours: 24 },
  ],
  minTicksPerHour: 50, // the tick runs once a minute
  alertEveryMinutes: 60,
};

export async function deskHealth(nowMs = Date.now()) {
  const runs = new Map((await pool.query(`SELECT key, value FROM desk_state WHERE key = ANY($1::text[])`, [HEALTH.lanes.map((l) => l.key)])).rows.map((r: any) => [r.key, r.value]));
  const lanes = [];
  for (const l of HEALTH.lanes) {
    const run: any = runs.get(l.key);
    if (!run) continue;
    const r = (await pool.query(`SELECT MAX(opened_at) AS last_buy, MAX(closed_at) AS last_close FROM desk_positions WHERE run_id = $1`, [run.run_id])).rows[0];
    const since = Date.parse(r.last_buy ?? run.started_at), hours = (nowMs - since) / 3_600_000;
    const paused = l.id === "momo" && (await pool.query(`SELECT 1 FROM desk_events WHERE run_id = $1 AND action = 'paused' LIMIT 1`, [run.run_id])).rowCount! > 0;
    lanes.push({ id: l.id, name: l.name, last_buy: r.last_buy ?? null, last_close: r.last_close ?? null, hours_since_buy: Math.round(hours * 10) / 10, paused, retired: isRetired(l.id), quiet: !paused && !isRetired(l.id) && hours > l.quietHours });
  }
  const main: any = runs.get("run");
  const ticks = main ? Number((await pool.query(`SELECT COUNT(*) AS n FROM desk_equity WHERE run_id = $1 AND at > $2`, [main.run_id, new Date(nowMs - 3_600_000).toISOString()])).rows[0].n) : null;
  const started = main ? Date.parse(main.started_at) : nowMs;
  return { lanes, ticks_last_hour: ticks, ticks_low: ticks !== null && nowMs - started > 3_600_000 && ticks < HEALTH.minTicksPerHour, checked_at: new Date(nowMs).toISOString() };
}

// Called at the end of each tick. At most once an hour it writes one line to the server log, which the
// "Trade Desk needs a look" alert (Cloud Monitoring) watches for and emails to the owner.
export async function healthTick(nowMs: number) {
  const last = (await pool.query(`SELECT value FROM desk_state WHERE key = 'health_alerted_at'`)).rows[0]?.value;
  if (last && nowMs - Number(last) < HEALTH.alertEveryMinutes * 60_000) return null;
  const h = await deskHealth(nowMs), quiet = h.lanes.filter((l) => l.quiet);
  if (!quiet.length && !h.ticks_low) return null;
  await pool.query(`INSERT INTO desk_state (key, value) VALUES ('health_alerted_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(nowMs)]);
  const msg = `DESK_HEALTH_ALERT ${[...quiet.map((l) => `${l.name}: no buy for ${l.hours_since_buy} h`), ...(h.ticks_low ? [`only ${h.ticks_last_hour} ticks in the last hour`] : [])].join("; ")}`;
  console.error(msg);
  return msg;
}
