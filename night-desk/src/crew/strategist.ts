import type { Handoff, NeedsData, Setup, Strategy } from "../types.js";

export interface StrategistInput {
  setup: Setup;
  strategy?: Strategy;
}

export type StrategistResult =
  | NeedsData
  | {
      status: "ok";
      source: "Alpaca";
      strategy: Strategy;
      handoff: Handoff;
    };

/**
 * Generates an optional Pine Script v5 study so a human can visually inspect
 * the strategy's entry and stop rules in TradingView. TradingView is never used as a data API.
 */
export function buildPineScriptStub(
  strategy: Pick<Strategy, "name" | "ticker" | "entryRule" | "exitRule" | "stopRule">
): string {
  return [
    "//@version=5",
    `indicator("Night Desk: ${strategy.name} (${strategy.ticker})", overlay=true)`,
    `// Entry rule: ${strategy.entryRule}`,
    `// Stop rule:  ${strategy.stopRule}`,
    `// Exit rule:  ${strategy.exitRule}`,
    "plot(ta.sma(close, 20), title=\"20 SMA\", color=color.new(color.blue, 0))"
  ].join("\n");
}

/**
 * Strategist — turns a Chart Analyst Setup into explicit, falsifiable entry/stop/exit
 * rules evaluated on out-of-sample Alpaca history with realistic transaction costs.
 * Never invents backtest returns; returns { status: "needs-data" } until history is supplied.
 */
export function runStrategist(input: StrategistInput): StrategistResult {
  const s = input.strategy;
  if (
    !s ||
    !s.outOfSampleReturns ||
    s.outOfSampleReturns.length === 0 ||
    !s.equityCurve ||
    s.equityCurve.length === 0 ||
    s.edgeAfterCosts === undefined ||
    s.tradeCount === undefined
  ) {
    return {
      status: "needs-data",
      need: `Alpaca out-of-sample historical bars and cost-adjusted backtest series for ${input.setup.ticker}`,
      source: "Alpaca"
    };
  }

  const strategyWithPine: Strategy = {
    ...s,
    pineScript: s.pineScript ?? buildPineScriptStub(s)
  };

  const handoff: Handoff = {
    ticker: strategyWithPine.ticker,
    idea: `${strategyWithPine.name} (${strategyWithPine.direction})`,
    evidence: `OOS trades=${strategyWithPine.tradeCount}, post-cost edge=${strategyWithPine.edgeAfterCosts} (estimate=${strategyWithPine.isEstimate}, source: Alpaca)`,
    nextStep: "scoring"
  };

  return {
    status: "ok",
    source: "Alpaca",
    strategy: strategyWithPine,
    handoff
  };
}
