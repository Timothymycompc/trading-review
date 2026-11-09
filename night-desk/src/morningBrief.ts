import type { JournalEntry, Score, Strategy, Veto } from "./types.js";

export type MorningDecision = "approve" | "reject" | "retest";

export interface ScoredStrategySummary {
  strategy: Strategy;
  score: Score;
  veto?: Veto;
}

export interface MorningBriefData {
  asOf?: string;
  marketSummaryLines?: string[];
  strategies: ScoredStrategySummary[];
  journalEntries: JournalEntry[];
  botStatus?: string;
  decision?: MorningDecision;
}

/**
 * Pure formatter for the 07:30 morning brief.
 * Formats:
 * 1. Market in 5 lines (or explicit [needs-data] status if live Alpaca feed is absent)
 * 2. Top 3 strategies by score out of 25
 * 3. Every veto + why
 * 4. Bot status (always paper-only)
 * 5. One decision: approve | reject | retest
 */
export function formatMorningBrief(data: MorningBriefData): string {
  const headerTime = data.asOf ?? "07:30 Central";
  const lines: string[] = [];

  lines.push(`# Night Desk — 07:30 Morning Brief (${headerTime})`);
  lines.push("Mode: PAPER ONLY | Data Source: Alpaca");
  lines.push("");

  // 1. Market in 5 lines
  lines.push("## 1. Market in 5 Lines (Alpaca)");
  if (data.marketSummaryLines && data.marketSummaryLines.length === 5) {
    for (const line of data.marketSummaryLines) {
      lines.push(`- ${line}`);
    }
  } else {
    lines.push(
      "- [needs-data] { status: \"needs-data\", need: \"Alpaca US equities & sector ETF overnight bars\", source: \"Alpaca\" }"
    );
  }
  lines.push("");

  // 2. Top 3 strategies
  lines.push("## 2. Top 3 Strategies");
  const topThree = [...data.strategies]
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 3);

  if (topThree.length === 0) {
    lines.push("- None evaluated yet ([needs-data] waiting on Alpaca historical bars)");
  } else {
    topThree.forEach((item, idx) => {
      const { strategy, score, veto } = item;
      const estimateTag = strategy.isEstimate ? " [estimate]" : "";
      const gateTag = score.passed ? "PASSED" : "FAILED";
      const vetoTag = veto?.vetoed ? " (VETOED)" : "";
      lines.push(
        `${idx + 1}. ${strategy.ticker} — ${strategy.name}: ${score.total}/25 [${gateTag}${vetoTag}] | ` +
          `OOS Sharpe=${score.metrics.outOfSampleSharpe.toFixed(2)}, ` +
          `DSR=${score.metrics.deflatedSharpe.toFixed(2)}, ` +
          `MaxDD=${(score.metrics.maxDrawdown * 100).toFixed(1)}%, ` +
          `Trades=${score.metrics.tradeCount}, ` +
          `PostCostEdge=${score.metrics.edgeAfterCosts}${estimateTag} (source: ${strategy.source})`
      );
    });
  }
  lines.push("");

  // 3. Every veto + why
  lines.push("## 3. Vetoes & Reasons");
  const vetoLines: string[] = [];
  const seenVetoes = new Set<string>();

  for (const item of data.strategies) {
    if (item.veto?.vetoed) {
      const key = `${item.veto.ticker}:${item.veto.reason}`;
      if (!seenVetoes.has(key)) {
        seenVetoes.add(key);
        vetoLines.push(`- ${item.veto.ticker}: ${item.veto.reason}`);
      }
    }
  }

  for (const entry of data.journalEntries) {
    if (entry.kind === "veto" && entry.payload && typeof entry.payload === "object") {
      const v = entry.payload as Partial<Veto>;
      if (v.vetoed && v.ticker && v.reason) {
        const key = `${v.ticker}:${v.reason}`;
        if (!seenVetoes.has(key)) {
          seenVetoes.add(key);
          vetoLines.push(`- ${v.ticker}: ${v.reason}`);
        }
      }
    }
  }

  if (vetoLines.length === 0) {
    lines.push("- No vetoes recorded in this run.");
  } else {
    lines.push(...vetoLines);
  }
  lines.push("");

  // 4. Bot status
  lines.push("## 4. Bot Status");
  lines.push(
    `- ${data.botStatus ?? "PAPER ONLY — Phase 0 skeleton (needs-data: Alpaca live feed & paper order client not yet connected)"}`
  );
  lines.push("");

  // 5. One decision
  const decision: MorningDecision =
    data.decision ??
    (topThree.some((s) => s.score.passed && !s.veto?.vetoed)
      ? "approve"
      : topThree.length === 0
        ? "retest"
        : "reject");

  lines.push("## 5. Decision");
  lines.push(`Decision: ${decision.toUpperCase()}`);

  return lines.join("\n");
}
