// The memecoin desk's state (paper trading): balance, positions, every token it has looked at, and the log of every
// decision any agent made. One Postgres schema, so a restart or a new Cloud Run instance continues where it left off.
import { pool } from "../db";

export const START_BALANCE_USD = 1000;

export async function ensureDeskSchema() {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS desk_state (key TEXT PRIMARY KEY, value JSONB NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS desk_events (
      id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), run_id TEXT NOT NULL,
      agent TEXT NOT NULL, action TEXT NOT NULL, mint TEXT, symbol TEXT, reason TEXT NOT NULL, detail JSONB)`,
    `CREATE INDEX IF NOT EXISTS desk_events_run ON desk_events (run_id, id)`,
    `CREATE TABLE IF NOT EXISTS desk_tokens (
      run_id TEXT NOT NULL, mint TEXT NOT NULL, symbol TEXT, pool TEXT, first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL, retry_after TIMESTAMPTZ, reason TEXT, score NUMERIC, PRIMARY KEY (run_id, mint))`,
    `CREATE TABLE IF NOT EXISTS desk_positions (
      id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, mint TEXT NOT NULL, symbol TEXT, pool TEXT NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), entry_price DOUBLE PRECISION NOT NULL, size_usd DOUBLE PRECISION NOT NULL,
      qty DOUBLE PRECISION NOT NULL, peak_price DOUBLE PRECISION NOT NULL, trail_active BOOLEAN NOT NULL DEFAULT FALSE,
      last_price DOUBLE PRECISION, last_liq DOUBLE PRECISION, misses INT NOT NULL DEFAULT 0,
      closed_at TIMESTAMPTZ, exit_price DOUBLE PRECISION, proceeds_usd DOUBLE PRECISION, exit_reason TEXT, score NUMERIC, entry_detail JSONB)`,
    // The ladder (likely-rug tier): the steps, how many are sold, and the money they brought in so far.
    `ALTER TABLE desk_positions ADD COLUMN IF NOT EXISTS ladder JSONB`,
    `ALTER TABLE desk_positions ADD COLUMN IF NOT EXISTS ladder_done INT NOT NULL DEFAULT 0`,
    `ALTER TABLE desk_positions ADD COLUMN IF NOT EXISTS realized_usd DOUBLE PRECISION NOT NULL DEFAULT 0`,
    // The Pulse pull watch: when Solana Pulse last looked at this position again.
    `ALTER TABLE desk_positions ADD COLUMN IF NOT EXISTS pull_checked_at TIMESTAMPTZ`,
    // Every coin the desk sees, traded or rejected, with what each rule said about it and what happened to it 6 and 24
    // hours later, so every rule (old and test) gets measured on all of them, not just on the few that were bought.
    `CREATE TABLE IF NOT EXISTS desk_watch (
      mint TEXT PRIMARY KEY, run_id TEXT NOT NULL, pool TEXT NOT NULL, symbol TEXT, dex TEXT, first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      price0 DOUBLE PRECISION, liq0 DOUBLE PRECISION, fdv0 DOUBLE PRECISION, vol_h1 DOUBLE PRECISION, ratio0 DOUBLE PRECISION, same_ticker INT,
      verdict TEXT, top10 DOUBLE PRECISION, rug_chance JSONB,
      at_6h TIMESTAMPTZ, price_6h DOUBLE PRECISION, liq_6h DOUBLE PRECISION, at_24h TIMESTAMPTZ, price_24h DOUBLE PRECISION, liq_24h DOUBLE PRECISION)`,
    `CREATE INDEX IF NOT EXISTS desk_watch_seen ON desk_watch (first_seen)`,
    `ALTER TABLE desk_watch ADD COLUMN IF NOT EXISTS buys_h1 INT`,
    `ALTER TABLE desk_watch ADD COLUMN IF NOT EXISTS sells_h1 INT`,
    `ALTER TABLE desk_watch ADD COLUMN IF NOT EXISTS creator_split TEXT`,
    `CREATE TABLE IF NOT EXISTS desk_equity (run_id TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cash DOUBLE PRECISION NOT NULL, equity DOUBLE PRECISION NOT NULL)`,
  ]) await pool.query(sql);
}

export type Run = { run_id: string; mode: "paper"; started_at: string; start_balance: number; cash: number };

export async function currentRun(): Promise<Run | null> {
  const r = await pool.query(`SELECT value FROM desk_state WHERE key = 'run'`);
  return r.rows[0]?.value ?? null;
}
export async function saveRun(run: Run) {
  await pool.query(`INSERT INTO desk_state (key, value) VALUES ('run', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(run)]);
}
// A fresh paper run: new id, full balance, nothing held. Old runs stay in the tables for comparison.
export async function startRun(balance = START_BALANCE_USD): Promise<Run> {
  const run: Run = { run_id: new Date().toISOString().replace(/[:.]/g, "-"), mode: "paper", started_at: new Date().toISOString(), start_balance: balance, cash: balance };
  await saveRun(run);
  return run;
}

export async function log(run_id: string, agent: string, action: string, reason: string, x: { mint?: string; symbol?: string; detail?: unknown } = {}) {
  await pool.query(`INSERT INTO desk_events (run_id, agent, action, mint, symbol, reason, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [run_id, agent, action, x.mint ?? null, x.symbol ?? null, reason, x.detail === undefined ? null : JSON.stringify(x.detail)]);
}
