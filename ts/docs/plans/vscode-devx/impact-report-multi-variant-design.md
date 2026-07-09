# Impact Report — multi-variant compare (Baseline + N Variants) — design

**Builds on:** the existing binary A/B Impact Report (replay engine, `replayCorpus`,
`ActionDelta`, `ReplaySummary`) and the sandbox-convergence framing in
[`replay-l4b-design.md`](./replay-l4b-design.md) (A/B reframed as "Sandbox A / Sandbox B").

## One-line idea

Replace the fixed two-target compare (A vs B) with **one Baseline compared against
an ordered list of Variants** (A vs B1, B2, … Bn), rendered as a matrix. Binary
A/B becomes the N=1 special case.

## Why — the journeys this unlocks

- **Bisect a regression.** "Which of these N commits changed the answer?" Baseline =
  known-good ref; variants = suspect commits. One run instead of N binary compares.
- **Track against history.** Working tree vs the last few releases at once.
- **Compare candidate fixes.** One baseline vs several feature branches.
- **Fidelity sweep.** Same version, varied replay options (cache on/off, validation
  on/off) — see how the answer moves as fidelity climbs.

## Two orthogonal axes (this is the key framing)

The Impact Report has two independent dimensions:

- **Depth / realization axis** (the L4b ladder): how faithfully ONE side is
  realized — grammar → schema enrichment → construction cache → wildcard validation
  → full built dispatch. This is [`replay-l4b-design.md`](./replay-l4b-design.md) (Steps 1–3).
- **Breadth axis** (THIS doc): how MANY comparison targets sit beside the baseline.

They compose. Each variant is a sandbox realized at some depth and carries its own
fidelity descriptor. Multi-variant needs **none** of the deferred build epic — it
works entirely at today's L1 grammar fidelity and gets richer for free as the depth
axis advances.

```
                depth (realization, L4b) ──▶
  breadth   B0(baseline)  grammar | +cache | +validation | built
  (this     B1            grammar | +cache | …
  doc)      B2            grammar | …
   │        …
   ▼
```

## Grounding in the MVP plan and the gates (A–E)

Canonical source: [`04-mvp-slice.md`](./04-mvp-slice.md) §3 (gates) + §2 (excludes);
journeys in [`02-journeys.md`](./02-journeys.md).

The MVP is fenced by five gates; the load-bearing one for replay is:

- **Gate C — headline / validation gate (journey J4, persona P4 "Regression Owner").**
  The Impact Report, run with the default "likely-bad change" predicate (F4.4) on a
  **hand-labelled `player` regression set**, agrees with developer judgment on **≥ 80%
  of rows** (red = regression, green = improvement), under the **deterministic
  `needs-explanation` miss policy**. Evaluated on the **binary** compare
  (`working tree` vs `HEAD~1`). This is "the single hardest gate."

Where multi-variant sits relative to the gates:

- **It is POST-MVP and on none of A–E's critical path.** Every gate (A stand-up, B
  schema loop, C headline, D drill-in, E live mirror) is satisfied by the binary
  compare. Multi-variant adds **breadth**, which no MVP gate requires.
- **It is the sibling of the existing §2 exclude.** §2 already defers
  **multi-agent / multi-corpus simultaneous replay** (one agent → many agents) as
  post-MVP. Multi-variant is the _other_ replay-scaling axis — **one agent → many
  versions**. Both are post-MVP breadth extensions of the same `replayCorpus` engine;
  they are independent (you can have either without the other).
- **It must PRESERVE Gate C, not move it.** Because binary is exactly N=1, the
  slice-1 result-shape refactor has to keep single-variant `ActionDelta`/row semantics
  byte-for-byte identical, so the ≥ 80% agreement number doesn't shift. The F4.4
  red/green predicate and the deterministic `needs-explanation` policy run **per cell**
  unchanged — so each variant column carries the same Gate-C-validated semantics.
- **It is the natural post-MVP evolution of the J4 headline.** J4 is literally "find a
  regression." The bisect / first-divergence feature (range-expand `good..HEAD`,
  per-row first `=`→`Δ` column = the introducing commit) is the strongest realization
  of that journey — it turns "is there a regression vs HEAD~1" into "which commit
  introduced it," for persona P4, once the MVP gate is banked.

### Two scaling axes vs one depth axis (the 2×2)

`replayCorpus` (F4.1) is the primitive. Three independent dials sit on top:

