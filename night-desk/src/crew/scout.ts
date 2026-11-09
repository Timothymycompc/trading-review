import type { DeskRules, Handoff, Idea, NeedsData } from "../types.js";

export interface ScoutInput {
  rules: DeskRules;
  ideas?: Idea[];
}

export type ScoutResult =
  | NeedsData<"Alpaca US equities snapshots, volume bars, and earnings/news feed">
  | {
      status: "ok";
      source: "Alpaca";
      ideas: Idea[];
      handoffs: Handoff[];
    };

/**
 * Scout — scans liquid US equities and major sector ETFs (SPY, QQQ, XLK, XLF, XLE, etc.)
 * using Alpaca market data for earnings drift, post-news momentum, mean reversion,
 * breakouts on expanded volume, and sector rotation. Never fabricates tickers or prices.
 */
export function runScout(input: ScoutInput): ScoutResult {
  if (!input.ideas || input.ideas.length === 0) {
    return {
      status: "needs-data",
      need: "Alpaca US equities snapshots, volume bars, and earnings/news feed",
      source: "Alpaca"
    };
  }

  const handoffs: Handoff[] = input.ideas.map((idea) => ({
    ticker: idea.ticker,
    idea: `${idea.signal}: ${idea.thesis}`,
    evidence: `${idea.catalyst} (source: ${idea.source})`,
    nextStep: "chartAnalyst"
  }));

  return {
    status: "ok",
    source: "Alpaca",
    ideas: input.ideas,
    handoffs
  };
}
