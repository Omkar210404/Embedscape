import { normaliseQuery, suggest } from "../math/search";
import { el, nextId } from "./dom";

export interface ComboboxOptions {
  words: readonly string[];
  label: string;
  placeholder?: string;
  /** Keep the label for screen readers but hide it visually. */
  hideLabel?: boolean;
  /** Called with a vocabulary index once the user picks a word. */
  onSelect(index: number): void;
  /** Called when the user submits text that is not in the vocabulary. */
  onMiss?(text: string): void;
}

/** Accessible autocomplete (ARIA 1.2 combobox pattern) over the vocabulary. */
export class Combobox {
  readonly root: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private matches: number[] = [];
  private active = -1;

  constructor(private readonly opts: ComboboxOptions) {
    const listId = nextId("listbox");
    const inputId = nextId("combo");
    this.input = el("input", {
      class: "combo-input",
      attrs: {
        id: inputId,
        type: "text",
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": "false",
        "aria-controls": listId,
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
        placeholder: opts.placeholder ?? "",
      },
    });
    this.list = el("ul", { class: "combo-list", attrs: { id: listId, role: "listbox", "aria-label": opts.label } });
    this.list.hidden = true;
    this.root = el("div", { class: "combo" }, [
      el("label", { class: opts.hideLabel ? "sr-only" : "field-label", text: opts.label, attrs: { for: inputId } }),
      this.input,
      this.list,
    ]);

    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("focus", () => this.refresh());
    this.input.addEventListener("blur", () => setTimeout(() => this.close(), 120));
    this.input.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  setValue(index: number | null): void {
    this.input.value = index === null ? "" : this.opts.words[index]!;
    this.close();
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  private refresh(): void {
    this.matches = suggest(this.opts.words, this.input.value);
    this.active = -1;
    this.list.replaceChildren(
      ...this.matches.map((index, i) =>
        el("li", {
          class: "combo-option",
          text: this.opts.words[index]!,
          attrs: { role: "option", id: `${this.list.id}-${i}`, "aria-selected": "false" },
          on: {
            // mousedown, not click, so it fires before the input's blur closes the list
            mousedown: (ev) => {
              ev.preventDefault();
              this.choose(index);
            },
          },
        }),
      ),
    );
    const open = this.matches.length > 0 && document.activeElement === this.input;
    this.list.hidden = !open;
    this.input.setAttribute("aria-expanded", String(open));
    this.input.removeAttribute("aria-activedescendant");
  }

  private setActive(i: number): void {
    const items = this.list.children;
    if (this.active >= 0) items[this.active]?.setAttribute("aria-selected", "false");
    this.active = i;
    const item = items[i];
    if (!item) return;
    item.setAttribute("aria-selected", "true");
    this.input.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  private onKey(ev: KeyboardEvent): void {
    const n = this.matches.length;
    if (ev.key === "ArrowDown" && n) {
      ev.preventDefault();
      if (this.list.hidden) this.refresh();
      this.setActive((this.active + 1) % n);
    } else if (ev.key === "ArrowUp" && n) {
      ev.preventDefault();
      this.setActive((this.active - 1 + n) % n);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      this.submit();
    } else if (ev.key === "Escape") {
      this.close();
    }
  }

  private submit(): void {
    const text = normaliseQuery(this.input.value);
    if (!text) return;
    const exact = this.opts.words.indexOf(text);
    const chosen = this.active >= 0 ? this.matches[this.active] : exact >= 0 ? exact : undefined;
    if (chosen !== undefined) this.choose(chosen);
    else this.opts.onMiss?.(text);
  }

  private choose(index: number): void {
    this.setValue(index);
    this.opts.onSelect(index);
  }

  private close(): void {
    this.list.hidden = true;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
    this.active = -1;
  }
}
