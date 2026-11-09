// The collection-wallet rule, measured on live mainnet (read-only): Tim's 2026-10-29 cash-out investigation, where trace
// called 5 exchange deposit addresses and 2 trading-bot wallets "high confidence, seed leaked", plus the two real drains
// trace was built on, which must stay high. Writes benchmark/trace-cashout-results.txt.
//   SOLANA_MAINNET_RPC_URL=... npx tsx benchmark/trace-cashout.ts
import fs from "fs";
import { z } from "zod";
import { traceWallet } from "../server/tools/trace";
import { makeToolContext } from "../server/context";

const CASES: { wallet: string; what: string; should: "high" | "not high" }[] = [
  { wallet: "Gjr8SBkXhEosYyZAqimWt5QLzmFcgECNsRNjQdWreTfi", what: "exchange deposit address, swept to B48k…KAAn", should: "not high" },
  { wallet: "Hf48rJXEfNp2QwF7rGdf5op6V1LHxvkPQXVjSHwjTYeh", what: "exchange deposit address, swept to B48k…KAAn", should: "not high" },
  { wallet: "BX4ixZYMg83GZ5b38yyt417YGB6LgXi4SKvpLeoAntd", what: "exchange deposit address, swept to B48k…KAAn", should: "not high" },
  { wallet: "FzZyRXS5qzJZECtcocEMyUFXEp2vyiEmyia9Zy8GPtPC", what: "exchange deposit address, swept to B48k…KAAn", should: "not high" },
  { wallet: "JCukfz8NAKHAe3X5YbPjmJW2pX66qGs1uh9yHKsGpeZr", what: "exchange deposit address, swept to B48k…KAAn", should: "not high" },
  { wallet: "FrJWSZnZ3zD8uZJD2aPASSzrGmx9YNBbgHYc5oFf6Eyc", what: "trading-bot wallet", should: "not high" },
  { wallet: "Hvyu1CysiCF2uFwmGsYbGBBFn7TdJ514F4e3Ue4a59ix", what: "trading-bot wallet", should: "not high" },
  { wallet: "AvLELvhjDEs9jG54EV3PQ8QGptYyWceEduGQb1gDpmAj", what: "REAL drain (Kunal), to a bridge", should: "high" },
  { wallet: "Hkxcf2Jz6jMi5oVmYXJFUCqqwGzagfkv3q3jBLTvsEnp", what: "REAL drain (Adilak), to the thief's wallet", should: "high" },
];

async function main() {
  const ctx = makeToolContext();
  const lines = [`trace collection-wallet rule, live mainnet, ${new Date().toISOString()}`, ""];
  let right = 0;
  for (const c of CASES) {
    const out: any = await traceWallet.run(z.object(traceWallet.inputs).parse({ wallet: c.wallet, how_many: 25 }), ctx);
    const level = out.report.confidence.level;
    const ok = c.should === "high" ? level === "high" : level !== "high";
    if (ok) right++;
    lines.push(`${ok ? "RIGHT" : "WRONG"}  ${c.wallet.slice(0, 6)}  ${c.what}: confidence ${level} (should be ${c.should}); flags ${out.flags.map((f: any) => f.name).join(", ") || "none"}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  lines.push("", `${right} of ${CASES.length} right.`);
  fs.writeFileSync("benchmark/trace-cashout-results.txt", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

void main();
