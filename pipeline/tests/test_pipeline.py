"""Pipeline unit tests. They use small synthetic vectors and never download GloVe."""

from __future__ import annotations

import io
import string

import numpy as np
import pytest

from build_data import build
from embedscape_pipeline import calibrate, clusters, export, filters, layout, quantize
from embedscape_pipeline.download import parse_glove_lines


# ---------- filters ----------

@pytest.mark.parametrize(
    ("word", "reason"),
    [
        ("1990", "not_alphabetic"),
        ("u.s.", "not_alphabetic"),
        ("well-known", "not_alphabetic"),
        ("café", "not_alphabetic"),
        ("mr", "too_short"),
        ("the", "stop_word"),
        ("badword", "blocklisted"),
        ("badwords", "blocklisted"),
        ("badwordes", "blocklisted"),
        ("notbadword", None),  # contains a listed string, but is not an exact match
        ("ocean", None),
    ],
)
def test_rejection_reason(word, reason):
    assert filters.rejection_reason(word, {"badword"}) == reason


def test_load_blocklist_skips_comments_and_phrases(tmp_path):
    (tmp_path / "a.txt").write_text("# comment\nFoo\n\ntwo words\n", encoding="utf-8")
    (tmp_path / "b.txt").write_text("bar\n", encoding="utf-8")
    (tmp_path / "ignored.md").write_text("baz\n", encoding="utf-8")
    assert filters.load_blocklist(tmp_path) == {"foo", "bar"}


def test_select_vocab_keeps_first_n_in_order_and_counts_removals():
    rows = [(w, np.ones(4, np.float32)) for w in ["the", "42", "ocean", "mr", "badword", "river", "lake", "sea"]]
    sel = filters.select_vocab(iter(rows), 2, {"badword"})
    assert sel.words == ["ocean", "river"]
    assert sel.rows_examined == 6
    assert sel.removed == {"stop_word": 1, "not_alphabetic": 1, "too_short": 1, "blocklisted": 1}


def test_select_vocab_raises_when_too_few_words():
    with pytest.raises(ValueError):
        filters.select_vocab(iter([("ocean", np.ones(2, np.float32))]), 2, set())


def test_parse_glove_lines():
    rows = list(parse_glove_lines(io.StringIO("cat 0.5 -1.25\ndog 1 2\n")))
    assert rows[0][0] == "cat"
    np.testing.assert_allclose(rows[0][1], [0.5, -1.25])
    assert rows[1][1].dtype == np.float32


# ---------- quantisation ----------

def test_quantise_error_is_within_half_a_step():
    x = quantize.l2_normalise(np.random.default_rng(0).normal(size=(200, 50)))
    q, scales = quantize.quantise(x)
    err = np.abs(quantize.dequantise(q, scales) - x)
    assert np.all(err <= scales[:, None] / 2 + 1e-7)
    assert q.dtype == np.int8 and np.abs(q).max() == 127


def test_quantisation_report_on_random_vectors():
    x = quantize.l2_normalise(np.random.default_rng(1).normal(size=(300, 50)))
    report = quantize.quantisation_report(x, *quantize.quantise(x))
    assert report["cosine_abs_error_max"] < 0.02
    assert 0.9 < report["top10_neighbour_overlap_mean"] <= 1.0


def test_top_k_excludes_self_and_sorts():
    sim = np.array([[1, 0.2, 0.9], [0.2, 1, 0.5], [0.9, 0.5, 1]])
    assert quantize.top_k(sim, 2).tolist() == [[2, 1], [2, 0], [0, 1]]


def test_normalise_rejects_zero_vector():
    with pytest.raises(ValueError):
        quantize.l2_normalise(np.zeros((1, 3)))


# ---------- export ----------

