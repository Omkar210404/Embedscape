"""Build the static data files for the site.

    python build_data.py                # download (cached), build, write ../public/data and stats.json

Every number the README quotes about the data comes from the stats.json this writes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np

from embedscape_pipeline import calibrate, clusters, export, filters, layout, quantize
from embedscape_pipeline.download import GLOVE_MEMBER_50D, GLOVE_SHA256, GLOVE_URL, ensure_glove_zip, iter_glove_rows

HERE = Path(__file__).resolve().parent
SILHOUETTE_KS = [8, 12, 16, 20, 24, 32]


def build(rows, n_words: int, k: int, seed: int, blocklist: set[str], scan_ks: list[int] | None = None) -> dict:
    """Pure build step: rows in, file contents and stats out. No I/O, so tests can run it on fake data."""
    timings: dict[str, float] = {}

    t = time.perf_counter()
    sel = filters.select_vocab(rows, n_words, blocklist)
    timings["select_s"] = time.perf_counter() - t

    unit = quantize.l2_normalise(sel.vectors)
    q, scales = quantize.quantise(unit)
    t = time.perf_counter()
    qreport = quantize.quantisation_report(unit, q, scales)
    timings["quantise_report_s"] = time.perf_counter() - t

    # Calibrate on exactly what the browser computes with: dequantised, re-normalised vectors.
    browser_unit = quantize.l2_normalise(quantize.dequantise(q, scales))
    calib = calibrate.calibrate(browser_unit)

    t = time.perf_counter()
    pos = layout.sphere_to_xyz(layout.umap_sphere(unit, seed))
    timings["umap_s"] = time.perf_counter() - t

    t = time.perf_counter()
    labels, centres = clusters.kmeans(unit, k, seed)
    named = clusters.name_clusters(unit, labels, centres, sel.words)
    silhouettes = clusters.silhouette_scan(unit, scan_ks or [], seed)
    timings["kmeans_s"] = time.perf_counter() - t

    vocab = {
        "version": 1,
        "count": len(sel.words),
        "dims": int(unit.shape[1]),
        "words": sel.words,
        "clusters": named,
        "calibration": calib,
        "source": {
            "name": "GloVe 6B (Wikipedia 2014 + Gigaword 5), 50 dimensions",
            "authors": "Jeffrey Pennington, Richard Socher, Christopher D. Manning",
            "url": "https://nlp.stanford.edu/projects/glove/",
            "licence": "ODC Public Domain Dedication and License (PDDL) v1.0",
            "licence_url": "https://opendatacommons.org/licenses/pddl/1-0/",
        },
        "layout": {"method": "UMAP onto a sphere", **layout.UMAP_PARAMS, "random_state": seed, "radius": layout.GLOBE_RADIUS},
        "kmeans": {"k": k, "n_init": 10, "random_state": seed},
    }
    stats = {
        "vocabulary": {
            "words_kept": len(sel.words),
            "rows_examined": sel.rows_examined,
            "removed_by_rule": dict(sel.removed),
            "last_kept_word": sel.words[-1],
            "blocklist_entries_single_token": len(blocklist),
        },
        "quantisation": {"scheme": "symmetric per-vector int8 on L2-normalised vectors", **qreport},
        "calibration_thresholds": calib["thresholds"],
        "random_pair_cosine_mean": calib["pair_mean"],
        "clusters": {
            "k": k,
            "silhouette_cosine_by_k": silhouettes,
            "sizes": [c["size"] for c in named],
        },
        "timings_seconds": {name: round(v, 2) for name, v in timings.items()},
    }
    # Measured facts the site's About panel shows. Timings stay out so the file is reproducible.
    vocab["build"] = {key: stats[key] for key in ("vocabulary", "quantisation", "clusters")}
    return {
        "vectors.bin": export.vectors_bytes(q, scales),
        "layout.bin": export.layout_bytes(pos, labels),
        "vocab": vocab,
        "stats": stats,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n-words", type=int, default=5000)
    ap.add_argument("--k", type=int, default=20, help="number of k-means clusters")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--cache", type=Path, default=HERE / ".cache")
    ap.add_argument("--out", type=Path, default=HERE.parent / "public" / "data")
    ap.add_argument("--stats", type=Path, default=HERE / "stats.json")
    ap.add_argument("--no-silhouette-scan", action="store_true", help="skip the k comparison (faster)")
    args = ap.parse_args(argv)

    zip_path = ensure_glove_zip(args.cache)
    blocklist = filters.load_blocklist(HERE / "blocklist")
    scan = [] if args.no_silhouette_scan else SILHOUETTE_KS
    result = build(iter_glove_rows(zip_path), args.n_words, args.k, args.seed, blocklist, scan)

    args.out.mkdir(parents=True, exist_ok=True)
    files = {}
    for name in ("vectors.bin", "layout.bin"):
        (args.out / name).write_bytes(result[name])
    export.write_json(args.out / "vocab.json", result["vocab"])
    for name in ("vectors.bin", "layout.bin", "vocab.json"):
        data = (args.out / name).read_bytes()
        files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

    stats = {
        "source": {"url": GLOVE_URL, "member": GLOVE_MEMBER_50D, "zip_sha256": GLOVE_SHA256},
        "params": {"n_words": args.n_words, "k": args.k, "seed": args.seed},
        **result["stats"],
        "output_files": files,
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            **{pkg: version(pkg) for pkg in ("numpy", "scikit-learn", "umap-learn", "numba")},
        },
    }

    args.stats.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: stats[k] for k in ("vocabulary", "quantisation", "clusters", "output_files")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
