# Collision Analysis Tooling

> Companion to [`collision-rollout.md`](./collision-rollout.md) (the
> experiment plan) and the
> [Action Collision Detection section of the dispatcher package README](../../packages/dispatcher/dispatcher/README.md#action-collision-detection)
> (the runtime detection-point reference). This doc is the **user guide
> for the data + analysis tooling** — how to measure where collisions
> are, see them, and turn them into actionable neighborhood policy.

## Why this exists

TypeAgent dispatches natural-language requests to typed actions. When two
agents (or two actions within one agent) are plausible matches for the
same input, the dispatcher needs a policy. Our empirical data confirms
collisions are unavoidable: of 1,856 misrouted phrases out of a 4,258-
phrase LLM-generated corpus, ~30% are structurally lost (correct schema
not even in the embedding ranker's top-K), ~34% are tunable inside
`llmSelect`, and ~35% are likely-benign same-schema cases the LLM
rescues.

The tooling described here is how we **see** that data, **measure** it
against changes, and **plan** policy work. It exists in three layers:

| Layer | Purpose | Surface |
| --- | --- | --- |
| **Detection** | Catch collisions at the four runtime points | `@config collision`, `@collision events` |
| **Measurement** | Generate a corpus of phrases, replay through the embedding ranker, classify | `@collision corpus *` |
| **Analysis** | Cluster confusable actions, preview "neighborhoods" with policy in mind | `@collision similar`, `@collision probe`, `@collision neighborhoods preview` |

The runtime detection layer is documented elsewhere; this doc covers
**measurement and analysis**.

## Detection vs. probing (analysis layer)

The analysis pipeline mixes two **offline detection methods** (NFA-product
construction and multi-vector similarity — both work from schemas alone)
with a third **probe** track that replays an LLM-authored phrase corpus
through either the embedding ranker, the LLM translator, or both. The
two detection methods are below; the probe tracks live in the corpus
section further down. All three feed the neighborhood preview from
different angles.

| | **NFA product construction** | **Multi-vector embedding similarity** |
| --- | --- | --- |
| **Lives in** | [`grammar-tools-core`](../../packages/grammarTools/core/src/) — `nfaIntersection.ts`, `collisionScanner.ts` | [`agent-dispatcher`](../../packages/dispatcher/dispatcher/src/translation/actionSimilarity.ts) — `actionSimilarity.ts` |
| **Surfaced via** | `@grammar collisions` (in-shell), `grammar-tools collisions` (CLI) | `@collision similar` (in-shell) |
| **Input** | Two compiled grammars (`Grammar` from `.ag.json`) | Action schemas — name, description, parameter shape, agent context |
| **Detects** | Sentences that **both** grammars formally accept | Actions whose **meaning** the embedding model considers similar |
| **Algorithm** | BFS over the joint NFA state pair `(qA, qB)`. A reachable accepting pair → an overlap; a witness phrase falls out of the BFS path. | Six per-vector cosine similarities (`desc`, `params`, `nameShape`, `agentContext`, `agentAndAction`, `combined`), aggregated by a named strategy (`balanced` etc.), then complete-linkage agglomerative clustering above a threshold. |
| **Output** | `CollisionScanResult` — per pair: a concrete witness token sequence + the rule each grammar matched | `ActionSimilarityScanResult` — every cross-schema pair above `keepThreshold` (0.5), with per-vector scores; clusters formed at the user's strategy threshold |
| **Strengths** | Symbolic, deterministic, exact. Witness is reproducible — paste the phrase into the shell and watch both grammars validate it. Catches lexical aliases the embedding misses. | Catches semantic neighbors the grammar can't see (`delete` ⇄ `remove`, `pause` ⇄ `stop`). Cross-agent only; needs no shared vocabulary. |
| **Weaknesses** | Cross-agent only by design (pairwise across schemas). Misses semantic overlap when grammars use disjoint vocabulary. Single-token entity validation is coarse — collisions that only emerge from multi-token entity matches aren't detected. | Fuzzy. False positives from generic verbs (`delete file` ↔ `delete email`), false negatives when descriptions are sparse. Cross-schema only — same-schema sibling clashes (`email.send` ↔ `email.reply`) are invisible. Embedding cost. |
| **Feeds…** | The actionGrammar tuning track (T1 in the rollout plan) — operator looks at witnesses, tightens `.agr` patterns, re-scans. | The neighborhood preview's `similarity` source; clusters become candidate neighborhoods. |

**What they miss together** — and why the corpus pipeline sits on top:

- **NFA** doesn't see embedding-level fuzziness.
- **Similarity** doesn't see formal grammar overlap.
- **Neither** observes what the LLM translator would actually do at runtime.

The corpus pipeline closes that gap by replaying phrases through *two
distinct probes* and comparing them. Together with similarity, they form
the **three signals that feed the neighborhood preview**:

| | **Similarity** | **Embedding probe** (S2/S3) | **Translation probe** (S4) |
| --- | --- | --- | --- |
| **What it observes** | Pure embedding distance between action **descriptions** | The embedding ranker's top-K **for an actual phrase** (the same `semanticSearchActionSchema` call `llmSelect` consumes) | The LLM translator's chosen `(schema, action)` **for an actual phrase** |
| **Phrases needed?** | No | Yes (corpus) | Yes (corpus) |
| **Closest to runtime ground truth** | Lowest | Middle — covers the candidate-selection step but stops there | Highest — also captures the LLM's pick among the candidates, which is the runtime decision |
| **Cost** | Embedding API only | Embedding API per phrase | Chat-completion API per phrase (~10× embedding) |
| **Catches** | Semantic neighbors regardless of grammar | Phrases the embedding ranker drops the right schema for | Phrases the embedding *would* rank fine but the translator still picks wrong; same-schema sibling confusions the ranker can't see |
| **Misses** | False positives from generic verbs; same-schema clashes | Anything beyond the candidate-selection step | Phrases where the embedding ranker already excluded the right schema (translator never sees it) |
| **Surfaced via** | `@collision similar` | `@collision corpus probe` | `@collision corpus translate` |

**Why a translation probe at all?** The embedding probe shows where the
ranker would feed `llmSelect` the wrong candidate set. But even when the
ranker is correct, the LLM translator can still pick the wrong action
(especially in same-schema clusters: `email.send` vs `email.reply`).
Conversely, when the ranker is *wrong* but the right schema is in the
top-K, the translator often rescues. Without a translation probe we
guess at both sides; with one we measure them.

**Bypass scope.** To observe the translator's pure verdict, the probe
runs each phrase through the translation entry point
(`translateRequest` in [translateRequest.ts](../../packages/dispatcher/dispatcher/src/translation/translateRequest.ts))
with:

- **Construction cache off** — handled by `withReadOnlySession`; otherwise stale cached translations dominate
- **Grammar match off** — `translateRequest` is the LLM-only entry point; grammar lives upstream in `requestCommandHandler.ts`, so calling `translateRequest` directly bypasses it
- **Action execution off** — `translateRequest` returns a typed `RequestAction`; the runner never hands it to any agent's `executeAction`
- **Fuzzy match off** — also lives upstream; bypassed by the same calling-pattern that bypasses grammar
- **`llmSelect` strategy forced to `first-match`** — `pickInitialSchema` runs inside `translateRequest`; without this override, `user-clarify` would short-circuit ~34% of phrases before the LLM saw them. The runner snapshots the prior strategy and restores it in a `finally`. Future runs will sweep multiple strategies (`--strategy user-clarify`, etc.) to compare policies.

This makes the probe read-only with respect to TypeAgent state (same
guarantee as `@collision corpus probe`), at the cost of a chat completion
per phrase (~$0.05–0.10 per phrase × ~4k phrases = single-digit dollars
for a full run; not a concern per the project's "API cost is not a
constraint" stance).

The runtime path *also* has four collision detection points (`static`,
`grammarMatch`, `llmSelect`, `fuzzy` — see the
[Action Collision Detection section of the dispatcher package README](../../packages/dispatcher/dispatcher/README.md#action-collision-detection)
for that surface). Those fire while a request is being routed; the
methods above are the offline-analysis siblings that surface candidates
*before* any user types a phrase.

## End-to-end pipeline

```
@collision corpus generate           ── LLM phrase corpus (~4-5k phrases)
        │                                 corpus.json
        ├──────────────┐
        ▼              ▼
   embedding probe  translation probe (planned)
@collision corpus    @collision corpus
        probe              translate
        │                  │  (LLM translator, cache/grammar/exec/fuzzy off)
        │                  │  translation-results.json
        ▼
        probe-results.json
        ▼
@collision corpus reanalyze          ── prefix-aware reclassification
        │                                 probe-results-reclassified.json
        ▼
@collision corpus visualize          ── interactive heatmap + sankey + edges
        │                                 collisions-viz.html
@collision corpus recovery           ── runtime-aware bucket analysis (text + summary)
@collision corpus visualize-recovery ── interactive recovery breakdown
        │                                 recovery-viz.html
@collision corpus run                ── orchestrates the embedding-probe pipeline above

@collision similar                   ── multi-vector embedding clustering of actions
@collision probe "<phrase>"          ── what would the embedding ranker say?
@collision neighborhoods preview     ── union of similarity + embedding-probe
                                          (+ translation-probe when present) → HTML
                                          neighborhoods-preview.html
```

All artifacts land under `<instanceDir>/collisions/` by default
(`~/.typeagent/profiles/<profile>/collisions/`).

## Quick start

```text
# 1. (one-time) generate a phrase corpus and probe it.  Slow: ~12 min
#    on the full 65-schema set.  Defaults are sensible.
@collision corpus run

# 2. open the misroute-hotspot map
start <instanceDir>/collisions/collisions-viz.html

# 3. open the runtime-aware recovery breakdown
start <instanceDir>/collisions/recovery-viz.html

# 4. preview the action neighborhoods (similarity + corpus)
@collision neighborhoods preview
start <instanceDir>/collisions/neighborhoods-preview.html
```

To probe one phrase by hand without the full pipeline:

```text
@collision probe "turn on wifi" -e desktop.EnableWifi --include-inactive
```

## Generating the reports

Two interactive HTML reports drive most of the analysis work. Both land in
`<instanceDir>/collisions/` by default (`~/.typeagent/profiles/<profile>/collisions/`)
unless you pass `--out` or `--workdir`.

### Collision hotspots report (`collisions-viz.html`)

The full corpus pipeline produces this. The same source data also yields a
sibling artifact, `recovery-viz.html` (runtime-aware bucket analysis), so
you get both reports for the price of one orchestrator run.

```text
@collision corpus run
```

That single command sequences:

1. `corpus generate` — LLM-authored phrase corpus → `<workdir>/corpus.json`
2. `corpus probe` — replay through the embedding ranker → `<workdir>/probe-results.json`
3. `corpus reanalyze` — prefix-aware reclassification → `<workdir>/probe-results-reclassified.json`
4. `corpus visualize` — heatmap + sankey + edge table → **`<workdir>/collisions-viz.html`**
5. (orchestrator also writes `<workdir>/recovery-viz.html` via `corpus visualize-recovery`)

Common knobs:

| Flag | Purpose |
| --- | --- |
| `--schemas player,localPlayer` | Restrict corpus generation to a subset of schemas |
| `--models GPT_4_1` | Limit which chat-model names generate phrases (default uses all configured) |
| `--concurrency 16` | Bump parallelism (default 8); `corpus probe` is now `pmap`-parallel and scales close to linearly until the embedding API rate-limits |
| `--from probe` | Skip generation, reuse existing `corpus.json` |
| `--from visualize` | Cheapest re-render — just rebuild the HTML from existing reclassified results |
| `--sankey-top 100` | Show more sankey edges in the hotspot map |

If you'd rather drive the stages individually:

```text
@collision corpus generate    # ~12 min for the full set, parallelized
@collision corpus probe       # ~2 min at concurrency 8
@collision corpus reanalyze   # seconds — pure transform
@collision corpus visualize   # seconds — pure transform
```

Open the report:

```text
start <instanceDir>/collisions/collisions-viz.html
```

### Ambiguity neighborhood report (`neighborhoods-preview.html`)

Builds an in-memory merge of the similarity scan + embedding-probe
results and writes a one-shot HTML preview. **No persistence beyond the
file itself** — the index isn't saved, no runtime hooks fire. Phase 0
of the neighborhoods rollout (see
[`collision-rollout.md`](./collision-rollout.md)). Translation-probe
results (`translation-results.json`) will fold in here as the third
source once `@collision corpus translate` lands; until then the page
shows two sources.

```text
# (recommended) make sure a corpus probe-results file is in the workdir,
# so the preview can surface empirical evidence alongside similarity:
@collision corpus run

# Build the preview:
@collision neighborhoods preview
```

The preview command also works with similarity-only data — if the corpus
file is missing, it surfaces fewer neighborhoods and tells you so on the
shell.

Common knobs:

| Flag | Purpose |
| --- | --- |
| `--strategy balanced` | Similarity strategy (run `@collision list-strategies` for options) |
| `--threshold 0.65` | Cluster threshold for similarity-driven neighborhoods (default 0.78). The page also has a separate **confirm-threshold slider** that retags corpus pairs as `both` based on their pair score — drag it without re-running |
| `--corpus <path>` | Override default corpus location; defaults to `<workdir>/probe-results-reclassified.json` |
| `--min-misroute 3` | Drop weak corpus edges with fewer than N occurrences |
| `--include-same-schema=false` | Skip same-schema sibling neighborhoods |
| `--no-cache` | Bypass the on-disk embedding cache (force re-embed) |
| `--out custom.html` | Non-default output path |
| `--workdir <dir>` | Non-default workdir (overrides the `<instanceDir>/collisions/` default) |

Open the report:

```text
start <instanceDir>/collisions/neighborhoods-preview.html
```

The page is interactive at every level:

- **Headline summary** with kind / source / agent counts
- **Filterable list** with search, kind / source / size dropdowns, expandable rows showing actual misrouted phrases
- **Confirm-threshold slider** for live retagging of `corpus`-only neighborhoods as `both` when their cross-schema embedding similarity meets the slider value
- **Hierarchical edge bundling chart** filling the browser width, with a `Show full path` toggle and a centered floating phrase panel that appears when you hover any action label

## `@collision` command reference

### Telemetry / events

| Command | Purpose |
| --- | --- |
| `@collision events [-n N] [-k <kind>]` | Show recent runtime events from the in-memory ring buffer; ⚡ marks rows where the chosen candidate diverged from `first-match`. Backed by per-session JSONL at `<sessionDir>/collision-events.jsonl` and (if `@config log db on`) Cosmos `dispatcherlogs`. |

### Action similarity (S1)

`@collision similar` computes pairwise multi-vector embedding similarity
across every loaded cross-schema action pair and groups the surviving
edges into clusters. Useful for spotting actions that *look* similar to
the embedding model regardless of whether they actually misroute.

| Command | Purpose |
| --- | --- |
| `@collision similar [-s <strategy>] [-t <threshold>] [--all-strategies] [--pairs] [-n <top>] [--json <path>] [--no-cache]` | Run the scan and render an HTML cluster (or pair) view. `--all-strategies` renders a comparison table; `--json` writes a structured scan + applied-strategy result. |
| `@collision list-strategies` | List the named strategies (`balanced`, `desc`, `params`, `nameShape`, `agentContext`, `agentAndAction`). |

The on-disk embedding cache is keyed by content hash and lives at
`<instanceDir>/agentCache/actionSimilarity/embeddings.json` so subsequent
runs are fast.

### Single-phrase probe

`@collision probe` calls the same `semanticSearchActionSchema` ranker
that `llmSelect` consumes at runtime. Lets you ask "what *would* the
embedding pick for this phrase?" without running the full translation
pipeline.

| Command | Purpose |
| --- | --- |
| `@collision probe "<phrase>" [-e schema.action] [-n top] [--delta n] [--include-inactive]` | Render the top-K candidates with scores + Δ-to-next; flags rows that match `--expected` and marks the verdict CLEAN / AMBIGUOUS / FAIL. |

### Corpus pipeline (S2 / S3)

The corpus pipeline is how we measure dispatch ambiguity at scale: ask
LLMs to write user utterances for every action, replay them through the
embedding ranker, classify each phrase, and visualize.

| Command | Purpose |
| --- | --- |
| `@collision corpus generate [--schemas …] [--models …] [--styles …] [--concurrency N] [--out …] [--workdir …]` | LLM-authored phrase corpus. Default 3 styles × 3 models per action across all loaded schemas (~12 min for the full set). Available styles: `imperative`, `conversational`, `casual` (default trio); opt-in `polite` (effusive), `curt` (rude/terse), `slang` (idioms), `typos` (natural mistypes). Pass any subset/expansion via `--styles a,b,c`. Multi-step phrases (`open X then Y`) are out of scope here — they need a different eval frame and will land separately. |
| `@collision corpus probe [--in …] [--out …] [--top N] [--delta n] [--workdir …]` | Replay a corpus through `semanticSearchActionSchema` (embedding ranker only). Each phrase classified CLEAN / TIGHT / MISROUTE. |
| `@collision corpus translate [--in …] [--out …] [--workdir …] [--concurrency N] [--strategy first-match] [--max-phrases N] [--model-label …]` | Replay a corpus through the **LLM translator** with the construction cache, grammar matcher, action execution, and fuzzy collision path all bypassed. Captures `(chosenSchema, chosenAction)` per phrase. Forces `--strategy first-match` by default (suppresses user-clarify short-circuit so we always see the translator's verdict; future runs will sweep). Output: `translation-results.json` with outcome buckets CLEAN / MISROUTE / CLARIFY / INVALID / ERROR. Distinct from the embedding probe — see the three-signals table above. |
| `@collision corpus reanalyze [--in …] [--out …] [--delta n] [--workdir …]` | Prefix-aware reclassification — recovers misroutes that were just naming differences (`Debug` vs `DebugAutoShellAction`). |
| `@collision corpus recovery [--in …] [--delta n] [--workdir …]` | Runtime-aware decomposition of MISROUTE results: same-schema (likely-benign) vs cross-schema in-cluster (`llmSelect`-tunable) vs cross-schema out-of-cluster (widen threshold) vs cross-schema off-list (structural). HTML + text in the shell. |
| `@collision corpus visualize [--in …] [--out …] [-n top] [--workdir …]` | Interactive HTML hotspot view — schema heatmap, top-N action sankey, filterable misroute-edge table. |
| `@collision corpus visualize-recovery [--in …] [--out …] [--delta n] [--workdir …]` | Interactive recovery breakdown: stacked bar of the four runtime buckets, per-action profile, action-rank histogram, click-to-filter, click-row-to-expand-phrases. |
| `@collision corpus run [--from <step>] [--workdir …] [pass-through args]` | Orchestrator. `--from <step>` resumes at `generate` / `probe` / `reanalyze` / `visualize` so you don't re-pay LLM cost when iterating on later stages. |

### Neighborhoods (analysis layer)

`@collision neighborhoods preview` is **Phase 0** of the neighborhood
work — see the design in
[`collision-rollout.md`](./collision-rollout.md). It merges the
similarity scan with the corpus probe results into a preview HTML; **no
persistence, no runtime hooks.** Phase 1+ will add a persisted index,
per-neighborhood policy, runtime resolution, and incremental updates.

| Command | Purpose |
| --- | --- |
| `@collision neighborhoods preview [--strategy] [--threshold] [--corpus] [--min-misroute] [--include-same-schema] [--no-cache] [--out …] [--workdir …]` | Build neighborhoods in-memory from current similarity + corpus data; write an interactive HTML viz with a confirm-threshold slider, filterable table with phrase samples, and a hierarchical edge-bundling chart. |

### Static grammar collisions (separate track)

`@grammar collisions` is the NFA-product-construction static scanner for
grammar-level cross-agent overlap. Documented in the
[actionGrammar README](../../packages/actionGrammar/README.md) and the
dispatcher package README. Runs independently of the runtime detection
layer.

## Visualizations

Each of the three HTML reports is **self-contained** (D3 from CDN; no
server) and lives under `<instanceDir>/collisions/`. Open in any browser.

### `collisions-viz.html` — misroute hotspot map

What ranker top-1's wrong, viewed three ways:

- **Schema × schema heatmap** — rows = expected schemas, cols = actual
  top-1 schemas, cell color = misroute count. Diagonal toggle hides
  within-agent. Click a cell to filter the table below; hover for the
  top action pairs in that schema-pair.
- **Top-N action sankey** — expected → actual with width = phrase count,
  links colored by source agent, click-to-filter legend chips.
- **Filterable misroute edge table** — every edge with sample phrases on
  expand (with model + style annotations).

Built by `@collision corpus visualize`. Sized at ~470 KB.

### `recovery-viz.html` — runtime-aware recovery analysis

Where in the runtime pipeline does each misroute land?

- **Headline stacked bar** of the four runtime buckets:
  same-schema (likely-benign) / cross in-cluster (`llmSelect`-tunable) /
  cross out-of-cluster (widen threshold) / cross off-list (structural).
  Click a segment to filter the views below.
- **Per-action profile** — every action one row with bucket mix bar.
  Sortable by total / cross-rescuable / off-list / benign-pct. Toggle
  to per-agent rollup. Click a row to expand the actual misrouted
  phrases.
- **Action-rank histogram** — secondary view: where does the expected
  action rank in the embedding's top-K? Embedding-calibration view, not
  the runtime story.
- **Verdict callout** flips green / red based on whether same-schema or
  cross-off-list dominates.

Built by `@collision corpus visualize-recovery`. Sized ~730 KB.

### `neighborhoods-preview.html` — ambiguity action neighborhoods

What clusters do we see when similarity + corpus data are merged?

- **Filterable list** of candidate neighborhoods with kind / source /
  size badges, sample phrases on expand. **Top offender column** shows
  the worst-offender member per neighborhood with a `⇣N` count
  (`owedTraffic` — how many phrases that action lost to its partners).
  Sortable by top-offender owed traffic. When translator-probe data is
  loaded, a 🛑 marker prefixes the count and the value switches to
  `endUserOwedTraffic` (CONFIRMED + NEW_FAILURE) — ground-truth
  user-visible misroutes rather than upstream ranker signal.
- **Members ranked by gravity** table inside each expanded
  neighborhood, with columns: owed · stolen · partners · entangle ·
  weighted · share. Translator columns (tx-owed · recovery% · tier)
  appear when translator data is loaded.
- **Confirm-threshold slider** that retags corpus-only cross-schema
  pairs as "both" when their embedding similarity meets the slider value.
  Updates summary counts, list filters, and edge colors live without
  rebuilding.
- **Hierarchical edge bundling chart** — full-width radial layout, every
  action a leaf organized by `agent → schema → action`. Curves bundle
  through common parents; hover an action label (or its hit-area) to
  focus on its edges and surface a centered floating panel of the actual
  phrases involving that action, scrollable when there are many. Toggle
  full-path labels with the `Show full path` checkbox.
- **Misroute force graph** — d3 force simulation (modeled after the
  [Observable example](https://observablehq.com/@d3/force-directed-graph/2)).
  Each node is one action (deduplicated across neighborhoods); node
  radius = gravity (default `owedTraffic`, with a "Sort/size by"
  dropdown for `stolen` / `entanglement` / `weightedConfusion` /
  `endUserOwed`). Link width scales with edge count; arrows show
  direction (`from → to`). Drag to reposition, hover to dim
  non-connected nodes/links and surface a tooltip with the full
  per-action gravity scores. When translator data is loaded, the
  "Color by severity" toggle flips node color from neighborhood-
  categorical to traffic-light tier (blocker = red, leaky = amber,
  clean = green) and NEW_FAILURE links render in purple.

Built by `@collision neighborhoods preview`. Sized ~360 KB.

#### Per-action gravity scores

Inside each neighborhood, each member carries a per-action **gravity** —
how much pain that one action is causing. Computed by
[`actionGravity.ts`](../../packages/dispatcher/dispatcher/src/neighborhoods/actionGravity.ts).
Available scores:

| Score | Meaning |
| --- | --- |
| `owedTraffic` | Σ count where the action is the `from` of a ranker misroute. Phrases meant for it that went elsewhere. **Default primary score.** |
| `stolenTraffic` | Σ count where the action is the `to`. Phrases meant for others that landed on it. |
| `partners` / `entanglement` | Distinct partners with any edge, plus a bonus per bidirectional pair. Higher = more structurally confused. |
| `weightedConfusion` | `Σ count × similarity(from, to)` — empirical volume × semantic similarity. Where corpus + embeddings agree. |
| `shareInNeighborhood` | `owedTraffic / Σ owedTraffic` for the neighborhood. |
| `endUserOwedTraffic` | (translator-only) Σ CONFIRMED + NEW_FAILURE outflow — ground-truth user-visible misroutes. **Becomes the primary score when translator data is loaded.** |
| `translatorRecoveryRate` | (translator-only) `RESCUED / (RESCUED + CONFIRMED)`. High = LLM bails the ranker out (cosmetic problem). Low = ranker misroutes correlate with real harm. |
| `severityTier` | (translator-only) `blocker` / `leaky` / `clean`. Drives node color in the force graph. |

The `--translator-corpus <path>` flag (default
`<workdir>/probe-results-translated.json`) is forward-compatible with
the planned translation-mode probe described above. Today it's a no-op;
when the pipeline ships, the translator-derived columns and color
encodings light up automatically.

The `--samples-per-category <N>` flag (default 5) controls the
per-category sample cap on edge phrase samples. With translator
categories tagged, a heavy edge can carry up to 4 × N samples
(CONFIRMED / RESCUED / NEW_FAILURE / CLEAN). Dial up when triaging a
specific high-traffic edge.

## Code map

### Runtime detection (existing)

- [`appAgentManager.ts`](../../packages/dispatcher/dispatcher/src/context/appAgentManager.ts) —
  `static` collision scanner at registration time
- [`matchCollision.ts`](../../packages/dispatcher/dispatcher/src/translation/matchCollision.ts) —
  `grammarMatch` resolution
- [`translateRequest.ts`](../../packages/dispatcher/dispatcher/src/translation/translateRequest.ts) —
  `llmSelect` resolution (the embedding-ranker schema picker)
- [`fuzzyCollision.ts`](../../packages/dispatcher/dispatcher/src/translation/fuzzyCollision.ts) —
  `fuzzy` (scaffolded; placeholder scorer)
- [`collisionTelemetry.ts`](../../packages/dispatcher/dispatcher/src/context/collisionTelemetry.ts) —
  `CollisionEvent` shape + ring buffer + JSONL + Cosmos hooks

### Analysis engines (this work)

- [`actionSimilarity.ts`](../../packages/dispatcher/dispatcher/src/translation/actionSimilarity.ts) —
  multi-vector embedding similarity scan + clustering
- [`translationProbeRunner.ts`](../../packages/dispatcher/dispatcher/src/translation/translationProbeRunner.ts) —
  pure runner for the LLM-translator probe (Phase 3, third signal). Calls
  `translateRequest` per phrase under a `first-match` strategy override and
  records the typed action the translator picked.
- [`neighborhoods/types.ts`](../../packages/dispatcher/dispatcher/src/neighborhoods/types.ts) —
  `Neighborhood`, `MisrouteEdge`, `PhraseSample` shapes
- [`neighborhoods/merge.ts`](../../packages/dispatcher/dispatcher/src/neighborhoods/merge.ts) —
  pure merge engine (similarity clusters + corpus pairs → neighborhoods)
- [`neighborhoods/previewViz.ts`](../../packages/dispatcher/dispatcher/src/neighborhoods/previewViz.ts) —
  preview HTML renderer (slider + bundling chart + floating phrase panel)

### Command handlers

- [`collisionCommandHandlers.ts`](../../packages/dispatcher/dispatcher/src/context/system/handlers/collisionCommandHandlers.ts) —
  `@collision events / similar / probe / list-strategies`, plus the table
  that wires `corpus` and `neighborhoods` subcommand groups
- [`collisionCorpusHandlers.ts`](../../packages/dispatcher/dispatcher/src/context/system/handlers/collisionCorpusHandlers.ts) —
  every `@collision corpus *` subcommand + the visualize/recovery HTML
  generators
- [`collisionNeighborhoodHandlers.ts`](../../packages/dispatcher/dispatcher/src/context/system/handlers/collisionNeighborhoodHandlers.ts) —
  `@collision neighborhoods preview`

### Operational scripts

- [`packages/defaultAgentProvider/src/collisions/`](../../packages/defaultAgentProvider/src/collisions/) —
  TypeScript scripts that boot a read-only dispatcher and exercise the
  command surface (smoke test, hand-edited probe runner, env-key
  inventory). Live in `defaultAgentProvider` because the dispatcher
  package can't depend back on it (would form a workspace cycle).
  Built via `pnpm run build default-agent-provider`; run from `ts/`:
  ```
  node packages/defaultAgentProvider/dist/collisions/smokeTest.js
  node packages/defaultAgentProvider/dist/collisions/probeRunner.js
  node packages/defaultAgentProvider/dist/collisions/listModels.js
  ```

## Configuration & telemetry

The runtime detection points and the resolution strategies are
configured via `@config collision …`; events flow into the ring buffer,
per-session JSONL, and (when `@config log db on`) Cosmos
`telemetrydb / dispatcherlogs` with `eventName: "collision"`. **All of
this is documented in detail** in the
[Action Collision Detection section of the dispatcher package README](../../packages/dispatcher/dispatcher/README.md#action-collision-detection)
— including the full `CollisionConfig` schema, the four-strategy
behavior, and the Cosmos query reference.

## Where it's going

[`collision-rollout.md`](./collision-rollout.md) is the canonical
record. The current state and the path forward in one paragraph:

- Phases 0 and analysis tooling above: shipped.
- **Phase 1**: persisted neighborhood index + per-neighborhood policy
  overrides + operator commands (`build`, `inspect`, `policy set`).
- **Phase 2**: runtime resolver (`resolveNeighborhood`) hooked into
  `pickInitialSchema` and `resolveGrammarCollision`, off by default,
  telemetry includes `neighborhoodId` / `tierReached`.
- **Phase 3**: async incremental updates via a `NeighborhoodWorkQueue`
  mirroring `ExplainWorkQueue`, plus onboarding-reindex when new
  agents register.
- **Phase 4**: same-schema runtime hook (post-LLM-translation).
- **Phase 5**: tier-escalation viz once telemetry data is in.

## Safety notes

Every analysis command in this doc is **read-only against TypeAgent
state**. The corpus/neighborhood pipeline:

- Calls `semanticSearchActionSchema` (a pure embedding lookup; no cache
  writes, no action dispatch, no translation).
- Wraps the long-running command body in a `withReadOnlySession()`
  guard that disables the construction cache for the duration of the
  work and restores the prior setting in a `finally` (belt-and-
  suspenders on top of the underlying read-only APIs).
- Never invokes any agent's `executeAction`.
- Writes only to the workdir (`<instanceDir>/collisions/` by default).

You can run the pipeline while using your computer; nothing here will
click, type, or otherwise act on your behalf.
