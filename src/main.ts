import "./styles.css";
import { loadDataset, type Dataset } from "./data/load";
import { clusterPalette, toCss } from "./math/colors";
import { Explorer } from "./scene/explorer";
import { aboutPanel } from "./ui/aboutPanel";
import { AnalogyPanel } from "./ui/analogyPanel";
import { ComparePanel } from "./ui/comparePanel";
import { clusterName, type AppContext } from "./ui/context";
import { el } from "./ui/dom";
import { ExplorePanel, swatch } from "./ui/explorePanel";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

type TabName = "explore" | "compare" | "analogy" | "about";

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

  let explorer: Explorer | null = null;
  try {
    explorer = new Explorer(sceneEl, data, palette, {
      onPick: (i) => ctx.explore(i),
      onHover: (i, x, y) => {
        tooltip.hidden = i === null;
        if (i === null) return;
        tooltip.replaceChildren(el("strong", { text: data.words[i]! }), el("span", { text: clusterName(ctx, i) }));
        tooltip.style.left = `${x + 14}px`;
        tooltip.style.top = `${y + 14}px`;
      },
    });
  } catch {
    sceneEl.append(
      el("p", {
        class: "no-webgl",
        text: "Your browser could not start WebGL, so the 3D map is hidden. Search, neighbours, compare and analogies still work: they never needed the 3D view.",
      }),
    );
  }

  const ctx: AppContext = {
    data,
    clusterCss,
    show: (focus, neighbours, options) => explorer?.focus(focus, neighbours, options),
    explore: (i) => {
      selectTab("explore");
      explore.select(i);
      history.replaceState(null, "", `#word=${encodeURIComponent(data.words[i]!)}`);
    },
  };

  const explore = new ExplorePanel(ctx);
  const panels: Record<TabName, HTMLElement> = {
    explore: explore.root,
    compare: new ComparePanel(ctx).root,
    analogy: new AnalogyPanel(ctx).root,
    about: aboutPanel(data),
  };

  // Tabs (ARIA tabs pattern with arrow-key navigation).
  const tabList = $("#tabs");
  const panelHost = $("#panel-body");
  const names = Object.keys(panels) as TabName[];
  const tabs = names.map((name) =>
    el("button", {
      class: "tab",
      text: name[0]!.toUpperCase() + name.slice(1),
      attrs: { type: "button", role: "tab", id: `tab-${name}`, "aria-controls": `tabpanel-${name}`, "data-tab": name },
      on: { click: () => selectTab(name) },
    }),
  );
  tabList.append(...tabs);
  tabList.addEventListener("keydown", (ev) => {
    const i = names.indexOf((document.activeElement as HTMLElement)?.dataset.tab as TabName);
    if (i < 0 || (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft")) return;
    const next = names[(i + (ev.key === "ArrowRight" ? 1 : names.length - 1)) % names.length]!;
    selectTab(next);
    tabs[names.indexOf(next)]!.focus();
  });
  for (const name of names) {
    const p = panels[name];
    p.id = `tabpanel-${name}`;
    p.setAttribute("role", "tabpanel");
    p.setAttribute("aria-labelledby", `tab-${name}`);
    panelHost.append(p);
  }
  function selectTab(name: TabName): void {
    names.forEach((n, i) => {
      const on = n === name;
      tabs[i]!.setAttribute("aria-selected", String(on));
      tabs[i]!.tabIndex = on ? 0 : -1;
      panels[n].hidden = !on;
    });
    document.body.classList.remove("sheet-collapsed");
  }
  selectTab("explore");

  // Cluster legend: click a cluster to light up all its words.
  const legend = $("#legend-list");
  legend.append(
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
                const central = c.central.map((w) => data.index.get(w)!).filter((i) => i !== undefined);
                explorer?.focus([], members, { lines: false, labels: central });
              },
            },
          },
          [swatch(clusterCss[c.id]!), el("span", { text: `${c.id + 1}. ${c.central.join(" · ")}` }), el("span", { class: "count", text: String(c.size) })],
        ),
      ]),
    ),
  );

  $("#sheet-toggle").addEventListener("click", () => document.body.classList.toggle("sheet-collapsed"));

  // Keep the 3D view centred in the part of the screen the panel does not cover.
  const panel = $(".panel");
  const note = $(".honesty");
  const updateInsets = () => {
    const r = panel.getBoundingClientRect();
    if (r.left > window.innerWidth / 2) {
      explorer?.setInsets(window.innerWidth - r.left, 0);
    } else {
      // Phone layout: the bottom sheet covers the bottom, the title and note cover the top.
      explorer?.setInsets(0, Math.max(0, window.innerHeight - r.top), note.getBoundingClientRect().bottom);
    }
  };
  new ResizeObserver(updateInsets).observe(panel);
  window.addEventListener("resize", updateInsets);
  panel.addEventListener("transitionend", updateInsets);
  updateInsets();

  document.addEventListener("keydown", (ev) => {
    const typing = ev.target instanceof HTMLInputElement;
    if (ev.key === "/" && !typing) {
      ev.preventDefault();
      selectTab("explore");
      explore.search.focus();
    } else if (ev.key === "Escape" && !typing) {
      explorer?.clearFocus();
    }
  });

  // Deep links: #word=ocean
  const fromHash = () => {
    const m = /^#word=(.+)$/.exec(location.hash);
    const i = m ? data.index.get(decodeURIComponent(m[1]!).toLowerCase()) : undefined;
    if (i !== undefined) ctx.explore(i);
  };
  window.addEventListener("hashchange", fromHash);
  fromHash();

  loading.remove();
  document.body.dataset.ready = "true";
}

void start();
