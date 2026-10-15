import type { Dataset } from "../data/load";
import type { FocusOptions } from "../scene/explorer";

/** What the panels need from the app. The scene may be missing (no WebGL); panels still work. */
export interface AppContext {
  data: Dataset;
  clusterCss: string[];
  /** Highlight words in the 3D view. No-op without WebGL. */
  show(focus: number[], neighbours: number[], options?: FocusOptions): void;
  /** Make a word the explored word: opens its card, flies to it and updates the URL. */
  explore(index: number): void;
}

export function clusterName(ctx: AppContext, wordIndex: number): string {
  const c = ctx.data.vocab.clusters[ctx.data.cluster[wordIndex]!]!;
  return c.central.join(" · ");
}
