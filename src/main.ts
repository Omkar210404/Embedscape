import "./styles.css";
import { loadDataset, type Dataset } from "./data/load";
import { clusterPalette, toCss } from "./math/colors";
import { EXPLORE_SUGGESTIONS } from "./presets";
import { Explorer } from "./scene/explorer";
import { aboutPanel } from "./ui/aboutPanel";
import { AnalogyPanel } from "./ui/analogyPanel";
import { Combobox } from "./ui/combobox";
import { ComparePanel } from "./ui/comparePanel";
import { clusterName, type AppContext } from "./ui/context";
import { el } from "./ui/dom";
import { ExplorePanel, swatch } from "./ui/explorePanel";
import { Tour } from "./ui/tour";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

type Mode = "explore" | "compare" | "analogy";
const MODES: Mode[] = ["explore", "compare", "analogy"];
const SEEN_INTRO = "embedscape.seenIntro";
/** UI elements that 3D labels must not be drawn underneath. */
const BLOCKERS = ".brand, .search-slot, .modes, .suggestions, .search-status, .top-actions, #card, .tour, .hud-left, .hint";

// Per-viewer convenience only; the page works the same if storage is blocked.
const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

async function start(): Promise<void> {
  const loading = $("#loading");
  let data: Dataset;
  try {
    data = await loadDataset(import.meta.env.BASE_URL);
  } catch (err) {
    loading.replaceChildren(el("p", { class: "error", text: `Could not load the word data: ${(err as Error).message}` }));
    return;
  }

  const palette = clusterPalette(data.vocab.kmeans.k);
  const clusterCss = palette.map(toCss);
  const sceneEl = $("#scene");
  const tooltip = $("#tooltip");
  const card = $("#card");
  const cardBody = $("#card-body");

  let explorer: Explorer | null = null;
  try {
    explorer = new Explorer(sceneEl, data, palette, {
      onPick: (i) => ctx.explore(i),
      onHover: (i, x, y) => {
        tooltip.hidden = i === null;
        if (i === null) return;
        tooltip.replaceChildren(el("strong", { text: data.words[i]! }), el("span", { text: `group: ${clusterName(ctx, i)}` }));
        tooltip.style.left = `${x + 14}px`;
        tooltip.style.top = `${y + 14}px`;
      },
      blockers: () =>
        // Hidden elements report an empty rectangle, so they drop out here.
        [...document.querySelectorAll(BLOCKERS)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0),
    });
  } catch {
    document.body.classList.add("no-3d");
    sceneEl.append(
      el("p", {
        class: "no-webgl",
        text: "Your browser could not start WebGL, so the globe is hidden. Search, neighbours, compare and analogies still work: they never needed it.",
      }),
    );
  }

  const ctx: AppContext = {
    data,
    clusterCss,
    show: (focus, neighbours, options) => explorer?.focus(focus, neighbours, options),
    explore: (i) => {
      setMode("explore");
      explore.select(i);
      search.setValue(i);
      status.textContent = "";
      history.replaceState(null, "", `#word=${encodeURIComponent(data.words[i]!)}`);
      refreshCard();
    },
  };

  // ---------- panels inside the floating card ----------

  const explore = new ExplorePanel(ctx);
  const compare = new ComparePanel(ctx);
  const analogy = new AnalogyPanel(ctx);
  const panels: Record<Mode, HTMLElement> = { explore: explore.root, compare: compare.root, analogy: analogy.root };
  let mode: Mode = "explore";

  const modeList = $("#modes");
  const labels: Record<Mode, string> = { explore: "Explore", compare: "Compare two words", analogy: "Word maths" };
  const tabs = MODES.map((m) =>
    el("button", {
      class: "mode",
      text: labels[m],
      attrs: { type: "button", role: "tab", id: `tab-${m}`, "aria-controls": `tabpanel-${m}`, "data-mode": m },
      on: { click: () => (m === "explore" ? showExplore() : setMode(m)) },
    }),
  );
  modeList.append(...tabs);
  modeList.addEventListener("keydown", (ev) => {
    const i = MODES.indexOf((document.activeElement as HTMLElement)?.dataset.mode as Mode);
    if (i < 0 || (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft")) return;
    const next = MODES[(i + (ev.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length]!;
    if (next === "explore") showExplore();
    else setMode(next);
    tabs[MODES.indexOf(next)]!.focus();
  });
  for (const m of MODES) {
    const p = panels[m];
    p.id = `tabpanel-${m}`;
    p.setAttribute("role", "tabpanel");
    p.setAttribute("aria-labelledby", `tab-${m}`);
    cardBody.append(p);
  }

  function setMode(m: Mode): void {
    mode = m;
    // The search box names the explored word, so it is cleared in the other tools.
    if (m !== "explore") search.setValue(null);
    MODES.forEach((n, i) => {
      const on = n === m;
      tabs[i]!.setAttribute("aria-selected", String(on));
      tabs[i]!.tabIndex = on ? 0 : -1;
      panels[n].hidden = !on;
    });
    refreshCard();
  }

  /** Explore tab: show the current word again, or the open map if there is none. */
  function showExplore(): void {
    setMode("explore");
    if (explore.current !== null) explore.select(explore.current);
    else explorer?.overview();
  }

  function refreshCard(): void {
    const open = mode !== "explore" || explore.current !== null;
    card.hidden = !open;
    document.body.classList.toggle("card-open", open);
    $("#suggestions").hidden = open || tour.active;
    card.scrollTop = 0;
    updateInsets();
  }

  function closeCard(): void {
    explore.clear();
    search.setValue(null);
    history.replaceState(null, "", location.pathname + location.search);
    setMode("explore");
    explorer?.overview();
  }
  $("#card-close").addEventListener("click", closeCard);

  // ---------- search in the top bar ----------

  const status = $("#search-status");
  const search = new Combobox({
    words: data.words,
    label: "Search a word",
    hideLabel: true,
    placeholder: `Search any of ${data.count.toLocaleString("en")} words…`,
    onSelect: (i) => ctx.explore(i),
    onMiss: (text) => {
      status.textContent = `“${text}” is not one of the ${data.count.toLocaleString("en")} words in this map. It only holds common English words; numbers, very short words, words like “the” and offensive terms were removed.`;
    },
  });
  search.input.addEventListener("input", () => (status.textContent = ""));
  $("#search-slot").append(search.root);

  $("#suggestions").append(
    el("span", { class: "try", text: "Try" }),
    ...EXPLORE_SUGGESTIONS.filter((w) => data.index.has(w)).map((w) =>
      el("button", { class: "chip", text: w, attrs: { type: "button" }, on: { click: () => ctx.explore(data.index.get(w)!) } }),
    ),
    el("button", {
      class: "chip ghost",
      text: "Surprise me",
      attrs: { type: "button" },
      on: { click: () => ctx.explore(Math.floor(Math.random() * data.count)) },
    }),
  );

  // ---------- guided tour ----------

  const word = (w: string) => data.index.get(w)!;
  const tour = new Tour({
    data,
    overview: () => {
      explore.clear();
      setMode("explore");
      explorer?.overview();
    },
    explore: (w) => ctx.explore(word(w)),
    compare: (a, b) => {
      setMode("compare");
      compare.run(word(a), word(b));
    },
    analogy: (a, b, c) => {
      setMode("analogy");
      analogy.run([word(a), word(b), word(c)]);
    },
    onEnd: () => refreshCard(),
  });
  $("#tour-slot").append(tour.root);
  const startTour = () => {
    intro.close();
    tour.start();
    refreshCard();
  };
  $("#tour-btn").addEventListener("click", startTour);

  // ---------- intro and about dialogs ----------

  const intro = $<HTMLDialogElement>("#intro");
  const about = $<HTMLDialogElement>("#about");
  intro.addEventListener("close", () => storage.set(SEEN_INTRO, "1"));
  $("#intro-tour").addEventListener("click", startTour);
  $("#intro-explore").addEventListener("click", () => intro.close());
  $("#what-btn").addEventListener("click", () => intro.showModal());
  $("#about-body").append(aboutPanel(data));
  $("#limits-btn").addEventListener("click", () => about.showModal());
  $("#about-close").addEventListener("click", () => about.close());
  for (const d of [intro, about]) {
    // Click on the backdrop closes the dialog.
    d.addEventListener("click", (ev) => ev.target === d && d.close());
  }

  // ---------- word-group legend ----------

  $("#legend-list").append(
    ...data.vocab.clusters.map((c) =>
      el("li", {}, [
        el(
          "button",
          {
            class: "legend-item",
            attrs: { type: "button" },
            on: {
              click: () => {
                const members: number[] = [];
                data.cluster.forEach((id, i) => id === c.id && members.push(i));
                const central = c.central.map((w) => data.index.get(w)).filter((i): i is number => i !== undefined);
                explorer?.focus([], members, { lines: false, labels: central });
              },
            },
          },
          [swatch(clusterCss[c.id]!), el("span", { text: c.central.join(" · ") }), el("span", { class: "count", text: String(c.size) })],
        ),
      ]),
    ),
  );

  // ---------- keep the 3D view centred in the uncovered part of the screen ----------

  const topbar = $(".topbar");
  function updateInsets(): void {
    if (!explorer) return;
    const phone = window.innerWidth <= 760;
    const r = card.hidden ? null : card.getBoundingClientRect();
    if (phone) {
      explorer.setInsets(0, r ? Math.max(0, window.innerHeight - r.top) : 0, topbar.getBoundingClientRect().bottom);
    } else {
      explorer.setInsets(r ? window.innerWidth - r.left : 0, 0);
    }
  }
  new ResizeObserver(updateInsets).observe(card);
  window.addEventListener("resize", updateInsets);

  // ---------- keyboard ----------

  document.addEventListener("keydown", (ev) => {
    const typing = ev.target instanceof HTMLInputElement;
    if (ev.key === "/" && !typing) {
      ev.preventDefault();
      search.focus();
    } else if (ev.key === "Escape" && !typing && !intro.open && !about.open) {
      if (tour.active) tour.stop();
      else if (!card.hidden) closeCard();
    }
  });

  // ---------- start ----------

  setMode("explore");
  const fromHash = () => {
    const m = /^#word=(.+)$/.exec(location.hash);
    const i = m ? data.index.get(decodeURIComponent(m[1]!).toLowerCase()) : undefined;
    if (i !== undefined) ctx.explore(i);
    return i !== undefined;
  };
  window.addEventListener("hashchange", fromHash);
  const deepLinked = fromHash();
  if (!deepLinked) explorer?.introFlight();

  loading.classList.add("done");
  setTimeout(() => loading.remove(), 600);
  document.body.dataset.ready = "true";
  if (!deepLinked && !storage.get(SEEN_INTRO)) setTimeout(() => intro.showModal(), 900);
}

void start();
