import type { Dataset } from "../data/load";
import { el } from "./dom";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function aboutPanel(data: Dataset): HTMLElement {
  const { vocab } = data;
  const b = vocab.build;
  const removed = b.vocabulary.removed_by_rule;
  const link = (href: string, text: string) => el("a", { text, attrs: { href, target: "_blank", rel: "noopener noreferrer" } });

  return el("section", { class: "panel-section prose" }, [
    el("h2", { text: "What am I looking at?" }),
    el("p", {
      text: `Each word here is stored as a list of ${vocab.dims} numbers, called an embedding or word vector. The numbers were learned from billions of words of text, so words that appear in similar sentences end up with similar numbers. Modern AI search uses the same idea: it compares meanings by comparing vectors.`,
    }),

    el("h2", { text: "How to read the map" }),
    el("ul", {}, [
      el("li", {
        text: `The globe is a lossy picture. UMAP lays the ${vocab.dims}-dimensional vectors out on the surface of a sphere, keeping close neighbourhoods roughly intact and distorting long distances. Where a group sits on the globe, and the latitude and longitude lines, mean nothing; only closeness does.`,
      }),
      el("li", {
        text: `Every score on this site (neighbours, compare, analogies) is computed on the original ${vocab.dims}-dimensional vectors, never on the globe positions.`,
      }),
      el("li", {
        text: `Colours are ${vocab.kmeans.k} k-means clusters, found on the original vectors. The glowing “continents” are simply where each group's words sit. Each cluster is named after the 3 words closest to its centre. Nobody hand-wrote these labels. The clusters are soft: the cosine silhouette score is only ${(b.clusters.silhouette_cosine_by_k[String(vocab.kmeans.k)] ?? 0).toFixed(3)}, so many words sit between clusters.`,
      }),
    ]),

    el("h2", { text: "Limits worth knowing" }),
    el("ul", {}, [
      el("li", { text: "Similar means \"used in similar contexts\". Opposites like good and bad often score high." }),
      el("li", {
        text: "The vectors learned from Wikipedia and news text up to 2014, including its biases (for example about gender and jobs). The analogy examples show one.",
      }),
      el("li", { text: "One vector per word: \"bank\" (river) and \"bank\" (money) share a single point." }),
      el("li", {
        text: `Only ${vocab.count.toLocaleString("en")} common words are included. Rare words, numbers and words under 3 letters are missing.`,
      }),
      el("li", { text: "This is a 2014 model with 50 dimensions. Modern models are far larger and handle context; this one is small enough to explore by hand." }),
    ]),

    el("h2", { text: "How it was built" }),
    el("ul", {}, [
      el("li", {
        text: `The first ${b.vocabulary.rows_examined.toLocaleString("en")} GloVe rows (sorted by frequency) were read and filtered down to ${b.vocabulary.words_kept.toLocaleString("en")} words. Removed: ${removed.not_alphabetic} tokens with digits or punctuation, ${removed.too_short} under 3 letters, ${removed.stop_word} stop words and ${removed.blocklisted} offensive terms (from a documented blocklist).`,
      }),
      el("li", {
        text: `Vectors are stored as 8-bit integers to keep the download small. Measured cost: cosine scores shift by at most ${b.quantisation.cosine_abs_error_max.toFixed(4)} (mean ${b.quantisation.cosine_abs_error_mean.toFixed(4)}), and on average ${pct(b.quantisation.top10_neighbour_overlap_mean)} of each word's top-10 neighbours are the same as with full precision.`,
      }),
      el("li", { text: "Everything runs in your browser. No server, no tracking, no cookies, nothing you type leaves this page." }),
    ]),

    el("h2", { text: "Credits" }),
    el("p", {}, [
      "Word vectors: ",
      link(vocab.source.url, "GloVe"),
      ` by ${vocab.source.authors} (2014), ${vocab.source.name}, under the `,
      link(vocab.source.licence_url, vocab.source.licence),
      ".",
    ]),
    el("p", {}, [
      "Offensive-word filtering uses the ",
      link("https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words", "LDNOOBW list"),
      " (CC BY 4.0) plus a small supplement. 3D rendering by ",
      link("https://threejs.org/", "three.js"),
      " (MIT).",
    ]),
  ]);
}
