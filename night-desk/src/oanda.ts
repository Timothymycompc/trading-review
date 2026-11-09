// Oanda v20 connection — PRACTICE (demo) server ONLY. Token from env OANDA_PRACTICE_TOKEN (Google Secret Manager).
// Guards: refuses any account that is not a practice account (ids start "101-"), and order helpers only ever touch
// trades carrying our own tag, so Tim's manual trades are never modified or closed.
const BASE = "https://api-fxpractice.oanda.com/v3";

function token(): string {
  const t = process.env.OANDA_PRACTICE_TOKEN;
  if (!t) throw new Error("OANDA_PRACTICE_TOKEN not set");
  return t;
}
async function call(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await r.text();
  if (!r.ok) throw new Error(`Oanda ${r.status} ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}
const practiceOnly = (account: string) => { if (!/^101-/.test(account)) throw new Error(`refusing non-practice account ${account}`); };

export interface LiveCandle { t: string; o: number; h: number; l: number; c: number; spread: number; complete: boolean }
/** Latest `count` candles (mid prices + bid/ask spread), oldest first. The last one may be the still-forming candle. */
export async function candles(instrument: string, granularity: string, count: number): Promise<LiveCandle[]> {
  const q = new URLSearchParams({ granularity, count: String(count), price: "MBA" });
  const j = await call(`/instruments/${instrument}/candles?${q}`);
  return (j.candles ?? []).map((x: any) => ({ t: x.time, o: +x.mid.o, h: +x.mid.h, l: +x.mid.l, c: +x.mid.c, spread: +x.ask.c - +x.bid.c, complete: !!x.complete }));
}

export interface OandaTrade { id: string; instrument: string; units: number; price: number; openTime: string; unrealizedPL: number; tag?: string }
export async function openTrades(account: string): Promise<OandaTrade[]> {
  practiceOnly(account);
  const j = await call(`/accounts/${account}/openTrades`);
  return (j.trades ?? []).map((t: any) => ({ id: t.id, instrument: t.instrument, units: +t.currentUnits, price: +t.price, openTime: t.openTime, unrealizedPL: +t.unrealizedPL, tag: t.clientExtensions?.tag }));
}
export async function accountSummary(account: string): Promise<{ balance: number; nav: number; openTradeCount: number }> {
  practiceOnly(account);
  const a = (await call(`/accounts/${account}/summary`)).account;
  return { balance: +a.balance, nav: +a.NAV, openTradeCount: +a.openTradeCount };
}
/** Market order on the practice account, tagged so we only ever manage our own trades. Optional take-profit price. */
export async function marketOrder(account: string, instrument: string, units: number, tag: string, takeProfit?: number): Promise<any> {
  practiceOnly(account);
  if (Math.abs(units) > 1000) throw new Error("paper trader is capped at 1,000 units");
  const digits = instrument.includes("JPY") ? 3 : 5;
  const order: any = { type: "MARKET", instrument, units: String(units), timeInForce: "FOK", positionFill: "DEFAULT", tradeClientExtensions: { tag, comment: "night-desk paper" } };
  if (takeProfit) order.takeProfitOnFill = { price: takeProfit.toFixed(digits) };
  return call(`/accounts/${account}/orders`, { method: "POST", body: JSON.stringify({ order }) });
}
export async function closeTrade(account: string, trade: OandaTrade, tag: string): Promise<any> {
  practiceOnly(account);
  if (trade.tag !== tag) throw new Error(`refusing to close trade ${trade.id}: not tagged ${tag}`);
  return call(`/accounts/${account}/trades/${trade.id}/close`, { method: "PUT", body: "{}" });
}
