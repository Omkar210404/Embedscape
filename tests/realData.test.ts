// Runs against the committed data in public/data. Every claim the site makes in its preset
// notes is checked here, so regenerating the data cannot silently make the notes wrong.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDataset, type VocabFile } from "../src/data/load";
import { reading } from "../src/math/compare";
import { analogy, cosine, neighbours, topK, type Hit } from "../src/math/vectors";
import { ANALOGY_PRESETS, COMPARE_PRESETS, EXPLORE_SUGGESTIONS } from "../src/presets";

const dir = new URL("../public/data/", import.meta.url);
const bytes = (name: string) => {
  const b = readFileSync(new URL(name, dir));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const vocab = JSON.parse(readFileSync(new URL("vocab.json", dir), "utf-8")) as VocabFile;
const data = buildDataset(vocab, bytes("vectors.bin"), bytes("layout.bin"));
const id = (w: string) => {
  const i = data.index.get(w);
  if (i === undefined) throw new Error(`${w} not in vocabulary`);
  return i;
};
const words = (hits: Hit[]) => hits.map((h) => data.words[h.index]);

function run(a: string, b: string, c: string) {
  return analogy(data, id(a), id(b), id(c), 5);
}

/** 1-based rank of `want` among analogy answers (inputs excluded). */
function rankOf(a: string, b: string, c: string, want: string): number {
  const target = new Float32Array(data.dims);
  for (let j = 0; j < data.dims; j++) {
    target[j] = data.vectors[id(a) * data.dims + j]! - data.vectors[id(b) * data.dims + j]! + data.vectors[id(c) * data.dims + j]!;
  }
  const all = topK(data, target, data.count, new Set([id(a), id(b), id(c)]));
  return all.findIndex((h) => h.index === id(want)) + 1;
}

describe("shipped data", () => {
  it("has 5,000 unique words with unit vectors and valid clusters", () => {
    expect(data.count).toBe(5000);
    expect(new Set(data.words).size).toBe(5000);
    for (let i = 0; i < data.count; i++) expect(cosine(data, i, i)).toBeCloseTo(1, 5);
    expect(Math.max(...data.cluster)).toBe(vocab.kmeans.k - 1);
    expect(vocab.clusters).toHaveLength(vocab.kmeans.k);
  });

  it("places every word on the globe's surface (radius 50, as the scene expects)", () => {
    for (let i = 0; i < data.count; i++) {
      const [x, y, z] = [data.positions[i * 3]!, data.positions[i * 3 + 1]!, data.positions[i * 3 + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(50, 3);
    }
  });

  it("contains no stop words, digits or short fragments", () => {
    for (const w of data.words) expect(w).toMatch(/^[a-z]{3,}$/);
    for (const w of ["the", "and", "with"]) expect(data.index.has(w)).toBe(false);
  });

  it("gives sensible nearest neighbours", () => {
    expect(words(neighbours(data, id("tokyo"), 10))).toContain("beijing");
    expect(words(neighbours(data, id("monday"), 3))).toEqual(expect.arrayContaining(["tuesday"]));
  });

  it("every preset and suggestion word is in the vocabulary", () => {
    for (const p of ANALOGY_PRESETS) [p.a, p.b, p.c].forEach(id);
    for (const p of COMPARE_PRESETS) [p.a, p.b].forEach(id);
    EXPLORE_SUGGESTIONS.forEach(id);
  });
});

describe("analogy preset claims", () => {
  it("king - man + woman = queen, and king wins if inputs are kept", () => {
    const r = run("king", "man", "woman");
    expect(words(r.hits)[0]).toBe("queen");
    expect(data.words[r.topIncludingInputs.index]).toBe("king");
  });

  it("the other 'works' presets land on the expected word", () => {
    expect(words(run("paris", "france", "japan").hits)[0]).toBe("tokyo");
    expect(words(run("actor", "man", "woman").hits)[0]).toBe("actress");
    expect(words(run("teacher", "school", "hospital").hits)[0]).toBe("doctor");
    const better = run("better", "good", "bad");
    expect(words(better.hits)[0]).toBe("worse");
    expect(data.words[better.topIncludingInputs.index]).toBe("bad");
  });

  it("brother - man + woman fails: sister is only 9th", () => {
    expect(words(run("brother", "man", "woman").hits)[0]).not.toBe("sister");
    expect(rankOf("brother", "man", "woman", "sister")).toBe(9);
  });

  it("bigger - big + small: larger wins, smaller is 2nd", () => {
    expect(words(run("bigger", "big", "small").hits).slice(0, 2)).toEqual(["larger", "smaller"]);
  });

  it("doctor - man + woman returns pregnancy and family words; nurse is not in the vocabulary", () => {
    const top = words(run("doctor", "man", "woman").hits);
    expect(top).toEqual(expect.arrayContaining(["pregnant", "child", "mother"]));
    expect(top).not.toContain("doctor");
    expect(data.index.has("nurse")).toBe(false);
  });
});

describe("compare preset claims", () => {
  it("opposites good / bad score as related or closer", () => {
    const score = cosine(data, id("good"), id("bad"));
    expect(["related", "very close"]).toContain(reading(score, vocab.calibration.thresholds));
  });

  it("an unrelated pair reads as unrelated", () => {
    expect(reading(cosine(data, id("computer"), id("river")), vocab.calibration.thresholds)).toBe("unrelated");
  });
});
