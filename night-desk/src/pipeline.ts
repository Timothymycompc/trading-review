import { runChartAnalyst, type OhlcvBar } from "./crew/chartAnalyst.js";
import { runChiefOfStaff } from "./crew/chiefOfStaff.js";
import { veto as runRiskOfficerVeto } from "./crew/riskOfficer.js";
import { runScout } from "./crew/scout.js";
import { runStrategist } from "./crew/strategist.js";
import { runTrader } from "./crew/trader.js";
import { ensureDeskRules, type DeskRulesInput } from "./deskRules.js";
import { DEFAULT_JOURNAL_PATH, logEntry, readJournal } from "./journal.js";
import type { ScoredStrategySummary } from "./morningBrief.js";
import { deflatedSharpe, maxDrawdown, scoreStrategy, sharpe } from "./scoring.js";
import type { Handoff, Idea, Setup, Strategy, Trade } from "./types.js";

export interface CandidateBundle {
  idea: Idea;
  bars?: OhlcvBar[];
  setup?: Setup;
  strategy?: Strategy;
  skew?: number;
  kurtosis?: number;
  qty?: number;
}

export interface PipelineOptions {
  rulesInput?: DeskRulesInput;
  rulesPath?: string;
  journalPath?: string;
  candidates?: CandidateBundle[];
  marketSummaryLines?: string[];
  alpacaPaperReady?: boolean;
}

export interface PipelineRunResult {
  status: "ok" | "needs-data";
  handoffs: Handoff[];
  evaluatedStrategies: ScoredStrategySummary[];
  trades: Trade[];
  morningBrief: string;
  decision: "approve" | "reject" | "retest";
}

function recordHandoff(handoff: Handoff, journalPath: string, list: Handoff[]): void {
  list.push(handoff);
  logEntry("handoff", handoff, journalPath);
}

/**
 * Wires the Night Desk crew in strict order:
 * scout -> chartAnalyst -> strategist -> scoring -> riskOfficer -> trader -> chiefOfStaff.
 * Every stage transition logs a Handoff object to the journal, and only the Chief of Staff
 * produces the 07:30 morning brief.
 */
export function runPipeline(options: PipelineOptions = {}): PipelineRunResult {
  const journalPath = options.journalPath ?? DEFAULT_JOURNAL_PATH;
  const { rules } = ensureDeskRules(options.rulesInput, options.rulesPath);

  const handoffs: Handoff[] = [];
  const evaluatedStrategies: ScoredStrategySummary[] = [];
  const trades: Trade[] = [];

  // Stage 1: Scout
  const ideas = options.candidates?.map((c) => c.idea);
  const scoutRes = runScout({ rules, ideas });

  if (scoutRes.status === "needs-data") {
    logEntry("note", scoutRes, journalPath);
    const chief = runChiefOfStaff({
      rulesInput: options.rulesInput,
      rulesPath: options.rulesPath,
      briefData: {
        marketSummaryLines: options.marketSummaryLines,
        strategies: [],
        journalEntries: readJournal(journalPath),
        botStatus: `needs-data: ${scoutRes.need}`
      }
    });
    return {
      status: "needs-data",
      handoffs,
      evaluatedStrategies,
      trades,
      morningBrief: chief.morningBrief,
      decision: chief.decision
    };
  }

  for (const idea of scoutRes.ideas) {
    logEntry("idea", idea, journalPath);
  }
  for (const h of scoutRes.handoffs) {
    recordHandoff(h, journalPath, handoffs);
  }

  // Stages 2..6 per candidate
  for (const bundle of options.candidates ?? []) {
    // Stage 2: Chart Analyst
    const chartRes = runChartAnalyst({
      idea: bundle.idea,
      bars: bundle.bars,
      setup: bundle.setup
    });
    if (chartRes.status === "needs-data") {
      logEntry("note", chartRes, journalPath);
      continue;
    }
    recordHandoff(chartRes.handoff, journalPath, handoffs);

    // Stage 3: Strategist
    const stratRes = runStrategist({
      setup: chartRes.setup,
      strategy: bundle.strategy
    });
    if (stratRes.status === "needs-data") {
      logEntry("note", stratRes, journalPath);
      continue;
    }
    recordHandoff(stratRes.handoff, journalPath, handoffs);

    // Stage 4: Scoring
    const strategy = stratRes.strategy;
    const returns = strategy.outOfSampleReturns ?? [];
    const equity = strategy.equityCurve ?? [];
    const oosSharpe = sharpe(returns);
    const dsr = deflatedSharpe(
      oosSharpe,
      strategy.nTrials ?? 1,
      bundle.skew ?? 0,
      bundle.kurtosis ?? 3,
      returns.length
    );
    const mdd = maxDrawdown(equity);
    const score = scoreStrategy({
      outOfSampleSharpe: oosSharpe,
      deflatedSharpe: dsr,
      maxDrawdown: mdd,
      tradeCount: strategy.tradeCount ?? returns.length,
      edgeAfterCosts: strategy.edgeAfterCosts ?? 0
    });

    recordHandoff(
      {
        ticker: strategy.ticker,
        idea: strategy.name,
        evidence: `Score ${score.total}/25 (passed=${score.passed})`,
        nextStep: "riskOfficer"
      },
      journalPath,
      handoffs
    );

    // Stage 5: Risk Officer
    const vetoDecision = runRiskOfficerVeto(
      {
        ticker: strategy.ticker,
        riskUsd: strategy.riskUsd,
        riskPct: strategy.riskPct,
        plannedEntryTime: strategy.plannedEntryTime,
        upcomingEvents: strategy.upcomingEvents
      },
      rules
    );
    if (vetoDecision.vetoed) {
      logEntry("veto", vetoDecision, journalPath);
    }

    recordHandoff(
      {
        ticker: strategy.ticker,
        idea: strategy.name,
        evidence: vetoDecision.reason,
        nextStep: "trader"
      },
      journalPath,
      handoffs
    );

    evaluatedStrategies.push({
      strategy,
      score,
      veto: vetoDecision
    });

    // Stage 6: Trader
    const traderRes = runTrader({
      strategy,
      score,
      veto: vetoDecision,
      alpacaPaperReady: options.alpacaPaperReady,
      qty: bundle.qty
    });

    if (traderRes.status === "needs-data") {
      logEntry("note", traderRes, journalPath);
    } else if (traderRes.status === "blocked") {
      recordHandoff(traderRes.handoff, journalPath, handoffs);
    } else {
      trades.push(traderRes.trade);
      logEntry("trade", traderRes.trade, journalPath);
      recordHandoff(traderRes.handoff, journalPath, handoffs);
    }
  }

  // Final Stage: Chief of Staff produces the morning brief
  const chief = runChiefOfStaff({
    rulesInput: options.rulesInput,
    rulesPath: options.rulesPath,
    briefData: {
      marketSummaryLines: options.marketSummaryLines,
      strategies: evaluatedStrategies,
      journalEntries: readJournal(journalPath)
    }
  });

  return {
    status: evaluatedStrategies.length > 0 ? "ok" : "needs-data",
    handoffs,
    evaluatedStrategies,
    trades,
    morningBrief: chief.morningBrief,
    decision: chief.decision
  };
}
