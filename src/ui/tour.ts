import type { Dataset } from "../data/load";
import { analogy, cosine } from "../math/vectors";
import { el, fmt } from "./dom";

/** What the tour drives. Each step calls these so the real panels and camera do the showing. */
export interface TourHost {
  data: Dataset;
  overview(): void;
  explore(word: string): void;
  compare(a: string, b: string): void;
  analogy(a: string, b: string, c: string): void;
  onEnd(): void;
}

interface Step {
  title: string;
  body(h: TourHost): string;
  run(h: TourHost): void;
}

const id = (h: TourHost, w: string) => h.data.index.get(w)!;
const score = (h: TourHost, a: string, b: string) => fmt(cosine(h.data, id(h, a), id(h, b)));
const answer = (h: TourHost, a: string, b: string, c: string) =>
  h.data.words[analogy(h.data, id(h, a), id(h, b), id(h, c), 3).hits[0]!.index]!;

// Every number in the text is computed live from the shipped data, never typed in.
// tests/realData.test.ts checks the claims the wording relies on.
const STEPS: Step[] = [
  {
    title: "Each glowing dot is a word",
    body: (h) =>
      `This globe holds the ${h.data.count.toLocaleString("en")} most common English words. To an AI, a word is a list of numbers (here, 50 of them) learned from billions of sentences. Words used in similar ways get similar numbers, so they end up close together on the globe. The coloured continents are word groups the computer found on its own.`,
    run: (h) => h.overview(),
  },
  {
    title: "Similar words live together",
    body: () =>
      "Here is “france”. Its nearest neighbours are other European countries, its capital and its language. Nobody told the model these are related: it worked that out from how the words are used.",
    run: (h) => h.explore("france"),
  },
  {
    title: "Closeness is a number",
    body: (h) =>
      `How close two words are is measured with a score called cosine similarity, from −1 to 1. “cat” and “dog” score ${score(h, "cat", "dog")}: very close. “computer” and “river” score just ${score(h, "computer", "river")}.`,
    run: (h) => h.compare("cat", "dog"),
  },
  {
    title: "You can do maths with meaning",
    body: (h) =>
      `Take “king”, subtract “man”, add “woman”, and the nearest word is “${answer(h, "king", "man", "woman")}”. Directions in this space can carry meaning, such as male → female. It works for some relations and fails for many others; the examples include failures too.`,
    run: (h) => h.analogy("king", "man", "woman"),
  },
  {
    title: "It learned our biases too",
    body: () =>
      "The same trick on “doctor” returns words about pregnancy, children and patients, not another doctor. The model absorbed stereotypes from the 2014 news and Wikipedia text it learned from. Real AI systems built on embeddings have to deal with this.",
    run: (h) => h.analogy("doctor", "man", "woman"),
  },
  {
    title: "Now it's your turn",
    body: () =>
      "One honest warning: the globe flattens 50 dimensions onto a surface, so some true neighbours look far apart, and where a continent sits means nothing. Every score you see is computed in the full 50 dimensions. Search any word at the top, click a dot, or spin the globe.",
    run: (h) => h.overview(),
  },
];

export class Tour {
  readonly root: HTMLElement;
  private step = 0;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly dots: HTMLElement;

  constructor(private readonly host: TourHost) {
    this.count = el("span", { class: "tour-count" });
    this.title = el("h2", { class: "tour-title", attrs: { id: "tour-title" } });
    this.body = el("p", { class: "tour-body" });
    this.dots = el("div", { class: "tour-dots", attrs: { "aria-hidden": "true" } }, STEPS.map(() => el("span")));
    this.back = el("button", { class: "btn ghost", text: "Back", attrs: { type: "button" }, on: { click: () => this.go(this.step - 1) } });
    this.next = el("button", { class: "btn primary", attrs: { type: "button" }, on: { click: () => this.advance() } });
    this.root = el(
      "section",
      { class: "tour", attrs: { role: "region", "aria-labelledby": "tour-title", "aria-live": "polite" } },
      [
        el("div", { class: "tour-head" }, [
          this.count,
          el("button", { class: "icon-btn", text: "×", attrs: { type: "button", "aria-label": "End tour" }, on: { click: () => this.stop() } }),
        ]),
        this.title,
        this.body,
        el("div", { class: "tour-foot" }, [this.dots, el("div", { class: "tour-buttons" }, [this.back, this.next])]),
      ],
    );
    this.root.hidden = true;
  }

  get active(): boolean {
    return !this.root.hidden;
  }

  start(): void {
    this.root.hidden = false;
    document.body.classList.add("touring");
    this.go(0);
    this.next.focus();
  }

  stop(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    document.body.classList.remove("touring");
    this.host.onEnd();
  }

  private advance(): void {
    if (this.step === STEPS.length - 1) this.stop();
    else this.go(this.step + 1);
  }

  private go(n: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, n));
    const s = STEPS[this.step]!;
    this.count.textContent = `Tour · ${this.step + 1} of ${STEPS.length}`;
    this.title.textContent = s.title;
    this.body.textContent = s.body(this.host);
    this.back.disabled = this.step === 0;
    this.next.textContent = this.step === STEPS.length - 1 ? "Start exploring" : "Next";
    [...this.dots.children].forEach((d, i) => d.classList.toggle("on", i === this.step));
    s.run(this.host);
  }
}
