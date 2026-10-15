// Plain-English reading of a cosine score, using thresholds measured on this vocabulary
// (see pipeline/embedscape_pipeline/calibrate.py). Mirrors calibrate.reading() exactly.

import type { Calibration } from "../data/load";

export type Reading = "very close" | "related" | "loosely related" | "unrelated";

export function reading(score: number, t: Calibration["thresholds"]): Reading {
  if (score >= t.very_close) return "very close";
  if (score >= t.related) return "related";
  if (score >= t.loosely_related) return "loosely related";
  return "unrelated";
}

/**
 * Percentage of all word pairs in the vocabulary with a lower similarity than `score`,
 * by linear interpolation over evenly spaced quantiles of the pair distribution.
 */
export function pairPercentile(score: number, quantiles: readonly number[]): number {
  const n = quantiles.length - 1;
  if (score <= quantiles[0]!) return 0;
  if (score >= quantiles[n]!) return 100;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (quantiles[mid]! <= score) lo = mid;
    else hi = mid;
  }
  const a = quantiles[lo]!;
  const b = quantiles[hi]!;
  const frac = b > a ? (score - a) / (b - a) : 0;
  return ((lo + frac) / n) * 100;
}
