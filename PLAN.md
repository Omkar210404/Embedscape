# embedscape — PLAN

> Walk through the meaning of words.

An interactive 3D explorer of word embeddings. About 5,000 common English words float in 3D space,
and words with similar meanings sit close together. You can search, fly to a word, see its nearest
neighbours, compare two words and try analogies. All the maths runs on the original 50-dimensional
vectors. The 3D view is only a picture of them, and it loses information.

Status: **approved 2026-10-15 and built.** The decisions taken during the build are listed in §10.

---

## 1. Environment (checked 2026-10-15)

| Item | Found | Note |
|---|---|---|
| Python | 3.11.9 | numpy present; scikit-learn and umap-learn not installed, so I will use a venv in `pipeline/.venv` |
| Node / npm | 22.16.0 / 10.9.2 | fine for Vite 5/6, Three.js and Vitest |
| git | 2.49 | repo initialised on `main` |
| Network | OK | Stanford, Hugging Face and npm all reachable |
| Disk | 33 GB free | the GloVe zip is 862 MB, cached outside git |
| CPU | 12 cores, no GPU needed | UMAP on 5k × 50 takes seconds to a minute |

## 2. Data source and licence (verified)

- **GloVe 6B, 50d** (Pennington, Socher and Manning, 2014), trained on Wikipedia 2014 + Gigaword 5, 400k-word lowercased vocabulary.
- **Licence: ODC Public Domain Dedication and License (PDDL) v1.0.** I checked this today on
  https://nlp.stanford.edu/projects/glove/ ("Pre-trained word vectors. This data is made available under
  the Public Domain Dedication and License v1.0"). The GloVe *code* is Apache-2.0, but we do not use it.
  The README and the site's About panel will give the credit, the citation and the licence link.
- Download: the official `glove.6B.zip` (862,182,613 bytes) from `downloads.cs.stanford.edu`. Only
  `glove.6B.50d.txt` is extracted from it. The pipeline caches the zip in `pipeline/.cache/`
  (gitignored) and checks its SHA-256. I will record the hash after the first real download. The raw
  vectors are never committed.
- **Frequency:** GloVe's file is sorted by corpus frequency, so "most common" means "first N rows that
  pass the filters". No second word-frequency source is needed. I will check the ordering when I build
  it and report what I find.

## 3. Pipeline (Python, offline, run once, outputs committed)

```
glove.6B.zip ─► read 50d rows in frequency order
             ─► filter (rules below) ─► first 5,000 survivors
             ─► L2-normalise ─► int8 quantise (per-vector scale) ─► measure error
             ─► UMAP 50d→3d (cosine, random_state=42)
             ─► k-means on normalised 50d vectors (random_state=42, n_init=10)
             ─► cluster names = 3 words closest to each centroid
             ─► calibrate "Compare" thresholds from the real similarity distribution
             ─► write public/data/* + stats.json (every number the README quotes)
```

