"""Download and read the GloVe 6B vectors.

The zip is 862 MB, so it is cached outside git and the download resumes with
HTTP Range requests if the connection drops (the Stanford server does drop
long transfers). The file is accepted only if its size and SHA-256 match.
"""

from __future__ import annotations

import hashlib
import io
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterator

import numpy as np

GLOVE_URL = "https://downloads.cs.stanford.edu/nlp/data/glove.6B.zip"
GLOVE_SIZE = 862_182_613
# Recorded from a complete download whose zip CRC checks all passed (2026-10-15).
GLOVE_SHA256 = "617afb2fe6cbd085c235baf7a465b96f4112bd7f7ccb2b2cbd649fed9cbcf2fb"
GLOVE_MEMBER_50D = "glove.6B.50d.txt"

CHUNK = 1 << 20


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def ensure_glove_zip(cache_dir: Path, max_attempts: int = 20) -> Path:
    """Return the path to a verified glove.6B.zip, downloading or resuming as needed."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / "glove.6B.zip"

    for attempt in range(1, max_attempts + 1):
        have = path.stat().st_size if path.exists() else 0
        if have >= GLOVE_SIZE:
            break
        print(f"[download] attempt {attempt}: resuming at {have / 1e6:.1f} / {GLOVE_SIZE / 1e6:.1f} MB")
        req = urllib.request.Request(GLOVE_URL, headers={"Range": f"bytes={have}-"} if have else {})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp, path.open("ab" if have else "wb") as out:
                if have and resp.status != 206:
                    raise RuntimeError(f"server ignored the Range request (HTTP {resp.status})")
                for block in iter(lambda: resp.read(CHUNK), b""):
                    out.write(block)
        except (OSError, RuntimeError) as exc:
            print(f"[download] interrupted: {exc}")

    size = path.stat().st_size if path.exists() else 0
    if size != GLOVE_SIZE:
        raise RuntimeError(f"{path} is {size} bytes, expected {GLOVE_SIZE}. Delete it and retry.")
    digest = sha256_file(path)
    if digest != GLOVE_SHA256:
        raise RuntimeError(f"SHA-256 mismatch for {path}: {digest}. Delete it and retry.")
    print(f"[download] verified {path.name} (sha256 {digest[:12]}...)")
    return path


def iter_glove_rows(zip_path: Path, member: str = GLOVE_MEMBER_50D) -> Iterator[tuple[str, np.ndarray]]:
    """Yield (word, vector) in file order, which is GloVe's frequency order."""
    with zipfile.ZipFile(zip_path) as z, z.open(member) as raw:
        yield from parse_glove_lines(io.TextIOWrapper(raw, encoding="utf-8"))


def parse_glove_lines(lines) -> Iterator[tuple[str, np.ndarray]]:
    for line in lines:
        parts = line.rstrip("\n").split(" ")
        yield parts[0], np.asarray(parts[1:], dtype=np.float32)