| Dial                              | What it scales                                                        | Doc                                              | MVP status             |
| --------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ | ---------------------- |
| **Fidelity / depth** (L1–L4b)     | how faithfully each _side_ is realized → improves Gate C row accuracy | [`replay-l4b-design.md`](./replay-l4b-design.md) | L1–L3 in; L4b deferred |
| **Breadth — versions** (this)     | how many _variants_ beside the baseline                               | this doc                                         | post-MVP               |
| **Breadth — agents/corpora** (§2) | how many _agents_ replayed at once                                    | [`04-mvp-slice.md` §2](./04-mvp-slice.md)        | post-MVP               |

Depth improves the _quality_ of each cell (and thus Gate C); the two breadth axes
multiply the _number_ of cells. Multi-variant only touches breadth-versions, composes
with depth per-cell, and is orthogonal to breadth-agents.

## The reframe: Baseline + Variants

- **A → Baseline**: the fixed reference column.
- **B → Variants**: an ordered list of comparison targets.
- A variant is not just a version — it is **version + replay options**:

```ts
interface ReplayVariant {
  version: VersionSpec; // { kind:"git"; ref } | { kind:"workingTree" }
  mode: StudioReplayMode; // "nfa-grammar" | "completionBased-cache"
  validateWildcards: boolean;
  label?: string; // display label; defaults from version/options
}
```

Folding options into the variant unifies _version_ comparison and _fidelity_
comparison under one abstraction — the option-sweep journey is then free.

## Data model generalization

The engine's binary pairs (`actionA`/`actionB`, `cacheStateA`/`cacheStateB`,
`collisionsA`/`collisionsB`, `latencyA`/`latencyB`) become baseline + a variants
array. Sketch:

```ts
interface VariantCell {
  action?: unknown;
  cacheState: ReplayCacheState;
  collisions: CollisionDetectedEvent[];
  latency: number;
  requestId: string;
  relation: "equal" | "changed" | "new-match" | "lost-match"; // vs baseline
  fidelity: FidelityReport; // per-variant (composes with the depth axis)
}

interface RowResult {
  utterance: string;
  utteranceId: string;
  source: CorpusSource;
  baseline: {
    action?: unknown;
    cacheState: ReplayCacheState;
    collisions: CollisionDetectedEvent[];
    latency: number;
    requestId: string;
  };
  variants: VariantCell[]; // index-aligned with the request's variants[]
}

interface VariantSummary {
  // one per variant, vs baseline
  equalCount: number;
  changedCount: number;
  newMatchCount: number;
  lostMatchCount: number;
  collisionDelta: number;
  duration: number;
}
```

- **Baseline is computed once** and reused across all variants → cost is linear in N,
  not N².
- `variants.length === 1` serializes/renders identically to today's A/B.

### Coordination with L4b Step 1 (important — shape it once)

L4b Step 1 plans to add `sideFidelity: { A: FidelityReport; B: FidelityReport }` to
`StudioReplayResult`. That is the exact `{A, B}` pair this redesign turns into
`baseline + variants[]`. To avoid refactoring the same field twice, when Step 1
lands the fidelity descriptor should be modelled **per sandbox** —
`baselineFidelity: FidelityReport` + `variants[i].fidelity` — rather than a fixed
A/B pair. Even before multi-variant ships, expressing it as "baseline + a list of
one" makes the later generalization a no-op on the type.

## UI design

### Action bar

```
Baseline:[▾ Working tree]   Variants:[HEAD ✕][HEAD~1 ✕][feat/x ✕][＋]   ⚙ options  ▶ Run
```

- Variants are chips; `＋` opens today's version picker. The swap button retires
  (the compare is asymmetric now).
- Per-variant options (mode/validation) hang off each chip's own little gear, or a
  shared default with per-chip overrides.

### Per-variant summary strip

```
  HEAD          HEAD~1        feat/x
  ✓ 48 = · 2Δ   ✓ 47 = · 3Δ   ⚠ 31 = · 19Δ · 4−
```

One card per variant: equal/changed/new/lost counts vs baseline; click to focus.

### Matrix (primary view)

```
Utterance                     │ Baseline │ HEAD │ HEAD~1 │ feat/x
"play despacito by fonsi"     │ playTrack│  =   │   =    │   Δ
"turn on the lights"          │ toggle   │  =   │   Δ    │   Δ
"set a 5 minute timer"        │ setTimer │  =   │   =    │   =
"queue some jazz"             │ (none)   │  =   │   =    │   + new
```