**Filters.** Every rule is documented in the README, and the build reports how many words each rule removed.
1. The token must be all lowercase ASCII letters `a–z`. This removes numbers, punctuation, hyphenated and accented tokens.
2. The token must be at least 3 letters long. This removes short fragments like `st`, `mr` and `jr`. (It also removes real words like `go` and `tv`, which I will list as a known limitation.)
3. English stop words are removed (scikit-learn's `ENGLISH_STOP_WORDS` list). Words like `the` and `of` carry little meaning and crowd the most common rows. **This filter goes beyond what you asked for, so please approve or veto it.**
4. Offensive words are removed by exact token match against `pipeline/blocklist/`. The base list is LDNOOBW
   (English). I will confirm its CC-BY-4.0 licence before vendoring it, and credit it. I will add a short
   hand-reviewed supplement for slurs it misses. The README will list the categories removed: profanity,
   sexual or explicit terms, and racial, ethnic, religious, homophobic, transphobic and ableist slurs.
   Exact matching means innocent words are not removed just because they contain a bad substring. No
   blocklist is complete, and the README will say so.

**Compact format.** Sizes are estimates. I will measure and report the real ones.

| File | Contents | Raw size (est.) |
|---|---|---|
| `vectors.bin` | 5000 × 50 int8, plus 5000 float32 per-vector scales | ~270 KB |
| `layout.bin` | 5000 × 3 float32 positions, plus 5000 uint8 cluster ids | ~65 KB |
| `vocab.json` | words, cluster names, calibrated thresholds, metadata | ~50 KB |

**Quantisation honesty.** `stats.json` will report the maximum and mean absolute error per component.
More usefully, it will also report the effect on results: the largest change in cosine similarity over
all word pairs, and how often the top-10 neighbour lists stay the same before and after quantisation.

**Clusters.** k is fixed (proposed: 20). The build also records the silhouette score for
k ∈ {12, 16, 20, 24, 32} so the choice can be checked. Silhouette scores for word vectors are usually
low, and I will report whatever the real numbers are. Each cluster is named by its 3 most central words,
for example "cluster 7: france · italy · spain". These names are never written by hand.

**Compare thresholds.** These are not invented. They come from the measured cosine similarity distribution:
- "very close": at or above the median similarity of a word's top-1 neighbour.
- "related": at or above the 99th percentile of random word pairs.
- "loosely related": at or above the 90th percentile of random word pairs.
- "unrelated": anything below that.

The panel will also show "more similar than X% of random word pairs".

**Tests (pytest).** These run on tiny synthetic vector files and never download anything. They cover:
- filter rules
- blocklist exact matching
- quantise and dequantise error bounds
- binary layout round-trip
- cluster naming rule
- determinism: two builds with the same seed produce identical bytes

## 4. Front end (TypeScript, Vite, Three.js, no UI framework)

- **Scene.** A single `THREE.Points` draw call with a custom shader: soft round sprites, size falls off
  with distance, and exponential depth fog. The background is near-black blue with muted cluster colours,
  with no neon, bloom or starfield. Navigation uses OrbitControls with damping, which handles zoom and
  touch. Hovering a point shows its word. Labels (CSS2DRenderer) appear only for the focused word and its
  10 neighbours. Neighbour lines are drawn as thin `LineSegments`.
- **Fly-to.** The camera position and orbit target ease over about 1.2 s. With `prefers-reduced-motion`, the camera cuts instantly instead.
- **Search.** An accessible combobox (ARIA, keyboard navigation) that matches prefixes in the vocabulary.
  If a word is not in the 5,000, the app says so plainly and does not guess.
- **Neighbours.** A side panel lists the top 10 by cosine similarity with scores. Clicking a neighbour flies to it.
- **Compare.** Two word inputs. The panel shows the cosine score, the plain-English reading, the
  percentile, and the note "scores depend on this model and vocabulary".
- **Analogy.** `A − B + C = ?` uses 3CosAdd on normalised vectors and shows the top 5 results, excluding
  A, B and C, with scores. There are preset examples. **I will only ship a preset after running it on the
  real data.** This includes at least one honest failure and one that shows learned social bias (see §7).
- **"How to read this" panel.** It explains that:
  - the 3D layout is a lossy UMAP projection
  - distances on screen are only roughly faithful
  - all scores come from the original 50d vectors
  - the vectors carry biases from news and Wikipedia text
- **No-WebGL fallback.** Search, neighbours, compare and analogy all work without the 3D scene. Only the
  scene is hidden.
- **Mobile.** The side panel becomes a bottom sheet. There is no horizontal scrolling.
- **Maths module.** `src/math/` contains pure functions with no Three.js imports. All results are exact
  brute-force dot products over 5,000 × 50 dequantised floats (under a millisecond).

**Tests.**
- Vitest covers the maths: cosine, top-k, analogy exclusion, dequantise, threshold reading, the
  autocomplete matcher, and the data loader with a fixture.
- One Playwright smoke test against `vite preview`. It loads the page, searches "king", checks for 10
  neighbours, runs a compare and an analogy preset, and checks that the WebGL canvas rendered. The same
  run captures the README screenshots, so they are real.

## 5. Security, privacy and deploy

- Static site with no backend, no API keys, no analytics and no external requests at runtime. Fonts come
  from system stacks, and Three.js is bundled.
- The CSP meta tag is injected into the production build only, because Vite's dev server needs inline
  scripts:
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`
- `.github/workflows/deploy.yml`:
  1. Run pytest, Vitest, the build and Playwright.
  2. Upload the Pages artifact.
  3. Deploy.

  CI does **not** rerun the pipeline, because of the 862 MB download. It uses the committed data files.
  Vite is set with `base: '/embedscape/'`.
- No secrets exist, so there is nothing for `.env.example` to hold. brain.md requires one. **I propose to
  leave it out and say why in the README. Please approve or veto.**

## 6. File layout

```
embedscape/
├─ PLAN.md  README.md  LICENSE (MIT)  .gitignore
├─ index.html  package.json  package-lock.json  tsconfig.json  vite.config.ts  playwright.config.ts
├─ src/
│  ├─ main.ts  styles.css
│  ├─ data/load.ts                 # fetch and decode the binary files
│  ├─ math/vectors.ts neighbours.ts analogy.ts compare.ts search.ts
│  ├─ scene/scene.ts points.ts camera.ts labels.ts lines.ts
│  └─ ui/searchBox.ts neighboursPanel.ts comparePanel.ts analogyPanel.ts aboutPanel.ts
├─ public/data/vectors.bin layout.bin vocab.json
├─ tests/*.test.ts                 # vitest
├─ e2e/smoke.spec.ts               # playwright
├─ pipeline/
│  ├─ build_data.py                # CLI entry point: download → … → public/data
│  ├─ embedscape_pipeline/ download.py filters.py quantize.py layout.py clusters.py calibrate.py export.py
│  ├─ blocklist/ README.md ldnoobw-en.txt supplement.txt
│  ├─ requirements.txt (pinned)  requirements-dev.txt
│  ├─ stats.json                   # measured numbers, committed
│  └─ tests/
├─ docs/screenshots/               # real captures only
└─ .github/workflows/deploy.yml
```

## 7. Risks and how I'll handle them

| Risk | Mitigation |
|---|---|
| The 862 MB download is slow or fails | Cache it, resume with HTTP range requests, check SHA-256, keep it out of CI |
| umap-learn/numba installs badly on Windows | Use pinned wheels for 3.11. If it breaks, I will report it rather than switch method quietly |
| Classic analogies don't work on 50d GloVe with a 5k vocabulary | Only presets that were run and checked ship. Failures are shown as failures, not hidden |
| Analogies show bias (e.g. gender and jobs) | Show it openly with an explanation, and never present it as "truth" |
| Users trust distances in the 3D picture too much | Persistent "lossy projection" note, and all numbers come from 50d |
| Headless WebGL is missing in Playwright/CI | Chromium SwiftShader flags. The smoke test still checks panels if the canvas is unavailable, and says so |
| Blocklist misses terms or catches innocent words | Exact matching, a reviewed supplement, and the gap stated in the limitations |
| Download size grows past the target | Measure the gzip size of the full `dist/` and the data files and report it. Target is under 1 MB gzipped in total |

## 8. Build order (after approval)

1. Pipeline: venv, download and cache, filters, blocklist, then the full build. Run pytest and inspect the outputs by hand.
2. Front end maths and loader, with Vitest.
3. Scene: points, fog, orbit, picking, fly-to, labels, lines.
4. Panels: search, neighbours, compare, analogy, about. Check presets on real data.
5. CSP, Pages workflow, Playwright smoke test and screenshots.
6. README (Mermaid diagram, real numbers from `stats.json`, licences and credits, limitations), then the Definition of Done check.

Commits are small and meaningful. Nothing is pushed or published to GitHub until you say so.

## 9. Open items (resolved)

1. The prompt was cut off in feature 4. I read the missing part as "show an honest note about limits",
   which became the analogy notes, the bias preset and the "without exclusion" line.
2. Stop-word filter: kept (approved).
3. `.env.example`: left out because the project has no secrets. The README explains why.
4. 5,000 words and k = 20: kept (see §10).

## 10. Decisions made during the build

- **k = 20 kept.** Silhouette is low for every k (0.094 to 0.112). k = 24 scored slightly higher, but 20
  keeps the colours distinguishable. The README reports all values.
- **Blocklist supplement:** 8 slurs that LDNOOBW misses. 5 ambiguous words (*cracker*, *cripple*,
  *queer*, *gypsy*, *homo*) were left in on purpose, with the reasons written down.
- **Analogy presets:** I tried about 30 candidates on the real data and kept 8 (5 work, 2 fail, 1 shows
  bias). `tests/realData.test.ts` checks every claim in their notes.
- **Extra honesty features**, not in the brief:
  - a per-word "projection check" (how many true neighbours are also nearest in 3D)
  - "more similar than X% of pairs" in Compare
  - "the top answer without excluding the inputs" in Analogy
- **Front-end files** were simplified compared with §6:
  - `scene/explorer.ts` and `scene/points.ts` hold the whole 3D view
  - `math/` gained `projection.ts` and `colors.ts`
  - `ui/` gained `context.ts` and `dom.ts`
  - presets live in `src/presets.ts`
- **No-WebGL fallback** gets its own Playwright test.
- **Camera view offset:** the 3D view centres in the part of the screen the panel does not cover.
- **Label placement:** labels nudge apart instead of overlapping.
