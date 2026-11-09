import type { Score, ScoreBreakdown } from "./types.js";

const EULER_MASCHERONI = 0.5772156649015329;

/**
 * Standard normal cumulative distribution function Phi(x).
 * Uses Abramowitz & Stegun 7.1.26 rational approximation (max error < 1.5e-7).
 */
export function normalCdf(x: number): number {
  if (!Number.isFinite(x)) {
    return x > 0 ? 1 : 0;
  }
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

/**
 * Inverse standard normal CDF Phi^-1(p) (Acklam's rational approximation).
 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.383577518672690e2,
    -3.066479806614716e1,
    2.506628277459239e0
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838e0,
    -2.549732539343734e0,
    4.374664141464968e0,
    2.938163982698783e0
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996e0,
    3.754408661907416e0
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Sample Sharpe ratio: (mean / sampleStd) * annualizationFactor.
 * Defaults to per-period (annualizationFactor = 1). Returns 0 for < 2 observations or zero variance.
 */
export function sharpe(returns: readonly number[], annualizationFactor: number = 1): number {
  const n = returns.length;
  if (n < 2) {
    return 0;
  }

  let sum = 0;
  for (const r of returns) {
    sum += r;
  }
  const mean = sum / n;

  let sqDiffSum = 0;
  for (const r of returns) {
    const diff = r - mean;
    sqDiffSum += diff * diff;
  }

  const variance = sqDiffSum / (n - 1);
  if (variance <= 0) {
    return 0;
  }

  return (mean / Math.sqrt(variance)) * annualizationFactor;
}

/**
 * Deflated Sharpe Ratio (Bailey & Lopez de Prado, 2014).
 * Returns the probability in [0, 1] that the true Sharpe exceeds the expected maximum
 * Sharpe from `nTrials` independent backtests, adjusted for sample skew, kurtosis, and length `n`.
 */
export function deflatedSharpe(
  observedSharpe: number,
  nTrials: number,
  skew: number,
  kurtosis: number,
  n: number
): number {
  if (n < 2 || !Number.isFinite(observedSharpe)) {
    return 0;
  }

  const trials = Math.max(1, Math.floor(nTrials));
  let expectedMaxSr = 0;

  if (trials > 1) {
    const srStdNull = 1 / Math.sqrt(n - 1);
    const z1 = normalInv(1 - 1 / trials);
    const z2 = normalInv(1 - 1 / (trials * Math.E));
    expectedMaxSr = srStdNull * ((1 - EULER_MASCHERONI) * z1 + EULER_MASCHERONI * z2);
  }

  const varianceTerm = Math.max(
    1e-9,
    1 - skew * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe * observedSharpe
  );
  const srStd = Math.sqrt(varianceTerm / (n - 1));
  const z = (observedSharpe - expectedMaxSr) / srStd;

  return normalCdf(z);
}

/**
 * Maximum peak-to-trough drawdown across an equity curve, returned as a fraction in [0, 1].
 */
export function maxDrawdown(equityCurve: readonly number[]): number {
  if (equityCurve.length < 2) {
    return 0;
  }

  let peak = equityCurve[0];
  let maxDd = 0;

  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }
    if (peak > 0) {
      const dd = (peak - value) / peak;
      if (dd > maxDd) {
        maxDd = dd;
      }
    }
  }

  return maxDd;
}

function scoreSingleMetric(metric: keyof ScoreBreakdown, value: number): number {
  switch (metric) {
    case "outOfSampleSharpe":
      if (value >= 2.0) return 5;
      if (value >= 1.5) return 4;
      if (value >= 1.0) return 3;
      if (value >= 0.5) return 2;
      return 1;

    case "deflatedSharpe":
      if (value >= 0.95) return 5;
      if (value >= 0.90) return 4;
      if (value >= 0.75) return 3;
      if (value >= 0.50) return 2;
      return 1;

    case "maxDrawdown":
      if (value <= 0.06) return 5;
      if (value <= 0.12) return 4;
      if (value <= 0.18) return 3;
      if (value <= 0.25) return 2;
      return 1;

    case "tradeCount":
      if (value >= 100) return 5;
      if (value >= 50) return 4;
      if (value >= 30) return 3;
      if (value >= 15) return 2;
      return 1;

    case "edgeAfterCosts":
      if (value >= 0.005) return 5;
      if (value >= 0.0025) return 4;
      if (value >= 0.001) return 3;
      if (value > 0) return 2;
      return 1;
  }
}

/**
 * Maps a single metric or all 5 metrics onto a 1-to-5 scale.
 */
export function score1to5(metric: keyof ScoreBreakdown, value: number): number;
export function score1to5(metrics: ScoreBreakdown): ScoreBreakdown;
export function score1to5(
  metricOrMetrics: keyof ScoreBreakdown | ScoreBreakdown,
  value?: number
): number | ScoreBreakdown {
  if (typeof metricOrMetrics === "string") {
    return scoreSingleMetric(metricOrMetrics, value ?? 0);
  }
  return {
    outOfSampleSharpe: scoreSingleMetric("outOfSampleSharpe", metricOrMetrics.outOfSampleSharpe),
    deflatedSharpe: scoreSingleMetric("deflatedSharpe", metricOrMetrics.deflatedSharpe),
    maxDrawdown: scoreSingleMetric("maxDrawdown", metricOrMetrics.maxDrawdown),
    tradeCount: scoreSingleMetric("tradeCount", metricOrMetrics.tradeCount),
    edgeAfterCosts: scoreSingleMetric("edgeAfterCosts", metricOrMetrics.edgeAfterCosts)
  };
}

/**
 * Evaluates all 5 strategy metrics out of 25 and applies the hard pass/fail gate:
 * total >= 18 AND edgeAfterCosts > 0 AND tradeCount >= 30.
 */
export function scoreStrategy(metrics: ScoreBreakdown): Score {
  const scores = score1to5(metrics);
  const total =
    scores.outOfSampleSharpe +
    scores.deflatedSharpe +
    scores.maxDrawdown +
    scores.tradeCount +
    scores.edgeAfterCosts;

  const reasons: string[] = [];
  if (total < 18) {
    reasons.push(`Total score ${total}/25 is below the minimum 18/25 threshold`);
  }
  if (metrics.edgeAfterCosts <= 0) {
    reasons.push(`Edge after costs (${metrics.edgeAfterCosts}) must be strictly positive`);
  }
  if (metrics.tradeCount < 30) {
    reasons.push(`Out-of-sample trade count (${metrics.tradeCount}) is below the 30-trade minimum`);
  }

  const passed = total >= 18 && metrics.edgeAfterCosts > 0 && metrics.tradeCount >= 30;
  if (passed) {
    reasons.push(`Passed scoring gate (${total}/25, positive post-cost edge, ${metrics.tradeCount} trades)`);
  }

  return {
    metrics: { ...metrics },
    scores,
    total,
    passed,
    reasons
  };
}
