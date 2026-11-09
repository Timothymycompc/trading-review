// One overnight research cycle, end to end on REAL Alpaca data. Pulls daily bars for the universe, ranks them by the
// honest feature set, takes the top candidate, runs it through the Risk Officer, and logs an idea + handoff to the journal.
// It does NOT fake a backtest or a score: a candidate is a lead, not a proven strategy, so it is NEVER auto-traded. A
// paper probe order is placed only with --place AND the market open AND the Risk Officer clears it — and it is labelled an
// unproven probe. Default run is a dry run.
//   npm run cycle            research only (dry run), prints a brief
//   npm run cycle -- --place place one small unproven paper probe on the top candidate if the market is open
import { account, clock, bars, positions, submitPaperOrder } from "../src/alpaca.js";
import { UNIVERSE } from "../src/universe.js";
import { features, type Features } from "../src/signals.js";
import { loadDeskRules } from "../src/deskRules.js";
import { veto } from "../src/crew/riskOfficer.js";
import { logEntry } from "../src/journal.js";

const PLACE = process.argv.includes("--place");
const PROBE_USD = 50; // a tiny unproven paper probe, well under any real risk budget

async function main() {
  const rules = loadDeskRules() ?? null;
  const capital = rules?.paperCapitalUsd ?? 100_000;
  const maxRiskPct = rules?.maxRiskPerTradePct ?? 0.01;

  const acct = await account();
  const mkt = await clock();
  console.log(`Account ${acct.status} (paper) · equity $${acct.equity.toLocaleString("en-US")} · market ${mkt.isOpen ? "OPEN" : `closed, next open ${mkt.nextOpen}`}`);

  // Pull bars for the whole universe, a few at a time (free IEX feed).
  const feats: Features[] = [];
  for (let i = 0; i < UNIVERSE.length; i += 5) {
    const batch = await Promise.all(UNIVERSE.slice(i, i + 5).map(async (sym) => {
      try { return features(sym, await bars(sym, "1Day", 70)); } catch { return null; }
    }));
    for (const f of batch) if (f) feats.push(f);
  }
  feats.sort((a, b) => b.rankScore - a.rankScore);
  console.log(`Ranked ${feats.length}/${UNIVERSE.length} names. Top candidates by momentum/breakout (a lead, NOT proven):`);
  for (const f of feats.slice(0, 5)) {
    console.log(`  ${f.symbol.padEnd(6)} close $${f.close.toFixed(2)}  20d ${pct(f.mom20)}  60d ${pct(f.mom60)}  ${f.breakout20 ? "breakout" : "        "}  volx ${f.volumeRatio?.toFixed(1) ?? "?"}`);
  }
  const top = feats[0];
  if (!top) { console.log("No candidate with enough data."); return; }

  // Log the idea. isEstimate is implicit: it is a feature-based lead, never scored as profitable here.
  logEntry("idea", { ticker: top.symbol, signal: "volume-breakout", thesis: `Top of the universe by 20/60-day momentum${top.breakout20 ? " with a 20-day breakout" : ""}. Unproven — needs a backtest before it can be scored or traded.`, features: top, source: "Alpaca" });

  // Risk Officer: real veto from the desk rules (size, never-trade list, earnings/Fed/CPI windows).
  const riskUsd = capital * maxRiskPct;
  const v = veto({ ticker: top.symbol, riskUsd, paperCapitalUsd: capital, plannedEntryTime: new Date().toISOString(), rules: rules ?? undefined });
  logEntry("veto", v);
  console.log(`Risk Officer on ${top.symbol}: ${v.vetoed ? "VETO — " + v.reasons.join("; ") : "clear"} (risk budget $${riskUsd.toFixed(0)}/trade)`);

  logEntry("handoff", { ticker: top.symbol, idea: "momentum/breakout lead", evidence: `20d ${pct(top.mom20)}, 60d ${pct(top.mom60)}, breakout=${top.breakout20}`, nextStep: "Backtest this rule out-of-sample (walk-forward, after costs) before it may be scored or traded." });

  // Kill switch (paper): stop placing if equity has fallen 2% from the $100k paper baseline, or 5 probes are already open,
  // or we already hold this name. The prompt's spirit: never pile in, cut it off on drawdown.
  const BASELINE = 100_000;
  const open = await positions().catch(() => []);
  const drawdownHit = acct.equity < BASELINE * 0.98;
  const held = open.some((p) => p.symbol === top.symbol);
  if (PLACE && mkt.isOpen && !v.vetoed && !drawdownHit && open.length < 5 && !held) {
    const order = await submitPaperOrder({ symbol: top.symbol, notionalUsd: PROBE_USD, side: "buy" });
    logEntry("trade", { strategyId: "unproven-probe", ticker: top.symbol, side: "buy", notionalUsd: PROBE_USD, accountMode: "paper", broker: "Alpaca", status: order.status, submittedAt: new Date().toISOString(), note: "Unproven momentum probe (paper). Not a scored strategy." });
    console.log(`Placed an UNPROVEN $${PROBE_USD} paper probe on ${top.symbol} (order ${order.id}, ${order.status}).`);
  } else if (PLACE) {
    const why = v.vetoed ? "Risk Officer vetoed" : !mkt.isOpen ? "market is closed" : drawdownHit ? "kill switch: equity down 2%+" : held ? `already holding ${top.symbol}` : open.length >= 5 ? "5 probes already open" : "no reason";
    console.log(`No probe placed: ${why}.`);
  } else {
    console.log("Dry run — no order. Pass --place to allow one small unproven paper probe when the market is open.");
  }
}

const pct = (x?: number) => (x == null ? "  ?  " : `${(x * 100 >= 0 ? "+" : "")}${(x * 100).toFixed(1)}%`);
main().catch((e) => { console.error(e); process.exit(1); });
