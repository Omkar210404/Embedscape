import { pairPercentile, reading } from "../math/compare";
import { cosine } from "../math/vectors";
import { COMPARE_PRESETS } from "../presets";
import { Combobox } from "./combobox";
import type { AppContext } from "./context";
import { el, fmt } from "./dom";

export class ComparePanel {
  readonly root: HTMLElement;
  private readonly a: Combobox;
  private readonly b: Combobox;
  private readonly result: HTMLDivElement;
  private pick: [number | null, number | null] = [null, null];

  constructor(private readonly ctx: AppContext) {
    const { words, index } = ctx.data;
    const miss = (text: string) =>
      this.result.replaceChildren(el("p", { class: "status", text: `"${text}" is not in this vocabulary.` }));
    this.a = new Combobox({ words, label: "First word", placeholder: "e.g. cat", onSelect: (i) => this.set(0, i), onMiss: miss });
    this.b = new Combobox({ words, label: "Second word", placeholder: "e.g. dog", onSelect: (i) => this.set(1, i), onMiss: miss });
    this.result = el("div", { class: "compare-result", attrs: { "aria-live": "polite" } });

    const presets = el(
      "div",
      { class: "chips", attrs: { "aria-label": "Examples" } },
      COMPARE_PRESETS.filter((p) => index.has(p.a) && index.has(p.b)).map((p) =>
        el("button", {
          class: "chip",
          text: `${p.a} / ${p.b}`,
          attrs: { type: "button" },
          on: { click: () => this.run(index.get(p.a)!, index.get(p.b)!) },
        }),
      ),
    );
    this.root = el("section", { class: "panel-section" }, [
      el("p", { class: "lead", text: "How similar are two words, according to this model?" }),
      el("div", { class: "field-row" }, [this.a.root, this.b.root]),
      el("p", { class: "field-label", text: "Examples" }),
      presets,
      this.result,
    ]);
  }

  run(a: number, b: number): void {
    this.a.setValue(a);
    this.b.setValue(b);
    this.pick = [a, b];
    this.render();
  }

  private set(slot: 0 | 1, i: number): void {
    this.pick[slot] = i;
    this.render();
  }

  private render(): void {
    const [a, b] = this.pick;
    if (a === null || b === null) return;
    const { data } = this.ctx;
    const cal = data.vocab.calibration;
    const score = cosine(data, a, b);
    const read = a === b ? "very close" : reading(score, cal.thresholds);
    const pct = pairPercentile(score, cal.pair_quantiles);
    const preset = COMPARE_PRESETS.find((p) => p.a === data.words[a] && p.b === data.words[b]);

    // Presets sit below the result, so bring the new result into view.
    this.root.closest(".card")?.scrollTo({ top: 0 });
    this.result.replaceChildren(
      el("div", { class: "big-score" }, [
        el("span", { class: "big-number", text: fmt(score) }),
        el("span", { class: `reading reading-${read.replace(" ", "-")}`, text: read }),
      ]),
      el("p", {
        text: `"${data.words[a]}" and "${data.words[b]}" are ${read}. That is more similar than ${pct.toFixed(1)}% of all word pairs in this map.`,
      }),
      scale(score, cal.thresholds),
      preset?.note ? el("p", { class: "callout", text: preset.note }) : "",
      el("p", {
        class: "fine",
        text: `Scores are specific to this model (GloVe, 50 dimensions) and this vocabulary. Another model would give different numbers. The labels come from this map's own score distribution: the average random pair already scores ${fmt(cal.pair_mean)}, so a score of 0.5 is not "half similar".`,
      }),
    );
    this.ctx.show([a, b], []);
  }
}

/** A -1..1 track with the measured thresholds marked and the score as a dot. */
function scale(score: number, t: { very_close: number; related: number; loosely_related: number }): HTMLElement {
  const x = (v: number) => `${((v + 1) / 2) * 100}%`;
  const track = el("div", { class: "scale", attrs: { "aria-hidden": "true" } });
  for (const [name, v] of [
    ["loosely", t.loosely_related],
    ["related", t.related],
    ["very close", t.very_close],
  ] as const) {
    const tick = el("span", { class: "tick", attrs: { title: `${name}: ${fmt(v)}` } });
    tick.style.left = x(v);
    track.append(tick);
  }
  const dot = el("span", { class: "dot" });
  dot.style.left = x(Math.max(-1, Math.min(1, score)));
  track.append(dot);
  return el("div", { class: "scale-wrap" }, [
    track,
    el("div", { class: "scale-labels" }, [el("span", { text: "-1" }), el("span", { text: "0" }), el("span", { text: "1" })]),
  ]);
}
