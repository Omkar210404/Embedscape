// Autocomplete over the vocabulary. Words are stored in frequency order, so the
// first matches found are also the most common ones.

export function normaliseQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** Prefix matches first (by frequency), then words that contain the query elsewhere. */
export function suggest(words: readonly string[], query: string, limit = 8): number[] {
  const q = normaliseQuery(query);
  if (!q) return [];
  const prefix: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < words.length && prefix.length < limit; i++) {
    const w = words[i]!;
    if (w.startsWith(q)) prefix.push(i);
    else if (inner.length < limit && w.includes(q)) inner.push(i);
  }
  return prefix.concat(inner).slice(0, limit);
}
