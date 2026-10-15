import { describe, expect, it } from "vitest";
import { decodeLayout, decodeVectors } from "../src/data/load";
import { clusterPalette, oklchToSrgb, toCss } from "../src/math/colors";
import { pairPercentile, reading } from "../src/math/compare";
import { nearestIn3d, projectionOverlap } from "../src/math/projection";
import { suggest } from "../src/math/search";
import { analogy, cosine, neighbours, normalise, topK, type Space } from "../src/math/vectors";

function space(rows: number[][]): Space {
  const dims = rows[0]!.length;
  const vectors = new Float32Array(rows.length * dims);
  rows.forEach((r, i) => vectors.set(normalise(Float32Array.from(r)), i * dims));
  return { count: rows.length, dims, vectors };
}

function randomSpace(n: number, d: number, seed = 1): Space {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  return space(Array.from({ length: n }, () => Array.from({ length: d }, rand)));
}

describe("vectors", () => {
  it("cosine of unit vectors is the dot product", () => {
    const s = space([[1, 0], [0, 1], [1, 1]]);
    expect(cosine(s, 0, 1)).toBeCloseTo(0);
    expect(cosine(s, 0, 2)).toBeCloseTo(Math.SQRT1_2);
    expect(cosine(s, 2, 2)).toBeCloseTo(1);
  });

  it("topK matches a full sort and respects exclusions", () => {
    const s = randomSpace(300, 8);
    const q = s.vectors.slice(0, 8);
    const brute = Array.from({ length: s.count }, (_, i) => ({ index: i, score: cosine(s, 0, i) }))
      .filter((h) => h.index !== 0 && h.index !== 5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    const hits = topK(s, q, 10, new Set([0, 5]));
    expect(hits.map((h) => h.index)).toEqual(brute.map((h) => h.index));
    hits.forEach((h, i) => expect(h.score).toBeCloseTo(brute[i]!.score, 6));
  });

  it("topK copes with k larger than the vocabulary", () => {
    expect(topK(space([[1, 0], [0, 1]]), Float32Array.from([1, 0]), 5)).toHaveLength(2);
  });

  it("neighbours never include the word itself", () => {
    const s = randomSpace(50, 6);
    expect(neighbours(s, 3, 10).some((h) => h.index === 3)).toBe(false);
  });

  it("analogy excludes inputs and reports the unfiltered winner", () => {
    // 0:king 1:man 2:woman 3:queen 4:noise; king - man + woman points closest to queen
    const s = space([[1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [0, 0.2, -1]]);
    const { hits, topIncludingInputs } = analogy(s, 0, 1, 2, 2);
    expect(hits[0]!.index).toBe(3);
    expect(hits[0]!.score).toBeGreaterThan(0.95);
    expect(hits.map((h) => h.index)).not.toContain(0);
    expect(topIncludingInputs.index).toBe(3);
  });

  it("normalise leaves zero vectors alone", () => {
    expect(Array.from(normalise(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe("compare", () => {
  const t = { very_close: 0.85, related: 0.69, loosely_related: 0.51 };
  it("reads scores against the thresholds (inclusive lower bounds)", () => {
    expect(reading(0.85, t)).toBe("very close");
    expect(reading(0.7, t)).toBe("related");
    expect(reading(0.51, t)).toBe("loosely related");
    expect(reading(0.509, t)).toBe("unrelated");
    expect(reading(-0.4, t)).toBe("unrelated");
  });

  it("interpolates the pair percentile", () => {
    const q = [-1, 0, 0.5, 1]; // 4 quantiles -> 0%, 33.3%, 66.7%, 100%
    expect(pairPercentile(-2, q)).toBe(0);
    expect(pairPercentile(2, q)).toBe(100);
    expect(pairPercentile(0, q)).toBeCloseTo(100 / 3);
    expect(pairPercentile(0.25, q)).toBeCloseTo(50);
  });
});

describe("search", () => {
  const words = ["the", "theory", "other", "there", "ocean", "math"];
  it("returns prefix matches first, in frequency order, then inner matches", () => {
    expect(suggest(words, "the").map((i) => words[i])).toEqual(["the", "theory", "there", "other"]);
  });
  it("normalises case and whitespace, and ignores empty input", () => {
    expect(suggest(words, "  OCE ").map((i) => words[i])).toEqual(["ocean"]);
    expect(suggest(words, "  ")).toEqual([]);
  });
  it("respects the limit", () => {
    expect(suggest(words, "t", 2)).toHaveLength(2);
  });
});

describe("binary decoding", () => {
  it("dequantises int8 rows and re-normalises them", () => {
    const n = 2;
    const d = 3;
    const buf = new ArrayBuffer(n * 4 + n * d);
    new Float32Array(buf, 0, n).set([0.01, 0.5]);
    new Int8Array(buf, n * 4, n * d).set([127, 0, 0, 3, 4, 0]);
    const v = decodeVectors(buf, n, d);
    expect(Array.from(v.slice(0, 3))).toEqual([1, 0, 0]);
    expect(v[3]).toBeCloseTo(0.6);
    expect(v[4]).toBeCloseTo(0.8);
  });

  it("rejects a file of the wrong size", () => {
    expect(() => decodeVectors(new ArrayBuffer(10), 2, 3)).toThrow(/expected 14/);
    expect(() => decodeLayout(new ArrayBuffer(10), 2)).toThrow(/expected 26/);
  });

  it("splits positions and cluster ids", () => {
    const buf = new ArrayBuffer(2 * 13);
    new Float32Array(buf, 0, 6).set([1, 2, 3, 4, 5, 6]);
    new Uint8Array(buf, 24, 2).set([7, 9]);
    const { positions, cluster } = decodeLayout(buf, 2);
    expect(Array.from(positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(cluster)).toEqual([7, 9]);
  });
});

describe("projection check", () => {
  it("finds 3D neighbours and counts overlap with true neighbours", () => {
    const pos = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 10, 0, 0]);
    expect(nearestIn3d(pos, 0, 2)).toEqual([1, 2]);
    expect(projectionOverlap(pos, 0, [1, 3])).toBe(1);
  });
});

describe("colours", () => {
  it("produces valid, distinct hex colours", () => {
    const css = clusterPalette(20).map(toCss);
    css.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/));
    expect(new Set(css).size).toBe(20);
  });
  it("maps OKLCH white and black correctly", () => {
    expect(toCss(oklchToSrgb(1, 0, 0))).toBe("#ffffff");
    expect(toCss(oklchToSrgb(0, 0, 0))).toBe("#000000");
  });
});
