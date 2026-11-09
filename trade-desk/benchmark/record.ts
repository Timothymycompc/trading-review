// Builds every benchmark case against live mainnet and records what Trade Desk's tools read while checking it, into
// benchmark/cases/<id>.json. Run with `npm run benchmark:record` (uses SOLANA_MAINNET_RPC_URL when set, otherwise the
// public RPC). Nothing is signed or sent: every call is a read or a simulation.
import fs from "fs";
import path from "path";
import { clusterApiUrl, Connection } from "@solana/web3.js";
import "dotenv/config";
import { recordingContext } from "../tests/helpers/replay";
import { CASES } from "./cases";
import { CASES_DIR, outcomeOf, runPulse, type RecordedCase } from "./score";

const RPC = process.env.SOLANA_MAINNET_RPC_URL || clusterApiUrl("mainnet-beta");

// Name cases to record only those (`npm run benchmark:record -- 09-expired`); with none, all are recorded.
const only = process.argv.slice(2);
fs.mkdirSync(CASES_DIR, { recursive: true });
for (const def of CASES.filter((c) => !only.length || only.includes(c.id))) {
  const { build, ...publicFields } = def;
  const built = await build(new Connection(RPC, "confirmed"));
  const recordings: RecordedCase["recordings"] = {};
  const verdict = await runPulse(built, (tool) => {
    const { ctx, recording } = recordingContext(RPC);
    recordings[tool] = recording;
    return ctx;
  });
  const recorded: RecordedCase = { ...publicFields, ...built, recordedAt: new Date().toISOString(), recordings };
  fs.writeFileSync(path.join(CASES_DIR, `${def.id}.json`), JSON.stringify(recorded, null, 1) + "\n");
  console.log(`${def.id}: ${outcomeOf(def, verdict)} (${verdict.notes.join(", ")}; signals: ${verdict.signals.join(", ") || "none"})`);
  await new Promise((r) => setTimeout(r, 1500)); // stay under the public RPC's rate limit
}
