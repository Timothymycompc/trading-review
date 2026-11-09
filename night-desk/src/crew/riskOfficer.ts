import { validateDeskRules } from "../deskRules.js";
import type { DeskRules, EventWindow, EventWindowKind, Veto } from "../types.js";

export interface RiskCheckPlan {
  ticker: string;
  riskUsd?: number;
  riskPct?: number;
  paperCapitalUsd?: number;
  plannedEntryTime?: string;
  upcomingEvents?: EventWindow[];
  activeEventWindow?: EventWindowKind | null;
  inEarningsWindow?: boolean;
  inFedWindow?: boolean;
  inCpiWindow?: boolean;
  rules?: DeskRules;
}

function isWithinEventWindow(plannedEntryTime: string | undefined, event: EventWindow): boolean {
  if (!plannedEntryTime) {
    return true;
  }
  const entryMs = Date.parse(plannedEntryTime);
  const startMs = Date.parse(event.startsAt);
  const endMs = Date.parse(event.endsAt);
  if (Number.isNaN(entryMs) || Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return true;
  }
  return entryMs >= startMs && entryMs <= endMs;
}

/**
 * Risk Officer — enforces hard veto gates from DeskRules before any strategy can reach the paper Trader:
 * 1. Never-trade ticker list (case-insensitive match).
 * 2. Maximum risk per trade (both percentage of paper capital and USD limit).
 * 3. No entry into earnings, Fed (FOMC), or CPI release blackout windows.
 */
export function veto(plan: RiskCheckPlan, explicitRules?: DeskRules): Veto {
  const rules = explicitRules ?? plan.rules ?? validateDeskRules();
  const normalizedTicker = plan.ticker.trim().toUpperCase();
  const reasons: string[] = [];

  if (!normalizedTicker) {
    reasons.push("Missing ticker symbol");
  }

  // 1. Never-trade list check
  const neverTradeSet = new Set(rules.neverTrade.map((t) => t.trim().toUpperCase()));
  if (normalizedTicker && neverTradeSet.has(normalizedTicker)) {
    reasons.push(`Ticker ${normalizedTicker} is on the DeskRules never-trade list`);
  }

  // 2. Max risk per trade check
  const capital = plan.paperCapitalUsd ?? rules.paperCapitalUsd;
  const maxRiskFraction =
    rules.maxRiskPerTradePct > 1 ? rules.maxRiskPerTradePct / 100 : rules.maxRiskPerTradePct;
  const maxRiskUsd = capital * maxRiskFraction;

  if (plan.riskUsd !== undefined) {
    if (!Number.isFinite(plan.riskUsd) || plan.riskUsd <= 0) {
      reasons.push(`Invalid riskUsd (${plan.riskUsd}); risk must be a positive finite amount`);
    } else if (plan.riskUsd > maxRiskUsd) {
      reasons.push(
        `Trade risk $${plan.riskUsd.toFixed(2)} exceeds max risk per trade $${maxRiskUsd.toFixed(2)} (${(
          maxRiskFraction * 100
        ).toFixed(2)}% of $${capital.toFixed(0)})`
      );
    }
  }

  if (plan.riskPct !== undefined) {
    const planRiskFraction = plan.riskPct > 1 ? plan.riskPct / 100 : plan.riskPct;
    if (!Number.isFinite(planRiskFraction) || planRiskFraction <= 0) {
      reasons.push(`Invalid riskPct (${plan.riskPct}); risk percentage must be positive`);
    } else if (planRiskFraction > maxRiskFraction) {
      reasons.push(
        `Trade risk ${(planRiskFraction * 100).toFixed(2)}% exceeds DeskRules limit of ${(
          maxRiskFraction * 100
        ).toFixed(2)}%`
      );
    }
  }

  // 3. Macro and corporate blackout windows (earnings, Fed/FOMC, CPI)
  if (plan.inEarningsWindow || plan.activeEventWindow === "earnings") {
    reasons.push(`Entry blocked: ${normalizedTicker} is inside an earnings blackout window`);
  }
  if (plan.inFedWindow || plan.activeEventWindow === "fed") {
    reasons.push("Entry blocked: market is inside a Fed (FOMC) blackout window");
  }
  if (plan.inCpiWindow || plan.activeEventWindow === "cpi") {
    reasons.push("Entry blocked: market is inside a CPI release blackout window");
  }

  if (plan.upcomingEvents && plan.upcomingEvents.length > 0) {
    for (const event of plan.upcomingEvents) {
      const tickerApplies =
        !event.ticker || event.ticker.trim().toUpperCase() === normalizedTicker;
      if (!tickerApplies) {
        continue;
      }
      if (isWithinEventWindow(plan.plannedEntryTime, event)) {
        const label =
          event.kind === "earnings"
            ? `${normalizedTicker} earnings`
            : event.kind === "fed"
              ? "Fed (FOMC)"
              : "CPI release";
        reasons.push(
          `Entry blocked: planned entry falls inside ${label} window (${event.startsAt} to ${event.endsAt})`
        );
      }
    }
  }

  const vetoed = reasons.length > 0;
  return {
    vetoed,
    ticker: normalizedTicker,
    reason: vetoed ? reasons.join("; ") : "Approved by Risk Officer",
    reasons,
    checkedAt: new Date().toISOString()
  };
}

export const riskOfficer = {
  veto
};
