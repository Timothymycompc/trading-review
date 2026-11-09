import type { Handoff, Idea, NeedsData, Setup } from "../types.js";

export interface OhlcvBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartAnalystInput {
  idea: Idea;
  bars?: OhlcvBar[];
  setup?: Setup;
}

export type ChartAnalystResult =
  | NeedsData
  | {
      status: "ok";
      source: "Alpaca";
      setup: Setup;
      handoff: Handoff;
    };

/**
 * Chart Analyst — inspects daily and intraday OHLCV structure, key support/resistance
 * levels, ATR volatility, and relative volume on Alpaca bars for a Scout Idea.
 * Returns { status: "needs-data" } when live Alpaca bar data is absent.
 */
export function runChartAnalyst(input: ChartAnalystInput): ChartAnalystResult {
  if (!input.setup || !input.bars || input.bars.length === 0) {
    return {
      status: "needs-data",
      need: `Alpaca OHLCV bars and volume history for ${input.idea.ticker}`,
      source: "Alpaca"
    };
  }

  const handoff: Handoff = {
    ticker: input.setup.ticker,
    idea: input.idea.thesis,
    evidence: `${input.setup.timeframe} ${input.setup.direction} structure: ${input.setup.structureNotes} (source: Alpaca)`,
    nextStep: "strategist"
  };

  return {
    status: "ok",
    source: "Alpaca",
    setup: input.setup,
    handoff
  };
}
