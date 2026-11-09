// npm run everyday:record records a new sample from live mainnet (needs SOLANA_MAINNET_RPC_URL); npm run everyday
// replays the recorded one and writes benchmark/everyday-results.json.
import fs from "fs";
import "dotenv/config";
import { record, RESULTS, scoreEveryday } from "./everyday";

if (process.argv.includes("record")) {
  if (!process.env.SOLANA_MAINNET_RPC_URL) throw new Error("Set SOLANA_MAINNET_RPC_URL: the public RPC won't serve this many blocks.");
  await record(process.env.SOLANA_MAINNET_RPC_URL);
}
const { byGroup, rows, notReplayed } = await scoreEveryday();
fs.writeFileSync(RESULTS, JSON.stringify({ byGroup, rows, notReplayed }, null, 1) + "\n");
console.log(JSON.stringify(byGroup, null, 1));
