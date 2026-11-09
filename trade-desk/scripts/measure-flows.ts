// Runs every tool's live mainnet example once and writes down what it asked the chain and outside services,
// so the Flows page shows measured lookups, not a list typed by hand. Reads only; nothing is signed or sent.
// Needs SOLANA_MAINNET_RPC_URL (and JUPITER_API_KEY for the Jupiter tools) in the environment.
//   npm run measure-flows
import fs from "fs";
import { z } from "zod";
import { TOOLS } from "../server/tools";
import { makeToolContext } from "../server/context";
import { withTrail } from "../server/trail";
import { groupTrail } from "../src/lib/flow";

const OUT = "src/data/tool-flows.json";

async function main() {
  const ctx = makeToolContext();
  const tools: Record<string, unknown> = {};
  for (const tool of TOOLS) {
    let args: Record<string, unknown> = {};
    try {
      args = await tool.example(ctx);
      const parsed = z.object(tool.inputs).parse(args);
      const started = performance.now();
      const { steps } = await withTrail(() => tool.run(parsed, ctx));
      const lookups = groupTrail(steps).map(({ to, what, count, failed }) => ({ to, what, count, failed }));
      tools[tool.name] = { ok: true, ms: Math.round(performance.now() - started), lookups, calls: steps.length };
      console.log(`${tool.name.padEnd(14)} ${steps.length} lookups`);
    } catch (error: any) {
      tools[tool.name] = { ok: false, error: String(error?.message ?? error).slice(0, 200) };
      console.log(`${tool.name.padEnd(14)} FAILED ${String(error?.message ?? error).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  fs.mkdirSync("src/data", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString(), how: "Each tool's live mainnet example, run once by scripts/measure-flows.ts", tools }, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}

void main();
