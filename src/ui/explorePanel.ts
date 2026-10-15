import { projectionOverlap } from "../math/projection";
import { neighbours } from "../math/vectors";
import { EXPLORE_SUGGESTIONS } from "../presets";
import { Combobox } from "./combobox";
import { clusterName, type AppContext } from "./context";
import { el, fmt } from "./dom";

const K = 10;

export class ExplorePanel {
  readonly root: HTMLElement;
  readonly search: Combobox;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLParagraphElement;

  constructor(private readonly ctx: AppContext) {
    const { words } = ctx.data;
    this.search = new Combobox({
      words,
      label: "Search a word",
      placeholder: "e.g. ocean",
      onSelect: (i) => ctx.explore(i),
      onMiss: (text) => this.miss(text),
    });
    this.status = el("p", { class: "status", attrs: { role: "status", "aria-live": "polite" } });
    this.body = el("div", { class: "explore-body" });
    this.root = el("section", { class: "panel-section" }, [this.search.root, this.status, this.body]);
    this.showIntro();
  }

  select(index: number): void {
    const { data } = this.ctx;
    this.search.setValue(index);
    this.status.textContent = "";
    const hits = neighbours(data, index, K);
    const overlap = projectionOverlap(data.positions, index, hits.map((h) => h.index));

    this.body.replaceChildren(
      el("h2", { class: "focus-word", text: data.words[index]! }),
      el("p", { class: "cluster-chip" }, [
        swatch(this.ctx.clusterCss[data.cluster[index]!]!),
        `Cluster ${data.cluster[index]! + 1}: ${clusterName(this.ctx, index)}`,
      ]),
      el("h3", { class: "list-title", text: `${K} nearest neighbours` }),
      el(
        "ol",
        { class: "score-list" },
        hits.map((h) =>
          el("li", {}, [
            el("button", {
              class: "word-btn",
              text: data.words[h.index]!,
              attrs: { type: "button", title: `Explore "${data.words[h.index]}"` },
              on: { click: () => this.ctx.explore(h.index) },
            }),
            scoreBar(h.score),
            el("span", { class: "score", text: fmt(h.score) }),
          ]),
        ),
      ),
      el("p", { class: "fine" }, [
        "Cosine similarity on the original 50-dimensional vectors (1 = same direction). ",
        el("strong", { text: `${overlap} of these ${K}` }),
        ` are also among the ${K} closest points in the 3D view. The rest look farther away than they are, because the 3D map squeezes 50 dimensions into 3.`,
      ]),
    );
    this.ctx.show([index], hits.map((h) => h.index));
  }

  private miss(text: string): void {
    this.status.textContent = `"${text}" is not one of the ${this.ctx.data.count.toLocaleString("en")} words in this map. It only holds common English words; numbers, very short words, stop words like "the" and offensive terms were removed.`;
  }

  private showIntro(): void {
    const { words, index } = this.ctx.data;
    this.body.replaceChildren(
      el("p", { class: "lead", text: "Every dot is a word. Words used in similar ways sit near each other. Search for one, or click any dot." }),
      el(
        "div",
        { class: "chips", attrs: { "aria-label": "Suggestions" } },
        EXPLORE_SUGGESTIONS.filter((w) => index.has(w)).map((w) =>
          el("button", { class: "chip", text: w, attrs: { type: "button" }, on: { click: () => this.ctx.explore(index.get(w)!) } }),
        ),
      ),
      el("button", {
        class: "link-btn",
        text: "Surprise me",
        attrs: { type: "button" },
        on: { click: () => this.ctx.explore(Math.floor(Math.random() * words.length)) },
      }),
    );
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
