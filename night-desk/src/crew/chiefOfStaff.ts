import { ensureDeskRules, type DeskRulesInput, type IntakeQuestion } from "../deskRules.js";
import { formatMorningBrief, type MorningBriefData, type MorningDecision } from "../morningBrief.js";
import type { DeskRules } from "../types.js";

export interface ChiefOfStaffInput {
  rulesInput?: DeskRulesInput;
  rulesPath?: string;
  briefData: Omit<MorningBriefData, "decision"> & { decision?: MorningDecision };
}

export interface ChiefOfStaffResult {
  rules: DeskRules;
  questionsAsked: readonly IntakeQuestion[];
  decision: MorningDecision;
  morningBrief: string;
}

/**
 * Chief of Staff — coordinates the overnight desk, ensures DeskRules are loaded
 * without re-asking saved intake questions, and is the ONLY agent that produces
 * the 07:30 morning brief and final recommendation (approve / reject / retest).
 */
export function runChiefOfStaff(input: ChiefOfStaffInput): ChiefOfStaffResult {
  const { rules, questionsAsked } = ensureDeskRules(input.rulesInput, input.rulesPath);

  const hasPassingUnvetoed = input.briefData.strategies.some(
    (s) => s.score.passed && !s.veto?.vetoed
  );
  const needsMoreData =
    !input.briefData.marketSummaryLines || input.briefData.marketSummaryLines.length === 0;

  const decision: MorningDecision =
    input.briefData.decision ??
    (hasPassingUnvetoed ? "approve" : needsMoreData ? "retest" : "reject");

  const morningBrief = formatMorningBrief({
    ...input.briefData,
    decision
  });

  return {
    rules,
    questionsAsked,
    decision,
    morningBrief
  };
}
