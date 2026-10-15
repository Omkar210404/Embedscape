import type { Dataset } from "../data/load";

/** What the panels need from the app. The scene may be missing (no WebGL); panels still work. */
export interface AppContext {
  data: Dataset;
  clusterCss: string[];
  /** Highlight words in the 3D view. No-op without WebGL. */
  show(focus: number[], neighbours: number[], options?: { lines?: boolean; labels?: number[] }): void;
  /** Called when a word becomes the explored word, so the URL and other panels can follow. */
  explore(index: number): void;
}

export function clusterName(ctx: AppContext, wordIndex: number): string {
  const c = ctx.data.vocab.clusters[ctx.data.cluster[wordIndex]!]!;
  return c.central.join(" · ");
}
