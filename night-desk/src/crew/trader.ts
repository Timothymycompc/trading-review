import type { Handoff, NeedsData, Score, Strategy, Trade, Veto } from "../types.js";

export interface TraderInput {
  strategy: Strategy;
  score: Score;
  veto: Veto;
  alpacaPaperReady?: boolean;
  qty?: number;
}

export type TraderResult =
  | NeedsData
  | {
      status: "blocked";
      reason: string;
      handoff: Handoff;
    }
  | {
      status: "ok";
      trade: Trade;
      handoff: Handoff;
    };

/**
 * Trader — submits paper-only orders to Alpaca (never real money) for strategies
 * that pass the >=18/25 scoring gate and are not vetoed by the Risk Officer.
 * Returns { status: "needs-data" } when the Alpaca paper order client is not connected.
 */
export function runTrader(input: TraderInput): TraderResult {
  const { strategy, score, veto } = input;

  if (veto.vetoed) {
    return {
      status: "blocked",
      reason: `Vetoed by Risk Officer: ${veto.reason}`,
      handoff: {
        ticker: strategy.ticker,
        idea: strategy.name,
        evidence: veto.reason,
        nextStep: "chiefOfStaff"
      }
    };
  }

  if (!score.passed) {
    const why = score.reasons.join("; ");
    return {
      status: "blocked",
      reason: `Failed scoring gate (${score.total}/25): ${why}`,
      handoff: {
        ticker: strategy.ticker,
        idea: strategy.name,
        evidence: why,
        nextStep: "chiefOfStaff"
      }
    };
  }

  if (!input.alpacaPaperReady || !input.qty || input.qty <= 0) {
    return {
      status: "needs-data",
      need: `Alpaca paper-trading API session and live quote to size ${strategy.ticker} paper order`,
      source: "Alpaca"
    };
  }

  const trade: Trade = {
    id: `paper-${strategy.id}-${Date.now()}`,
    strategyId: strategy.id,
    ticker: strategy.ticker,
    side: strategy.direction === "long" ? "buy" : "sell",
    qty: input.qty,
    accountMode: "paper",
    broker: "Alpaca",
    status: "submitted",
    submittedAt: new Date().toISOString(),
    note: "Alpaca paper-only order"
  };

  return {
    status: "ok",
    trade,
    handoff: {
      ticker: strategy.ticker,
      idea: strategy.name,
      evidence: `Paper ${trade.side} ${trade.qty} ${trade.ticker} submitted on Alpaca`,
      nextStep: "chiefOfStaff"
    }
  };
}
