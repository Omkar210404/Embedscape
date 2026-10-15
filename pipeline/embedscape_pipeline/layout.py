"""Globe positions with UMAP. Used for the picture only; no score in the app is computed from these.

UMAP's haversine output metric embeds the words directly on the surface of a sphere, so
neighbourhoods are laid out on the globe itself rather than squashed onto it afterwards.
"""

from __future__ import annotations

import numpy as np

# min_dist=0 and n_neighbors=10 keep ~60% more true neighbours together on the globe than
# the defaults (mean top-10 overlap 2.15 vs 1.33 in a side-by-side test; free 3D scored 3.52).
UMAP_PARAMS = {"n_components": 2, "output_metric": "haversine", "n_neighbors": 10, "min_dist": 0.0, "metric": "cosine"}
GLOBE_RADIUS = 50.0


def umap_sphere(x: np.ndarray, seed: int) -> np.ndarray:
    """Return UMAP's spherical coordinates (two angles per word)."""
    import umap  # slow import (numba), so only load it when needed

    reducer = umap.UMAP(**UMAP_PARAMS, random_state=seed)
    return reducer.fit_transform(x).astype(np.float64)


def sphere_to_xyz(angles: np.ndarray, radius: float = GLOBE_RADIUS) -> np.ndarray:
    """Map UMAP's (theta, phi) angles to points on a sphere of `radius`.

    The angles are unbounded (the embedding may wrap around), which this mapping handles,
    following the umap-learn documentation for haversine output.
    """
    theta, phi = angles[:, 0], angles[:, 1]
    xyz = np.stack([np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)], axis=1)
    return (xyz * radius).astype(np.float32)
