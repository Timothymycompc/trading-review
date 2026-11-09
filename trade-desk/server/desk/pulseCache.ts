// One shared memory of Solana Pulse's token_safety answers for every bot (main desk, fast lane, ladders, lottery, pull
// watch). Why (2026-11-04): the bots asked Pulse about 3,400 times a day, a third of them about a coin some bot had asked
// about in the last 10 minutes, and Pulse's Solana data service began turning Pulse away (HTTP 429: 31 times on Oct 31,
// 7,421 on Nov 3), which slows Pulse and leaves fields unknown for every caller, not just the bots.
// Kept in Postgres so every Cloud Run instance and every tick shares it. Only real answers are kept; a failed call is not.
// Buy checks reuse an answer up to 10 minutes old; the pull watch, which looks for a pull starting, only up to 90 seconds.
import { pool } from "../db";
import { pulseTokenSafety } from "./agents";

export const PULSE_CACHE = { buyMaxAgeMs: 10 * 60_000, pullMaxAgeMs: 90_000 };

let ready: Promise<unknown> | null = null;
const ensure = () => (ready ??= pool.query(`CREATE TABLE IF NOT EXISTS desk_pulse_cache (mint TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL, answer JSONB NOT NULL)`));
const inFlight = new Map<string, Promise<any>>();

export type PulseCacheDeps = { ask: (mint: string) => Promise<any>; read: (mint: string) => Promise<{ at: number; answer: any } | null>; write: (mint: string, answer: any) => Promise<void>; now: () => number };
const liveDeps: PulseCacheDeps = {
  ask: pulseTokenSafety,
  read: async (mint) => {
    await ensure();
    const r = await pool.query(`SELECT at, answer FROM desk_pulse_cache WHERE mint = $1`, [mint]);
    return r.rows[0] ? { at: new Date(r.rows[0].at).getTime(), answer: r.rows[0].answer } : null;
  },
  write: async (mint, answer) => {
    await ensure();
    await pool.query(`INSERT INTO desk_pulse_cache (mint, at, answer) VALUES ($1, NOW(), $2) ON CONFLICT (mint) DO UPDATE SET at = NOW(), answer = EXCLUDED.answer`, [mint, JSON.stringify(answer)]);
    if (Math.random() < 0.01) await pool.query(`DELETE FROM desk_pulse_cache WHERE at < NOW() - INTERVAL '1 day'`);
  },
  now: Date.now,
};

// Pulse's answer for a coin, from the shared memory when it is young enough, otherwise asked fresh (and remembered).
// Two bots asking about the same coin at the same moment share one call. A cache problem never stops a check: it asks.
export async function cachedPulseSafety(mint: string, maxAgeMs = PULSE_CACHE.buyMaxAgeMs, deps: PulseCacheDeps = liveDeps): Promise<any> {
  const hit = await deps.read(mint).catch(() => null);
  if (hit && deps.now() - hit.at <= maxAgeMs) return hit.answer;
  const key = `${mint}:${maxAgeMs}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = deps.ask(mint).then(async (answer) => { await deps.write(mint, answer).catch(() => {}); return answer; }).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
