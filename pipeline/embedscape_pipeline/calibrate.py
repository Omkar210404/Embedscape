"""Turn cosine scores into plain-English readings using thresholds measured on this vocabulary."""

from __future__ import annotations

import numpy as np

CDF_POINTS = 201  # quantiles of the random-pair distribution shipped to the browser


def calibrate(unit: np.ndarray) -> dict:
    sim = unit @ unit.T
    pairs = sim[np.triu_indices_from(sim, 1)]
    np.fill_diagonal(sim, -np.inf)
    top1 = sim.max(axis=1)

    thresholds = {
        "very_close": float(np.median(top1)),
        "related": float(np.percentile(pairs, 99)),
        "loosely_related": float(np.percentile(pairs, 90)),
    }
    if not thresholds["very_close"] > thresholds["related"] > thresholds["loosely_related"]:
        raise ValueError(f"thresholds are not ordered: {thresholds}")
    return {
        "thresholds": thresholds,
        "rules": {
            "very_close": "at or above the median similarity between a word and its single nearest neighbour",
            "related": "at or above the 99th percentile of all word pairs",
            "loosely_related": "at or above the 90th percentile of all word pairs",
            "unrelated": "below the 90th percentile of all word pairs",
        },
        "pair_count": int(pairs.size),
        "pair_mean": float(pairs.mean()),
        "pair_quantiles": [round(float(v), 5) for v in np.quantile(pairs, np.linspace(0, 1, CDF_POINTS))],
    }


def reading(score: float, thresholds: dict) -> str:
    if score >= thresholds["very_close"]:
        return "very close"
    if score >= thresholds["related"]:
        return "related"
    if score >= thresholds["loosely_related"]:
        return "loosely related"
    return "unrelated"
