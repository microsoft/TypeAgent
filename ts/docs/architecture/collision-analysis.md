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

## End-to-end pipeline

```
@collision corpus generate           ── LLM phrase corpus (~4-5k phrases)
        │                                 corpus.json
        ▼
@collision corpus probe              ── replay through semanticSearchActionSchema
        │                                 probe-results.json
        ▼
@collision corpus reanalyze          ── prefix-aware reclassification
        │                                 probe-results-reclassified.json
        ▼
@collision corpus visualize          ── interactive heatmap + sankey + edges
        │                                 collisions-viz.html
@collision corpus recovery           ── runtime-aware bucket analysis (text + summary)
@collision corpus visualize-recovery ── interactive recovery breakdown
        │                                 recovery-viz.html
@collision corpus run                ── orchestrates the whole pipeline above

@collision similar                   ── multi-vector embedding clustering of actions
@collision probe "<phrase>"          ── what would the embedding ranker say?
@collision neighborhoods preview     ── union of similarity + corpus → preview HTML
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
| `@collision corpus generate [--schemas …] [--models …] [--concurrency N] [--out …] [--workdir …]` | LLM-authored phrase corpus. Default 3 styles × 3 models per action across all loaded schemas (~12 min for the full set). |
| `@collision corpus probe [--in …] [--out …] [--top N] [--delta n] [--workdir …]` | Replay a corpus through `semanticSearchActionSchema`. Each phrase classified CLEAN / TIGHT / MISROUTE. |
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
  size badges, sample phrases on expand.
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

Built by `@collision neighborhoods preview`. Sized ~360 KB.

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
