// Retired bots (Tim 2026-11-08: "ladder a plus two new ones and retire all the rest"). A retired bot makes no new buys;
// positions it already holds keep their exit rules until they close. Its records stay in the database and on /desk.
// Why: from the 2026-11-07 reset to 2026-11-08 every lane lost (641 closed trades, -$720), and the 23k-coin backtest
// found no entry or exit rule that made money (research/2026-11-08-agy-review). Ladder A stays as the control.
// To bring one back, take its id out of this list.
//   main = the main desk's own buys (its scan and safety checks still run: they feed the watch data and Ladder A)
//   fast, ladderB, copy (Real Wallet Copy), lottery (the REAL-money lane; its wallet has ~0 SOL)
// 2026-11-09: Tim brought WAIT-5 (momo) back with new exits for losing trades (ladder.ts MOMO_LANE).
export const RETIRED_DEFAULT = ["main", "fast", "ladderB", "copy", "lottery"];

// DESK_RETIRED (comma list) overrides the list; the test suite sets it empty so every lane's own tests still run.
export const retiredList = () => (process.env.DESK_RETIRED ?? RETIRED_DEFAULT.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
export const isRetired = (id: string) => retiredList().includes(id);
