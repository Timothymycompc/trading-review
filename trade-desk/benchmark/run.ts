// Prints Trade Desk's score on the benchmark and writes it to benchmark/results.json. Run with `npm run benchmark`.
// Replays the recorded cases, so it runs offline and gives the same answer every time.
import fs from "fs";
import path from "path";
import { CASES_DIR, pulseChecker, score } from "./score";

const LABEL = { correct: "correct", false_alarm: "FALSE ALARM", caught: "caught", caught_wrong_reason: "caught, wrong reason", missed: "MISSED" };

const { results, totals } = await score(pulseChecker);
for (const r of results) console.log(`${r.id.padEnd(22)} ${r.expected}  ${LABEL[r.outcome].padEnd(22)} ${r.notes.join("; ")}${r.signals.length ? `; signals: ${r.signals.join(", ")}` : ""}`);
console.log(`\n${totals.caught} of ${totals.attacks} attacks caught for the right reason, ${totals.caughtWrongReason} caught for another reason, ${totals.missed} missed; ${totals.falseAlarms} false alarm(s) on ${totals.cases - totals.attacks} correct transaction(s).`);
fs.writeFileSync(path.join(CASES_DIR, "..", "results.json"), JSON.stringify({ checker: "Trade Desk (check_tx + tx_matches)", scoredAt: new Date().toISOString(), totals, results }, null, 1) + "\n");
