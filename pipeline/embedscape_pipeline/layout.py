"""3D positions with UMAP. Used for the picture only; no score in the app is computed from these."""

from __future__ import annotations

import numpy as np

UMAP_PARAMS = {"n_components": 3, "n_neighbors": 15, "min_dist": 0.1, "metric": "cosine"}
SCENE_RADIUS = 50.0


def umap_3d(x: np.ndarray, seed: int) -> np.ndarray:
    import umap  # slow import (numba), so only load it when needed

    reducer = umap.UMAP(**UMAP_PARAMS, random_state=seed)
    return reducer.fit_transform(x).astype(np.float64)


def fit_to_scene(pos: np.ndarray, radius: float = SCENE_RADIUS) -> np.ndarray:
    """Centre on the origin and scale so the farthest point sits at `radius`."""
    centred = pos - pos.mean(axis=0)
    far = np.linalg.norm(centred, axis=1).max()
    return (centred * (radius / far)).astype(np.float32)
