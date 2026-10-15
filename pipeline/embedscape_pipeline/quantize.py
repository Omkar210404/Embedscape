"""int8 quantisation of unit-length vectors, and an honest measure of what it costs."""

from __future__ import annotations

import numpy as np


def l2_normalise(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    if np.any(norms == 0):
        raise ValueError("zero vector cannot be normalised")
    return (x / norms).astype(np.float32)


def quantise(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetric per-vector int8: x ~= q * scale, with scale = max|x_i| / 127."""
    scales = (np.abs(x).max(axis=1) / 127.0).astype(np.float32)
    q = np.clip(np.rint(x / scales[:, None]), -127, 127).astype(np.int8)
    return q, scales


def dequantise(q: np.ndarray, scales: np.ndarray) -> np.ndarray:
    return q.astype(np.float32) * scales[:, None]


def top_k(sim: np.ndarray, k: int) -> np.ndarray:
    """Indices of the k most similar rows per row, excluding the row itself, best first."""
    s = sim.copy()
    np.fill_diagonal(s, -np.inf)
    idx = np.argpartition(-s, k, axis=1)[:, :k]
    order = np.argsort(-np.take_along_axis(s, idx, axis=1), axis=1)
    return np.take_along_axis(idx, order, axis=1)


def quantisation_report(unit: np.ndarray, q: np.ndarray, scales: np.ndarray, k: int = 10) -> dict:
    """Compare float32 results with what the browser computes from the int8 file.

    The browser re-normalises dequantised vectors, so the comparison does too.
    """
    deq = dequantise(q, scales)
    err = np.abs(deq - unit)
    deq_unit = l2_normalise(deq)
    sim_f = unit @ unit.T
    sim_q = deq_unit @ deq_unit.T
    cos_err = np.abs(sim_q - sim_f)
    np.fill_diagonal(cos_err, 0)

    nn_f = top_k(sim_f, k)
    nn_q = top_k(sim_q, k)
    overlap = np.array([len(set(a) & set(b)) for a, b in zip(nn_f, nn_q)]) / k
    return {
        "component_abs_error_max": float(err.max()),
        "component_abs_error_mean": float(err.mean()),
        "cosine_abs_error_max": float(cos_err.max()),
        "cosine_abs_error_mean": float(cos_err[np.triu_indices_from(cos_err, 1)].mean()),
        f"top{k}_neighbour_overlap_mean": float(overlap.mean()),
        f"top{k}_neighbour_lists_identical_fraction": float(np.mean(np.all(nn_f == nn_q, axis=1))),
    }
