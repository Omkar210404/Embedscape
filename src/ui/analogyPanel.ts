import { analogy } from "../math/vectors";
import { ANALOGY_PRESETS, type AnalogyPreset } from "../presets";
import { Combobox } from "./combobox";
import type { AppContext } from "./context";
import { el, fmt } from "./dom";
import { scoreBar } from "./explorePanel";

const KIND_LABEL: Record<AnalogyPreset["kind"], string> = { works: "works", fails: "fails", bias: "shows bias" };

export class AnalogyPanel {
  readonly root: HTMLElement;
  private readonly boxes: Combobox[];
  private readonly result: HTMLDivElement;
  private readonly pick: (number | null)[] = [null, null, null];

  constructor(private readonly ctx: AppContext) {
    const { words, index } = ctx.data;
    const miss = (text: string) =>
      this.result.replaceChildren(el("p", { class: "status", text: `"${text}" is not in this vocabulary.` }));
    const labels = ["A", "minus B", "plus C"];
    const hints = ["king", "man", "woman"];
    this.boxes = labels.map(
      (label, slot) =>
        new Combobox({ words, label, placeholder: `e.g. ${hints[slot]}`, onSelect: (i) => this.set(slot, i), onMiss: miss }),
    );
    this.result = el("div", { class: "analogy-result", attrs: { "aria-live": "polite" } });

    const presets = el(
      "div",
      { class: "preset-list" },
      ANALOGY_PRESETS.filter((p) => [p.a, p.b, p.c].every((w) => index.has(w))).map((p) =>
        el(
          "button",
          {
            class: `preset preset-${p.kind}`,
            attrs: { type: "button" },
            on: { click: () => this.run([index.get(p.a)!, index.get(p.b)!, index.get(p.c)!]) },
          },
          [el("span", { text: `${p.a} − ${p.b} + ${p.c}` }), el("span", { class: "kind", text: KIND_LABEL[p.kind] })],
        ),
      ),
    );

    this.root = el("section", { class: "panel-section" }, [
      el("p", {
        class: "lead",
        text: "Word arithmetic: take A, subtract B, add C, and find the words nearest the result. \"king − man + woman\" asks: what is to woman as king is to man?",
      }),
      el("div", { class: "field-row three" }, this.boxes.map((b) => b.root)),
      this.result,
      el("p", { class: "field-label", text: "Examples, including ones that fail" }),
      presets,
    ]);
  }

  run(ids: [number, number, number]): void {
    ids.forEach((id, slot) => {
      this.pick[slot] = id;
      this.boxes[slot]!.setValue(id);
    });
    this.render();
  }

  private set(slot: number, i: number): void {
    this.pick[slot] = i;
    this.render();
  }

  private render(): void {
    const [a, b, c] = this.pick;
    if (a == null || b == null || c == null) return;
    const { data } = this.ctx;
    const w = (i: number) => data.words[i]!;
    const { hits, topIncludingInputs } = analogy(data, a, b, c, 5);
    const preset = ANALOGY_PRESETS.find((p) => p.a === w(a) && p.b === w(b) && p.c === w(c));
    const inputWon = [a, b, c].includes(topIncludingInputs.index);

    this.result.replaceChildren(
      el("p", { class: "equation" }, [
        `${w(a)} − ${w(b)} + ${w(c)} ≈ `,
        el("strong", { text: w(hits[0]!.index) }),
      ]),
      el(
        "ol",
        { class: "score-list" },
        hits.map((h) =>
          el("li", {}, [
            el("button", {
              class: "word-btn",
              text: w(h.index),
              attrs: { type: "button", title: `Explore "${w(h.index)}"` },
              on: { click: () => this.ctx.explore(h.index) },
            }),
            scoreBar(h.score),
            el("span", { class: "score", text: fmt(h.score) }),
          ]),
        ),
      ),
      preset ? el("p", { class: `callout callout-${preset.kind}`, text: preset.note }) : "",
      el("p", {
        class: "fine",
        text:
          "Scores are cosine similarity to the vector A − B + C in the original 50 dimensions. The three input words are left out of the results, as is standard; " +
          (inputWon
            ? `if they were kept, the top answer would be "${w(topIncludingInputs.index)}", one of the inputs.`
            : "here the top answer is the same either way."),
      }),
    );
    this.ctx.show([hits[0]!.index], [a, b, c, ...hits.slice(1).map((h) => h.index)], { lines: false });
  }
}
