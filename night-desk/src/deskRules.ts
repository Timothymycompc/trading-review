import fs from "node:fs";
import path from "node:path";
import type { DeskRules } from "./types.js";

export const DEFAULT_DESK_RULES_PATH = path.resolve("research/desk-rules.json");

export const DEFAULT_MARKETS = [
  "US equities",
  "US sector ETFs (SPY, QQQ, XLK, XLF, XLE)"
];

export interface IntakeQuestion {
  id: "markets" | "paperCapitalAndRisk" | "holdingPeriod" | "neverTrade";
  prompt: string;
  defaultValue: string;
}

/**
 * The 4 intake questions asked once before the desk runs.
 * Once saved to research/desk-rules.json, no question is re-asked.
 */
export const INTAKE_QUESTIONS: readonly IntakeQuestion[] = [
  {
    id: "markets",
    prompt: "Which markets should Night Desk scan? (Locked to US equities + major sector ETFs on Alpaca)",
    defaultValue: DEFAULT_MARKETS.join(", ")
  },
  {
    id: "paperCapitalAndRisk",
    prompt: "What is the Alpaca paper account capital (USD) and max risk per trade (%)?",
    defaultValue: "$100,000 paper capital, 1% (0.01) max risk per trade"
  },
  {
    id: "holdingPeriod",
    prompt: "What holding period should strategies target (intraday, overnight, multi-day swing)?",
    defaultValue: "swing (1-5 trading days)"
  },
  {
    id: "neverTrade",
    prompt: "Which tickers or instruments must Night Desk never trade?",
    defaultValue: "leveraged ETFs, penny stocks (<$5), options, crypto, memecoins"
  }
] as const;

export interface DeskRulesInput {
  markets?: string[];
  paperCapitalUsd?: number;
  maxRiskPerTradePct?: number;
  holdingPeriod?: string;
  neverTrade?: string[];
}

export function normalizeRiskFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("maxRiskPerTradePct must be a positive number");
  }
  const fraction = value > 0.25 ? value / 100 : value;
  if (fraction <= 0 || fraction > 0.25) {
    throw new Error("maxRiskPerTradePct must not exceed 25% (0.25) of paper capital");
  }
  return fraction;
}

export function validateDeskRules(input: DeskRulesInput = {}): DeskRules {
  const markets =
    input.markets && input.markets.length > 0
      ? input.markets.map((m) => m.trim()).filter(Boolean)
      : [...DEFAULT_MARKETS];

  if (markets.length === 0) {
    throw new Error("DeskRules requires at least one market");
  }

  const paperCapitalUsd = input.paperCapitalUsd ?? 100_000;
  if (!Number.isFinite(paperCapitalUsd) || paperCapitalUsd <= 0) {
    throw new Error("paperCapitalUsd must be a positive finite number");
  }

  const maxRiskPerTradePct = normalizeRiskFraction(input.maxRiskPerTradePct ?? 0.01);

  const holdingPeriod = (input.holdingPeriod ?? "swing (1-5 trading days)").trim();
  if (!holdingPeriod) {
    throw new Error("holdingPeriod must not be empty");
  }

  const neverTrade = Array.from(
    new Set(
      (input.neverTrade ?? [])
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  return {
    markets,
    paperCapitalUsd,
    maxRiskPerTradePct,
    holdingPeriod,
    neverTrade,
    paperOnly: true,
    dataSource: "Alpaca",
    savedAt: new Date().toISOString()
  };
}

export function loadDeskRules(filePath: string = DEFAULT_DESK_RULES_PATH): DeskRules | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as DeskRulesInput & { savedAt?: string };
  const validated = validateDeskRules(parsed);
  return {
    ...validated,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : validated.savedAt
  };
}

export function saveDeskRules(
  rules: DeskRules,
  filePath: string = DEFAULT_DESK_RULES_PATH
): DeskRules {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(rules, null, 2) + "\n", "utf8");
  return rules;
}

/**
 * Loads existing DeskRules without re-asking intake questions if already saved.
 * Otherwise validates and saves the provided intake answers.
 */
export function ensureDeskRules(
  input: DeskRulesInput = {},
  filePath: string = DEFAULT_DESK_RULES_PATH
): { rules: DeskRules; questionsAsked: readonly IntakeQuestion[] } {
  const existing = loadDeskRules(filePath);
  if (existing) {
    return { rules: existing, questionsAsked: [] };
  }
  const rules = validateDeskRules(input);
  saveDeskRules(rules, filePath);
  return { rules, questionsAsked: INTAKE_QUESTIONS };
}
