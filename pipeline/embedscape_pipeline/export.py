"""Binary layouts read by src/data/load.ts. All values little-endian.

vectors.bin : float32[N] per-vector scales, then int8[N * D] row-major vectors
layout.bin  : float32[N * 3] positions, then uint8[N] cluster ids

Scales and positions come first so every float32 view starts 4-byte aligned.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def vectors_bytes(q: np.ndarray, scales: np.ndarray) -> bytes:
    return scales.astype("<f4").tobytes() + q.astype(np.int8).tobytes()


def layout_bytes(pos: np.ndarray, labels: np.ndarray) -> bytes:
    return pos.astype("<f4").tobytes() + labels.astype(np.uint8).tobytes()


def read_vectors(data: bytes, n: int, d: int) -> tuple[np.ndarray, np.ndarray]:
    scales = np.frombuffer(data, dtype="<f4", count=n)
    q = np.frombuffer(data, dtype=np.int8, offset=n * 4, count=n * d).reshape(n, d)
    return q, scales


def read_layout(data: bytes, n: int) -> tuple[np.ndarray, np.ndarray]:
    pos = np.frombuffer(data, dtype="<f4", count=n * 3).reshape(n, 3)
    labels = np.frombuffer(data, dtype=np.uint8, offset=n * 12, count=n)
    return pos, labels


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
