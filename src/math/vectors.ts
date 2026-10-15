// Similarity maths on the original 50-d unit vectors. Nothing here looks at 3D positions.
// Vectors are unit length, so cosine similarity is a plain dot product.

export interface Space {
  count: number;
  dims: number;
  vectors: Float32Array;
}

export interface Hit {
  index: number;
  score: number;
}

export function row(space: Space, i: number): Float32Array {
  return space.vectors.subarray(i * space.dims, (i + 1) * space.dims);
}

export function cosine(space: Space, a: number, b: number): number {
  const d = space.dims;
  const v = space.vectors;
  let s = 0;
  for (let j = 0; j < d; j++) s += v[a * d + j]! * v[b * d + j]!;
  return s;
}

/** Exact brute-force top-k by cosine to `query` (any vector, normalised here). */
export function topK(space: Space, query: Float32Array, k: number, exclude: ReadonlySet<number> = new Set()): Hit[] {
  const q = normalise(query);
  const { count, dims, vectors } = space;
  const hits: Hit[] = [];
  for (let i = 0; i < count; i++) {
    if (exclude.has(i)) continue;
    let s = 0;
    for (let j = 0; j < dims; j++) s += vectors[i * dims + j]! * q[j]!;
    if (hits.length < k) {
      hits.push({ index: i, score: s });
      if (hits.length === k) hits.sort((x, y) => y.score - x.score);
    } else if (s > hits[k - 1]!.score) {
      // insertion into the sorted list; k is small (5 or 10)
      let p = k - 1;
      while (p > 0 && hits[p - 1]!.score < s) {
        hits[p] = hits[p - 1]!;
        p--;
      }
      hits[p] = { index: i, score: s };
    }
  }
  return hits.sort((x, y) => y.score - x.score);
}

export function neighbours(space: Space, i: number, k = 10): Hit[] {
  return topK(space, row(space, i), k, new Set([i]));
}

export interface AnalogyResult {
  hits: Hit[];
  /** The best match when the three inputs are NOT excluded. Shown so users see what exclusion hides. */
  topIncludingInputs: Hit;
}

/** 3CosAdd: the words closest to A - B + C, excluding A, B and C (the standard convention). */
export function analogy(space: Space, a: number, b: number, c: number, k = 5): AnalogyResult {
  const target = new Float32Array(space.dims);
  const va = row(space, a);
  const vb = row(space, b);
  const vc = row(space, c);
  for (let j = 0; j < space.dims; j++) target[j] = va[j]! - vb[j]! + vc[j]!;
  return {
    hits: topK(space, target, k, new Set([a, b, c])),
    topIncludingInputs: topK(space, target, 1)[0]!,
  };
}

export function normalise(v: Float32Array): Float32Array {
  let n = 0;
  for (let j = 0; j < v.length; j++) n += v[j]! * v[j]!;
  if (n === 0) return v;
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}
