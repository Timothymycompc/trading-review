// The first-wallet test (benchmark/first-wallet.json): 628 tokens one real beginner bought, mostly in 2023, with what
// became of each. Two questions:
//   1. Would token_safety have warned on the day of the buy? Only a mint or freeze power, or a Token-2022 extension,
//      can be dated that far back: a power can only be given up, never taken back, and extensions are fixed when the
//      token is made. So if one is there today, it was there then. Everything else (liquidity, holders, insiders, the
//      sell test) changes over time and isn't counted.
//   2. What does token_safety say today, for each outcome? That's hindsight; it shows the verdicts fit what happened.
// npm run first-wallet prints the scorecard; npm run first-wallet:refresh re-runs token_safety on every token with the
// owner key from Secret Manager (the outcomes are fixed: they came from the purchases, which aren't in the file).
import fs from "fs";
import path from "path";

export type Outcome = "lost_most" | "kept_value" | "no_market_today" | "unknown";
export type WalletToken = { mint: string; symbol: string | null; outcome: Outcome; verdict: string; checks: [string, string][] };
const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "first-wallet.json");

// One token per line, so a refresh shows as a readable diff.
export function writeFirstWallet(data: { about?: string; checked_at: string; checked_with: string; tokens: WalletToken[] }) {
  const about = data.about ?? (JSON.parse(fs.readFileSync(FILE, "utf8")) as any).about;
  const head = [`  "about": ${JSON.stringify(about)},`, `  "checked_at": ${JSON.stringify(data.checked_at)},`, `  "checked_with": ${JSON.stringify(data.checked_with)},`];
  fs.writeFileSync(FILE, ["{", ...head, '  "tokens": [', data.tokens.map((t) => "    " + JSON.stringify(t)).join(",\n"), "  ]", "}"].join("\n") + "\n");
}

export const loadFirstWallet = (): { checked_at: string; checked_with: string; tokens: WalletToken[] } => JSON.parse(fs.readFileSync(FILE, "utf8"));

// A warning that was already true on the day of the buy.
export const warnedOnBuyDay = (t: WalletToken) =>
  t.checks.some(([name, result]) => (name === "mint_authority" || name === "freeze_authority" || name.startsWith("extension:")) && (result === "warn" || result === "fail"));

export function scoreFirstWallet(tokens = loadFirstWallet().tokens) {
  const outcomes: Outcome[] = ["no_market_today", "lost_most", "kept_value", "unknown"];
  return Object.fromEntries(outcomes.map((o) => {
    const group = tokens.filter((t) => t.outcome === o);
    const verdicts = { SAFE: 0, CAUTION: 0, AVOID: 0 } as Record<string, number>;
    for (const t of group) verdicts[t.verdict] = (verdicts[t.verdict] ?? 0) + 1;
    return [o, { tokens: group.length, warnedOnBuyDay: group.filter(warnedOnBuyDay).length, verdictToday: verdicts }];
  })) as Record<Outcome, { tokens: number; warnedOnBuyDay: number; verdictToday: Record<string, number> }>;
}

async function refresh(ownerKey: string) {
  const data = loadFirstWallet();
  const url = "https://trade-desk-1021990235790.us-central1.run.app/api/tools/token_safety";
  for (const [i, t] of data.tokens.entries()) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-api-key": ownerKey }, body: JSON.stringify({ token: t.mint }) });
    if (res.ok) {
      const v: any = await res.json();
      t.verdict = v.verdict;
      t.checks = v.checks.map((c: any) => [c.name, c.result]);
    } else console.error(`${t.mint}: HTTP ${res.status}, kept the old answer`);
    // One at a time with a pause: Jupiter's limit is shared with real users.
    await new Promise((ok) => setTimeout(ok, 2500));
    if (i % 50 === 0) console.error(`${i}/${data.tokens.length}`);
  }
  data.checked_at = new Date().toISOString().slice(0, 10);
  writeFirstWallet(data);
}

if (process.argv[1]?.endsWith("first-wallet.ts")) {
  if (process.argv[2] === "refresh") {
    if (!process.env.PULSE_OWNER_KEY) throw new Error("No owner key: run it as npm run first-wallet:refresh.");
    await refresh(process.env.PULSE_OWNER_KEY);
  }
  console.log(JSON.stringify(scoreFirstWallet(), null, 2));
}
