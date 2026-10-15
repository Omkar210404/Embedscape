// Loads the three files written by pipeline/build_data.py and decodes them.
// Binary layouts are documented in pipeline/embedscape_pipeline/export.py.

export interface ClusterInfo {
  id: number;
  size: number;
  central: string[];
}

export interface Calibration {
  thresholds: { very_close: number; related: number; loosely_related: number };
  rules: Record<string, string>;
  pair_count: number;
  pair_mean: number;
  pair_quantiles: number[];
}

export interface BuildSummary {
  vocabulary: {
    words_kept: number;
    rows_examined: number;
    removed_by_rule: Record<string, number>;
  };
  quantisation: {
    component_abs_error_max: number;
    cosine_abs_error_max: number;
    cosine_abs_error_mean: number;
    top10_neighbour_overlap_mean: number;
  };
  clusters: { k: number; silhouette_cosine_by_k: Record<string, number> };
}

export interface VocabFile {
  version: number;
  count: number;
  dims: number;
  words: string[];
  clusters: ClusterInfo[];
  calibration: Calibration;
  source: { name: string; authors: string; url: string; licence: string; licence_url: string };
  layout: Record<string, string | number>;
  kmeans: { k: number };
  build: BuildSummary;
}

export interface Dataset {
  count: number;
  dims: number;
  words: string[];
  index: Map<string, number>;
  /** Unit-length vectors, row-major count x dims. All similarity maths uses these. */
  vectors: Float32Array;
  /** 3D positions, count x 3. For drawing only. */
  positions: Float32Array;
  cluster: Uint8Array;
  vocab: VocabFile;
}

/** Dequantise int8 rows and re-normalise each to unit length. */
export function decodeVectors(buf: ArrayBuffer, n: number, d: number): Float32Array {
  if (buf.byteLength !== n * 4 + n * d) {
    throw new Error(`vectors.bin is ${buf.byteLength} bytes, expected ${n * 4 + n * d}`);
  }
  const scales = new Float32Array(buf, 0, n);
  const q = new Int8Array(buf, n * 4, n * d);
  const out = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let j = 0; j < d; j++) {
      const v = q[i * d + j]! * scales[i]!;
      out[i * d + j] = v;
      norm += v * v;
    }
    const inv = 1 / Math.sqrt(norm);
    for (let j = 0; j < d; j++) out[i * d + j]! *= inv;
  }
  return out;
}

export function decodeLayout(buf: ArrayBuffer, n: number): { positions: Float32Array; cluster: Uint8Array } {
  if (buf.byteLength !== n * 13) throw new Error(`layout.bin is ${buf.byteLength} bytes, expected ${n * 13}`);
  return {
    positions: new Float32Array(buf.slice(0, n * 12)),
    cluster: new Uint8Array(buf.slice(n * 12)),
  };
}

export function buildDataset(vocab: VocabFile, vectorsBuf: ArrayBuffer, layoutBuf: ArrayBuffer): Dataset {
  const { count, dims, words } = vocab;
  if (words.length !== count) throw new Error("vocab.json word count does not match");
  const { positions, cluster } = decodeLayout(layoutBuf, count);
  return {
    count,
    dims,
    words,
    index: new Map(words.map((w, i) => [w, i])),
    vectors: decodeVectors(vectorsBuf, count, dims),
    positions,
    cluster,
    vocab,
  };
}

export async function loadDataset(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Dataset> {
  const get = async (name: string) => {
    const res = await fetchFn(`${baseUrl}data/${name}`);
    if (!res.ok) throw new Error(`could not load ${name} (HTTP ${res.status})`);
    return res;
  };
  const [vocabRes, vecRes, layoutRes] = await Promise.all([get("vocab.json"), get("vectors.bin"), get("layout.bin")]);
  const vocab = (await vocabRes.json()) as VocabFile;
  return buildDataset(vocab, await vecRes.arrayBuffer(), await layoutRes.arrayBuffer());
}