- Sticky baseline column; one column per variant; horizontal scroll past ~4–5.
- Cell glyph relative to baseline — `=` equal, `Δ` changed, `+` new, `−` lost —
  reusing today's vocabulary, just per column.
- Click a **cell** → drawer with the full baseline-vs-that-variant action diff
  (reuses today's binary detail view verbatim).

### Two view modifiers

- **Divergence filter** — hide rows that are `=` across every variant (essential at
  scale; most rows are stable).
- **Row fingerprint** (compact) — collapse columns to `●●○` per row (matches B1,B2;
  differs B3) when there are many variants.

## The payoff: ordered variants → first-divergence / bisect

If variants are an ordered chronological range (old→new), the matrix answers "find
the regression" directly: per row, the column where it first flips `=`→`Δ` **is the
commit that changed it**.

- **Range-expand source**: give a range `good..HEAD`; auto-create one variant per
  commit (capped, e.g. ≤8); highlight each row's first-divergence column.
- Per-row "introduced at →" annotation pointing at that commit.

This makes the headline journey ("I edited grammar; which commit regressed it?") a
single run.

## Where variants come from

1. **Manual** — add ref / pick commit / working tree (today's picker, N times).
2. **Range-expand** — `A..B` → a variant per commit (bisect mode above).
3. **Option sweep** — same version, varied `mode`/`validateWildcards` (fidelity
   sweep). Free once options live on the variant.

## Cost, perf, back-compat

- Baseline computed once; each variant is one extra pass. Cap N with a warning;
  range-expand caps commits.
- **Progressive fill** — stream columns in as each variant completes (the matrix is
  column-addressable) rather than blocking on the whole sweep.
- **Cache by `(agent, version, mode)`** so adding a variant doesn't recompute
  existing columns.
- Fully backward compatible: N=1 renders exactly like today; the simple two-target
  bar is the default and the matrix is progressive disclosure via `＋`.

## Delivery slices

1. **Result-shape generalization** — baseline + `variants[]` in the core result
   types + engine, N=1 rendering identical. Pure refactor; the risk-bearing slice.
   Best landed together with (or immediately after) L4b Step 1 so the fidelity
   descriptor is shaped per-sandbox once.
2. **Matrix UI** — variant chips + per-variant summary cards + matrix columns
   (manual variants only).
3. **Divergence filter + cell drill-down drawer** (reuses binary detail view).
4. **Range-expand + first-divergence** (the bisect payoff).
5. **Option-sweep variants** (fidelity sweep).

## Where it fits in the work plan

A **new workstream on the breadth-versions axis**, parallel to the L4b realization
ladder, and **gated behind the MVP**:

- **Precondition: Gate C is banked first.** Multi-variant is post-MVP (§2 sibling of
  the deferred multi-agent axis). Do not start it until the binary Impact Report has
  passed Gate C on the hand-labelled `player` set — otherwise slice 1's refactor risks
  perturbing the very rows the gate measures.
- **Depends on:** the sandbox framing — best sequenced _after_ L4b Steps 1–2
  (per-side fidelity readout + "Sandbox A/B" relabel), because multi-variant is the
  natural generalization of "Sandbox A / Sandbox B" to "Baseline + N variant
  sandboxes," and slice 1 shares the `StudioReplayResult` fidelity refactor with
  Step 1.
- **Independent of:** L4b Step 3 (build-from-ref) and the §2 multi-agent axis.
  Multi-variant ships entirely at L1 grammar fidelity and simply gets richer cells as
  the depth axis advances.
- **Serves:** persona P4 (Quality / Regression Owner) and journey J4 — it extends the
  validated headline ("find a regression vs HEAD~1") into bisect ("which commit
  introduced it").
- **Sequencing recommendation:** [MVP Gate C banked] → L4b Step 1 (shape fidelity
  per-sandbox) → L4b Step 2 (relabel) → this slice 1 (baseline + variants[] result
  shape) → this slice 2 (matrix) → slices 3–5. Step 3 (build epic) stays deferred and
  orthogonal.

## Open questions

- Per-variant options vs one shared option set with overrides — how much per-chip
  control is worth the UI weight?
- Default column cap (N) and range-expand commit cap?
- Is symmetric variant-vs-variant comparison ever wanted, or is baseline-relative
  always sufficient? (Baseline-relative keeps the model simple; a "distinct
  outcomes per row" cluster count could cover the rest without full N×N.)
