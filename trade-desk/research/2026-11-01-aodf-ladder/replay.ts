// Replays the desk's two AODF trades (2026-11-01) minute by minute on GeckoTerminal's 1-minute closes, under the old
// rules and the new ones (ladder for rug_chance high, same-ticker pair sharing one 8% with the 12.5% ladder).
// Usage: npx tsx research/2026-11-01-aodf-ladder/replay.ts <ohlcv-A.json> <ohlcv-B.json>
import fs from "node:fs";
import { exitFill, ladderFor, ladderSellShare, ladderSells, riskDecision, RULES } from "../../server/desk/agents";

const load = (f: string) => new Map<number, number>(JSON.parse(fs.readFileSync(f, "utf8")).data.attributes.ohlcv_list.map((r: number[]) => [r[0], r[4]]));
const [A, B] = [load(process.argv[2]), load(process.argv[3])];
const t = (s: string) => Date.parse(s) / 1000;
// Real desk facts (desk_positions ids 7 and 8): entries, sizes, and the fill each got when its pool emptied.
const real = {
  A: { open: t("2026-11-01T11:54:00Z"), entry: 0.35427021176964374, size: 78.98592764950158, dumpAt: t("2026-11-01T16:32:00Z"), dumpFill: 0.03548224008680229 },
  B: { open: t("2026-11-01T12:10:00Z"), entry: 0.38123096783521887, size: 79.87672698643472, dumpAt: t("2026-11-01T16:55:00Z"), dumpFill: 0.027955482621455995 },
};
const LIQ = 1_000_000; // both pools held about $1M before the dump (token_safety, 14:06 UTC)
const equityAt = (_s: number) => 1000; // 8% of the desk: the real run was $989-$1,244 over these hours; $1,000 keeps it simple

type Pos = { name: string; entry: number; size: number; qty: number; peak_price: number; trail_active: boolean; ladder: number[] | null; ladder_done: number; realized: number; closed?: { at: number; out: number; why: string } };
function run(newRules: boolean, shared = true) {
  const ps: Pos[] = [];
  const open = (name: string, price: number, size: number, ladder: number[] | null) => {
    const entry = price * (1 + RULES.feePct + size / LIQ);
    ps.push({ name, entry, size, qty: size / entry, peak_price: entry, trail_active: false, ladder, ladder_done: 0, realized: 0 });
  };
  const log: string[] = [];
  for (let s = real.A.open; s <= real.B.dumpAt; s += 60) {
    for (const p of ps) {
      if (p.closed) continue;
      const r = p.name === "A" ? real.A : real.B, src = p.name === "A" ? A : B;
      if (s >= r.dumpAt) { const out = p.realized + p.qty * r.dumpFill; p.closed = { at: s, out, why: "the dump (real fill)" }; continue; }
      const price = src.get(s); if (!price) continue;
      const d = riskDecision({ entry_price: p.entry, peak_price: p.peak_price, trail_active: p.trail_active, qty: p.qty }, price);
      p.peak_price = d.peak; p.trail_active = d.trail;
      if (d.exit) { const out = p.realized + p.qty * exitFill(price, p.qty * p.entry, LIQ); p.closed = { at: s, out, why: d.reason }; continue; }
      const n = ladderSells({ entry_price: p.entry, ladder: p.ladder, ladder_done: p.ladder_done }, price);
      if (n) {
        const q = Math.min(p.qty, (p.size / p.entry) * ladderSellShare(p.ladder!) * n), got = q * exitFill(price, q * p.entry, LIQ);
        p.qty -= q; p.realized += got; p.ladder_done += n;
        log.push(`${new Date(s * 1000).toISOString().slice(11, 16)} ${p.name} +${((price / p.entry - 1) * 100).toFixed(0)}%: sold ${(ladderSellShare(p.ladder!) * n * 100).toFixed(1)}% for $${got.toFixed(2)}`);
      }
    }
    if (s === real.A.open) open("A", A.get(s)!, real.A.size, newRules ? ladderFor(true, false) : null);
    // B: the real desk bought it at 12:10. New rules: it shares A's 8%, so it waits (re-checked each minute) for room.
    const a = ps.find((p) => p.name === "A")!;
    if (!ps.some((p) => p.name === "B") && s >= real.B.open && B.get(s)) {
      if (!newRules) open("B", B.get(s)!, real.B.size, null);
      else {
        const room = shared ? equityAt(s) * RULES.positionPct - (a.closed ? 0 : a.qty * a.entry) : real.B.size;
        if (room >= 1) {
          open("B", B.get(s)!, room, ladderFor(false, !a.closed));
          if (!a.closed) a.ladder = ladderFor(false, true);
          log.push(`${new Date(s * 1000).toISOString().slice(11, 16)} B bought for $${room.toFixed(2)} (room left in the pair's 8%)`);
        }
      }
    }
  }
  return { ps, log };
}
for (const [label, rules, shared] of [["old rules", false, true], ["new rules (pair shares one 8%)", true, true], ["new rules, but 8% each", true, false]] as const) {
  const { ps, log } = run(rules, shared);
  console.log(`\n== ${label} ==`);
  for (const l of log) console.log("  " + l);
  let tin = 0, tout = 0;
  for (const p of ps) { tin += p.size; tout += p.closed?.out ?? 0; console.log(`  AODF ${p.name}: in $${p.size.toFixed(2)}, out $${(p.closed?.out ?? 0).toFixed(2)} (${p.closed?.why}, ${new Date((p.closed?.at ?? 0) * 1000).toISOString().slice(11, 16)})`); }
  console.log(`  total: in $${tin.toFixed(2)}, out $${tout.toFixed(2)}, ${tout - tin >= 0 ? "+" : ""}$${(tout - tin).toFixed(2)}`);
}
