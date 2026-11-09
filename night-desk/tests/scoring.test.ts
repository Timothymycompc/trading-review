import assert from "node:assert/strict";
import test from "node:test";
import { deflatedSharpe, maxDrawdown, score1to5, scoreStrategy, sharpe } from "../src/scoring.js";

test("sharpe computes exact sample Sharpe on hand-worked returns", () => {
  // mean = 0.04, sample variance = ((0.02-0.04)^2 + 0 + (0.06-0.04)^2) / 2 = 0.0004, std = 0.02
  const sr = sharpe([0.02, 0.04, 0.06]);
  assert.ok(Math.abs(sr - 2.0) < 1e-12, `Expected 2.0, got ${sr}`);

  assert.equal(sharpe([0.03]), 0);
  assert.equal(sharpe([0.01, 0.01, 0.01]), 0);
});

test("maxDrawdown computes exact peak-to-trough fraction on hand-worked curve", () => {
  // Peak = 120, subsequent trough = 84 -> drawdown = (120 - 84) / 120 = 0.30
  const dd = maxDrawdown([100, 120, 90, 110, 84, 130]);
  assert.ok(Math.abs(dd - 0.3) < 1e-12, `Expected 0.30, got ${dd}`);

  assert.equal(maxDrawdown([100, 105, 110, 125]), 0);
  assert.equal(maxDrawdown([100]), 0);
});

test("deflatedSharpe penalizes multiple testing and matches null benchmark", () => {
  // At observedSharpe = 0 and nTrials = 1, z = 0 -> Phi(0) = 0.5
  const nullDsr = deflatedSharpe(0, 1, 0, 3, 37);
  assert.ok(Math.abs(nullDsr - 0.5) < 1e-6, `Expected 0.5, got ${nullDsr}`);

  const singleTrial = deflatedSharpe(0.45, 1, 0, 3, 37);
  const fiftyTrials = deflatedSharpe(0.45, 50, 0, 3, 37);
  assert.ok(singleTrial > 0.99, `Expected >0.99 for single trial, got ${singleTrial}`);
  assert.ok(
    fiftyTrials < singleTrial,
    `Expected 50-trial DSR (${fiftyTrials}) < 1-trial DSR (${singleTrial})`
  );
});

test("scoreStrategy enforces >=18/25 AND positive edge after costs AND >=30 trades", () => {
  // Scores: OOS Sharpe 1.8 -> 4, DSR 0.96 -> 5, MaxDD 0.08 -> 4, Trades 45 -> 3, Edge 0.003 -> 4 => 20/25
  const passing = scoreStrategy({
    outOfSampleSharpe: 1.8,
    deflatedSharpe: 0.96,
    maxDrawdown: 0.08,
    tradeCount: 45,
    edgeAfterCosts: 0.003
  });
  assert.equal(passing.total, 20);
  assert.equal(passing.passed, true);

  // Fails when edgeAfterCosts <= 0 even if total >= 18 (5 + 5 + 5 + 5 + 1 = 21)
  const negativeEdge = scoreStrategy({
    outOfSampleSharpe: 2.2,
    deflatedSharpe: 0.98,
    maxDrawdown: 0.04,
    tradeCount: 120,
    edgeAfterCosts: 0
  });
  assert.equal(negativeEdge.total, 21);
  assert.equal(negativeEdge.passed, false);

  // Fails when tradeCount < 30 even if total >= 18 (5 + 5 + 5 + 2 + 5 = 22)
  const tooFewTrades = scoreStrategy({
    outOfSampleSharpe: 2.2,
    deflatedSharpe: 0.98,
    maxDrawdown: 0.04,
    tradeCount: 25,
    edgeAfterCosts: 0.006
  });
  assert.equal(tooFewTrades.total, 22);
  assert.equal(tooFewTrades.passed, false);

  // Fails when total < 18 despite >=30 trades and positive edge (2 + 2 + 2 + 3 + 2 = 11)
  const lowTotal = scoreStrategy({
    outOfSampleSharpe: 0.6,
    deflatedSharpe: 0.55,
    maxDrawdown: 0.22,
    tradeCount: 35,
    edgeAfterCosts: 0.0005
  });
  assert.equal(lowTotal.total, 11);
  assert.equal(lowTotal.passed, false);
  assert.equal(score1to5("tradeCount", 35), 3);
});
