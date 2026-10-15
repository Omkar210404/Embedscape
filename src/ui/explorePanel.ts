import { projectionOverlap } from "../math/projection";
import { neighbours } from "../math/vectors";
import { clusterName, type AppContext } from "./context";
import { el, fmt } from "./dom";

const K = 10;

/** The card for one explored word: its group and its 10 nearest neighbours. */
export class ExplorePanel {
  readonly root: HTMLElement;
  current: number | null = null;

  constructor(private readonly ctx: AppContext) {
    this.root = el("section", { class: "panel-section" });
  }

  select(index: number): void {
    const { data } = this.ctx;
    this.current = index;
    const word = data.words[index]!;
    const hits = neighbours(data, index, K);
    const overlap = projectionOverlap(data.positions, index, hits.map((h) => h.index));

    this.root.replaceChildren(
      el("p", { class: "kicker", text: "Exploring" }),
      el("h2", { class: "focus-word", text: word }),
      el("p", { class: "cluster-chip" }, [
        swatch(this.ctx.clusterCss[data.cluster[index]!]!),
        `In the group of “${clusterName(this.ctx, index)}”`,
      ]),
      el("h3", { class: "list-title", text: `The ${K} words the model sees as closest` }),
      el(
        "ol",
        { class: "score-list" },
        hits.map((h) =>
          el("li", {}, [
            el("button", {
              class: "word-btn",
              text: data.words[h.index]!,
              attrs: { type: "button", title: `Fly to "${data.words[h.index]}"` },
              on: { click: () => this.ctx.explore(h.index) },
            }),
            scoreBar(h.score),
            el("span", { class: "score", text: fmt(h.score) }),
          ]),
        ),
      ),
      el("p", {
        class: "fine",
        text: "Score = cosine similarity between the two words' 50-number vectors: 1 means they point the same way, 0 means unrelated. Click a word to fly to it on the globe.",
      }),
      el("p", { class: "fine" }, [
        el("strong", { text: `${overlap} of these ${K}` }),
        ` are also among its closest dots on the globe. The others look farther away than they are, because the globe flattens 50 dimensions onto a surface.`,
      ]),
    );
    this.ctx.show([index], hits.map((h) => h.index));
  }

  clear(): void {
    this.current = null;
    this.root.replaceChildren();
  }
}

export function swatch(color: string): HTMLElement {
  const s = el("span", { class: "swatch", attrs: { "aria-hidden": "true" } });
  s.style.background = color;
  return s;
}

export function scoreBar(score: number): HTMLElement {
  const bar = el("span", { class: "bar", attrs: { "aria-hidden": "true" } }, [el("span", { class: "bar-fill" })]);
  // Width set through CSSOM (allowed by the CSP), not a style attribute.
  (bar.firstChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, score)) * 100}%`;
  return bar;
}
