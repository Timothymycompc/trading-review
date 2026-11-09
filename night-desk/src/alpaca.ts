// The real Alpaca connection (paper only). Market data (IEX free feed) and the paper account/orders. Keys come from the
// environment (NIGHT_DESK_ALPACA_KEY / _SECRET, kept in Google Secret Manager) — never hard-coded, never a live account.
// Every number the desk uses that comes from here is real and sourced to Alpaca; a missing one is left undefined, not guessed.
const DATA = "https://data.alpaca.markets";
const PAPER = "https://paper-api.alpaca.markets";

function headers() {
  const key = process.env.NIGHT_DESK_ALPACA_KEY ?? "";
  const secret = process.env.NIGHT_DESK_ALPACA_SECRET ?? "";
  if (!key || !secret) throw new Error("Alpaca keys missing (NIGHT_DESK_ALPACA_KEY / NIGHT_DESK_ALPACA_SECRET).");
  return { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "content-type": "application/json" };
}

async function call(base: string, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Alpaca ${res.status}: ${body?.message ?? JSON.stringify(body).slice(0, 160)}`);
  return body;
}

export interface Account { status: string; cash: number; buyingPower: number; equity: number; paper: true; }
export async function account(): Promise<Account> {
  const a = await call(PAPER, "/v2/account");
  return { status: a.status, cash: Number(a.cash), buyingPower: Number(a.buying_power), equity: Number(a.equity), paper: true };
}

export interface Clock { isOpen: boolean; nextOpen: string; nextClose: string; }
export async function clock(): Promise<Clock> {
  const c = await call(PAPER, "/v2/clock");
  return { isOpen: !!c.is_open, nextOpen: c.next_open, nextClose: c.next_close };
}

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; }
// Daily/intraday bars for one symbol from the free IEX feed. Oldest first. Empty array if Alpaca returns none.
export async function bars(symbol: string, timeframe: "1Day" | "1Hour" | "15Min" = "1Day", limit = 120): Promise<Bar[]> {
  // The free IEX feed returns nothing without a start date, so look back enough calendar days to cover `limit` sessions
  // (markets are closed ~2 of every 7 days plus holidays).
  const start = new Date(Date.now() - Math.ceil(limit * (timeframe === "1Day" ? 1.9 : 0.1)) * 86_400_000).toISOString();
  // Over-fetch the whole window (Alpaca returns oldest first and caps at `limit` FROM the start), then keep the most
  // recent `limit` bars.
  const q = new URLSearchParams({ timeframe, limit: "10000", feed: "iex", adjustment: "all", start });
  const b = await call(DATA, `/v2/stocks/${encodeURIComponent(symbol)}/bars?${q}`);
  const all = (b.bars ?? []).map((x: any) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
  return all.slice(-limit);
}

export interface Position { symbol: string; qty: number; marketValue: number; unrealizedPl: number; }
export async function positions(): Promise<Position[]> {
  const p = await call(PAPER, "/v2/positions");
  return (p ?? []).map((x: any) => ({ symbol: x.symbol, qty: Number(x.qty), marketValue: Number(x.market_value), unrealizedPl: Number(x.unrealized_pl) }));
}

// Submit a PAPER market order by dollar amount (notional). Paper only — the base URL is the paper endpoint. Caller must
// have passed the Risk Officer first; this function does not decide, it only sends what it is told.
export async function submitPaperOrder(o: { symbol: string; notionalUsd: number; side: "buy" | "sell" }): Promise<{ id: string; status: string }> {
  const r = await call(PAPER, "/v2/orders", {
    method: "POST",
    body: JSON.stringify({ symbol: o.symbol, notional: o.notionalUsd.toFixed(2), side: o.side, type: "market", time_in_force: "day" }),
  });
  return { id: r.id, status: r.status };
}
