import assert from "node:assert/strict";
import test from "node:test";
import { riskOfficer, veto } from "../src/crew/riskOfficer.js";
import { validateDeskRules } from "../src/deskRules.js";

const baseRules = validateDeskRules({
  paperCapitalUsd: 100_000,
  maxRiskPerTradePct: 0.01, // $1,000 max risk per trade
  holdingPeriod: "swing (1-5 days)",
  neverTrade: ["TQQQ", "SQQQ", "GME"]
});

test("Risk Officer approves compliant US equity trade outside blackout windows", () => {
  const decision = veto(
    {
      ticker: "AAPL",
      riskUsd: 750,
      plannedEntryTime: "2026-11-10T15:00:00Z",
      upcomingEvents: [
        {
          kind: "earnings",
          ticker: "AAPL",
          startsAt: "2026-11-20T00:00:00Z",
          endsAt: "2026-11-21T23:59:59Z"
        }
      ]
    },
    baseRules
  );

  assert.equal(decision.vetoed, false);
  assert.equal(decision.reasons.length, 0);
});

test("Risk Officer veto fires on over-risk trade (USD and percentage)", () => {
  const overUsd = riskOfficer.veto(
    {
      ticker: "MSFT",
      riskUsd: 1_500 // > $1,000 max
    },
    baseRules
  );
  assert.equal(overUsd.vetoed, true);
  assert.ok(overUsd.reason.includes("exceeds max risk per trade"));

  const overPct = riskOfficer.veto(
    {
      ticker: "NVDA",
      riskPct: 0.025 // 2.5% > 1.0% max
    },
    baseRules
  );
  assert.equal(overPct.vetoed, true);
  assert.ok(overPct.reason.includes("exceeds DeskRules limit"));
});

test("Risk Officer veto fires on never-trade ticker (case-insensitive)", () => {
  const blocked = veto(
    {
      ticker: "tqqq",
      riskUsd: 400
    },
    baseRules
  );

  assert.equal(blocked.vetoed, true);
  assert.ok(blocked.reason.includes("never-trade list"));
});

test("Risk Officer veto fires on earnings, Fed (FOMC), and CPI blackout windows", () => {
  const earningsVeto = veto(
    {
      ticker: "AMD",
      riskUsd: 500,
      plannedEntryTime: "2026-11-12T14:30:00Z",
      upcomingEvents: [
        {
          kind: "earnings",
          ticker: "AMD",
          startsAt: "2026-11-12T00:00:00Z",
          endsAt: "2026-11-13T23:59:59Z"
        }
      ]
    },
    baseRules
  );
  assert.equal(earningsVeto.vetoed, true);
  assert.ok(earningsVeto.reason.includes("AMD earnings window"));

  const fedVeto = veto(
    {
      ticker: "SPY",
      riskUsd: 500,
      plannedEntryTime: "2026-12-16T18:00:00Z",
      upcomingEvents: [
        {
          kind: "fed",
          startsAt: "2026-12-16T13:00:00Z",
          endsAt: "2026-12-16T21:00:00Z"
        }
      ]
    },
    baseRules
  );
  assert.equal(fedVeto.vetoed, true);
  assert.ok(fedVeto.reason.includes("Fed (FOMC) window"));

  const cpiVeto = veto(
    {
      ticker: "QQQ",
      riskUsd: 500,
      inCpiWindow: true
    },
    baseRules
  );
  assert.equal(cpiVeto.vetoed, true);
  assert.ok(cpiVeto.reason.includes("CPI release blackout window"));
});
