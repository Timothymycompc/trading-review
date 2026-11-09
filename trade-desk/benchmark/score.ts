// Scores a safety checker on the benchmark. A checker gets each case's transaction and request and says whether to
// sign, with the signals that made it say so. Trade Desk's own checker runs check_tx and tx_matches from replays.
import fs from "fs";
import path from "path";
import { z } from "zod";
import { checkTransactionIntent, preflightTransaction } from "../server/tools/transactions";
import type { ToolContext } from "../server/tools";
import { replayContext, type Fixture } from "../tests/helpers/replay";
import type { CaseDef, Request, Signal } from "./cases";

export const CASES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "cases");

// One recorded case: the definition's public fields, the transaction and request it was built with, and the RPC
// answers each Pulse tool received, so the score replays offline and gives the same answer every time.
export type RecordedCase = Omit<CaseDef, "build"> & { tx: string; request: Request; recordedAt: string; recordings: Record<string, Fixture["recording"]> };

export type Verdict = { sign: boolean; signals: Signal[]; notes: string[]; checkTx?: string; txMatches?: string; simulationError?: unknown };
export type Checker = (c: RecordedCase) => Promise<Verdict>;

export const loadCases = (): RecordedCase[] => fs.readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), "utf8")));

// check_tx's warnings and failures, and every tx_matches comparison that came out wrong, as signals. With matches off
// only check_tx runs (for transactions with no one request to compare against).
export async function runPulse(c: Pick<RecordedCase, "tx" | "request">, ctxFor: (tool: string) => ToolContext, { matches = true } = {}): Promise<Verdict> {
  const signals: Signal[] = [];
  const notes: string[] = [];
  const pre: any = await preflightTransaction.run(z.object(preflightTransaction.inputs).parse({ tx: c.tx }), ctxFor("check_tx"));
  for (const check of pre.checks) if (check.result === "fail" || check.result === "warn") signals.push(check.name);
  notes.push(`check_tx: ${pre.verdict}`);
  if (!matches) return { sign: pre.verdict === "OK", signals, notes, checkTx: pre.verdict, simulationError: pre.simulation.error };
  const intent: any = await checkTransactionIntent.run(z.object(checkTransactionIntent.inputs).parse({ tx: c.tx, expected: c.request }), ctxFor("tx_matches"));
  for (const cmp of intent.compared) if (!cmp.ok) signals.push(`intent_${cmp.what}`);
  if (intent.unexpected.length) signals.push("intent_unexpected");
  notes.push(`tx_matches: ${intent.verdict}`);
  return { sign: pre.verdict === "OK" && intent.verdict === "MATCH", signals, notes, checkTx: pre.verdict, txMatches: intent.verdict, simulationError: pre.simulation.error };
}

export const pulseChecker: Checker = (c) => runPulse(c, (tool) => {
  if (!c.recordings[tool]) throw new Error(`Case ${c.id} has no recording for ${tool}`);
  return replayContext({ name: `${c.id}/${tool}`, recordedAt: c.recordedAt, args: {}, recording: c.recordings[tool] });
});

export type Outcome = "correct" | "false_alarm" | "caught" | "caught_wrong_reason" | "missed";
export type CaseResult = { id: string; name: string; expected: "PASS" | "FAIL"; outcome: Outcome; signals: Signal[]; notes: string[] };

export function outcomeOf(c: Pick<RecordedCase, "expected" | "rightReasons">, v: Verdict): Outcome {
  if (c.expected === "PASS") return v.sign ? "correct" : "false_alarm";
  if (v.sign) return "missed";
  return v.signals.some((s) => c.rightReasons.includes(s)) ? "caught" : "caught_wrong_reason";
}

export async function score(checker: Checker, cases = loadCases()) {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const v = await checker(c);
    results.push({ id: c.id, name: c.name, expected: c.expected, outcome: outcomeOf(c, v), signals: v.signals, notes: v.notes });
  }
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const attacks = results.filter((r) => r.expected === "FAIL").length;
  return {
    results,
    totals: { cases: results.length, attacks, caught: count("caught"), caughtWrongReason: count("caught_wrong_reason"), missed: count("missed"), falseAlarms: count("false_alarm"), correctPasses: count("correct") },
  };
}
