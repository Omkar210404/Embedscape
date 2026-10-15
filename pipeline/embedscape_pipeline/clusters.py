"""k-means clusters on the original 50d unit vectors, named by their most central words."""

from __future__ import annotations

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score


def kmeans(unit: np.ndarray, k: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    model = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(unit)
    return model.labels_.astype(np.uint8), model.cluster_centers_


def silhouette_scan(unit: np.ndarray, ks: list[int], seed: int) -> dict[int, float]:
    """Cosine silhouette for each candidate k (higher = better separated)."""
    return {k: float(silhouette_score(unit, kmeans(unit, k, seed)[0], metric="cosine")) for k in ks}


def name_clusters(unit: np.ndarray, labels: np.ndarray, centres: np.ndarray, words: list[str], n: int = 3) -> list[dict]:
    """Rule: a cluster's name is its `n` members with the highest cosine similarity to the centroid."""
    out = []
    for c in range(centres.shape[0]):
        members = np.flatnonzero(labels == c)
        centre = centres[c] / np.linalg.norm(centres[c])
        sims = unit[members] @ centre
        best = members[np.argsort(-sims)[:n]]
        out.append({"id": c, "size": int(members.size), "central": [words[i] for i in best]})
    return out
