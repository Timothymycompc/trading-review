import fs from "node:fs";
import path from "node:path";
import type { JournalEntry, JournalKind } from "./types.js";

export const DEFAULT_JOURNAL_PATH = path.resolve("research/journal.jsonl");

/**
 * Appends a single immutable entry to the JSONL research journal.
 */
export function logEntry<TPayload>(
  kind: JournalKind,
  payload: TPayload,
  filePath: string = DEFAULT_JOURNAL_PATH
): JournalEntry<TPayload> {
  const entry: JournalEntry<TPayload> = {
    timestamp: new Date().toISOString(),
    kind,
    payload
  };

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

/**
 * Reads all entries from the append-only JSONL journal in chronological order.
 */
export function readJournal(filePath: string = DEFAULT_JOURNAL_PATH): JournalEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as JournalEntry);
}
