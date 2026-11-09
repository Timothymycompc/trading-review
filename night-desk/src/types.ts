export type DataSource = "Alpaca";

export interface NeedsData<TNeed extends string = string> {
  status: "needs-data";
  need: TNeed;
  source: DataSource;
}

export interface DeskRules {
  markets: string[];
  paperCapitalUsd: number;
  maxRiskPerTradePct: number;
  holdingPeriod: string;
  neverTrade: string[];
  paperOnly: true;
  dataSource: DataSource;
  savedAt: string;
}

export type SignalCategory =
  | "earnings-drift"
  | "post-news-momentum"
  | "mean-reversion"
  | "volume-breakout"
  | "sector-rotation";

export interface Idea {
  id: string;
  ticker: string;
  signal: SignalCategory;
  thesis: string;
  catalyst: string;
  source: DataSource;
  createdAt: string;
}

export interface Setup {
  ideaId: string;
  ticker: string;
  timeframe: "1D" | "1H" | "15Min";
  direction: "long" | "short";
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  atr?: number;
  volumeRatio?: number;
  structureNotes: string;
  source: DataSource;
}

export type EventWindowKind = "earnings" | "fed" | "cpi";

export interface EventWindow {
  kind: EventWindowKind;
  ticker?: string;
  startsAt: string;
  endsAt: string;
  description?: string;
}

export interface Strategy {
  id: string;
  name: string;
  ticker: string;
  direction: "long" | "short";
  holdingPeriod: string;
  entryRule: string;
  exitRule: string;
  stopRule: string;
  riskUsd?: number;
  riskPct?: number;
  plannedEntryTime?: string;
  upcomingEvents?: EventWindow[];
  outOfSampleReturns?: number[];
  equityCurve?: number[];
  nTrials?: number;
  tradeCount?: number;
  edgeAfterCosts?: number;
  pineScript?: string;
  isEstimate: boolean;
  source: DataSource;
}

export interface ScoreBreakdown {
  outOfSampleSharpe: number;
  deflatedSharpe: number;
  maxDrawdown: number;
  tradeCount: number;
  edgeAfterCosts: number;
}

export interface Score {
  metrics: {
    outOfSampleSharpe: number;
    deflatedSharpe: number;
    maxDrawdown: number;
    tradeCount: number;
    edgeAfterCosts: number;
  };
  scores: ScoreBreakdown;
  total: number;
  passed: boolean;
  reasons: string[];
}

export interface Veto {
  vetoed: boolean;
  ticker: string;
  reason: string;
  reasons: string[];
  checkedAt: string;
}

export interface Trade {
  id: string;
  strategyId: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  accountMode: "paper";
  broker: DataSource;
  status: "needs-data" | "submitted" | "vetoed";
  submittedAt: string;
  note?: string;
}

export interface Handoff {
  ticker: string;
  idea: string;
  evidence: string;
  nextStep: string;
}

export type JournalKind = "idea" | "veto" | "trade" | "note" | "handoff";

export interface JournalEntry<TPayload = unknown> {
  timestamp: string;
  kind: JournalKind;
  payload: TPayload;
}