def test_binary_round_trip():
    rng = np.random.default_rng(2)
    q = rng.integers(-127, 128, size=(7, 5)).astype(np.int8)
    scales = rng.random(7).astype(np.float32)
    q2, s2 = export.read_vectors(export.vectors_bytes(q, scales), 7, 5)
    assert np.array_equal(q, q2) and np.array_equal(scales, s2)

    pos = rng.normal(size=(7, 3)).astype(np.float32)
    labels = rng.integers(0, 20, size=7).astype(np.uint8)
    blob = export.layout_bytes(pos, labels)
    assert len(blob) == 7 * 13
    p2, l2 = export.read_layout(blob, 7)
    assert np.array_equal(pos, p2) and np.array_equal(labels, l2)


# ---------- globe layout ----------

def test_sphere_to_xyz_puts_points_on_the_sphere():
    angles = np.random.default_rng(5).normal(scale=4.0, size=(100, 2))  # includes wrapped angles
    xyz = layout.sphere_to_xyz(angles, radius=50.0)
    assert np.allclose(np.linalg.norm(xyz, axis=1), 50.0, atol=1e-4)
    # theta = 0 is the north pole whatever phi is
    assert np.allclose(layout.sphere_to_xyz(np.array([[0.0, 1.3]]), 1.0), [[0, 0, 1]], atol=1e-6)


# ---------- clusters and calibration ----------

def test_cluster_names_are_most_central_members():
    unit = quantize.l2_normalise(np.array([[1, 0], [0.9, 0.1], [0.6, 0.4], [0, 1], [0.1, 0.9]], dtype=np.float32))
    labels = np.array([0, 0, 0, 1, 1], dtype=np.uint8)
    centres = np.array([[1, 0], [0, 1]], dtype=np.float32)
    named = clusters.name_clusters(unit, labels, centres, ["a", "b", "c", "d", "e"], n=2)
    assert named[0] == {"id": 0, "size": 3, "central": ["a", "b"]}
    assert named[1]["central"] == ["d", "e"]


def test_calibration_thresholds_are_ordered_and_readings_follow_them():
    x = quantize.l2_normalise(np.random.default_rng(3).normal(size=(400, 10)))
    cal = calibrate.calibrate(x)
    t = cal["thresholds"]
    assert t["very_close"] > t["related"] > t["loosely_related"]
    assert len(cal["pair_quantiles"]) == calibrate.CDF_POINTS
    assert cal["pair_quantiles"] == sorted(cal["pair_quantiles"])
    assert calibrate.reading(t["very_close"], t) == "very close"
    assert calibrate.reading(t["related"], t) == "related"
    assert calibrate.reading(t["loosely_related"], t) == "loosely related"
    assert calibrate.reading(t["loosely_related"] - 1e-6, t) == "unrelated"


# ---------- end to end ----------

def _fake_rows(n=260, d=16):
    rng = np.random.default_rng(4)
    centres = rng.normal(size=(40, d))
    letters = string.ascii_lowercase
    for i in range(n):
        word = "w" + "".join(letters[(i // 26**j) % 26] for j in range(3))
        yield word, (centres[i % 40] + 0.5 * rng.normal(size=d)).astype(np.float32)


def test_build_is_deterministic_and_well_formed():
    a = build(_fake_rows(), n_words=200, k=4, seed=7, blocklist=set())
    b = build(_fake_rows(), n_words=200, k=4, seed=7, blocklist=set())
    assert a["vectors.bin"] == b["vectors.bin"]
    assert a["layout.bin"] == b["layout.bin"]

    assert len(a["vectors.bin"]) == 200 * 4 + 200 * 16
    pos, labels = export.read_layout(a["layout.bin"], 200)
    # Every word sits on the globe's surface.
    assert np.allclose(np.linalg.norm(pos, axis=1), 50.0, atol=1e-3)
    assert set(labels.tolist()) == {0, 1, 2, 3}
    vocab = a["vocab"]
    assert vocab["count"] == 200 and vocab["dims"] == 16 and len(vocab["clusters"]) == 4
