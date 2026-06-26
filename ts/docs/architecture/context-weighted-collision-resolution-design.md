# Design: Context-Weighted Collision Resolution (`contextSelector` / `context-weight`)

**Status:** Proposed — all core decisions locked (Parts A–G); ready for implementation
**Date:** 2026-06-18
**Owner:** @GeorgeNgMsft
**Area:** `ts/packages/dispatcher` (collision subsystem)
**Related:** `ts/packages/dispatcher/dispatcher/README.md` §"Action Collision Detection"
(specific source files are cited inline where relevant)

> **How to read this doc.** §1–§2 motivate the feature; §3 is the end-to-end architecture
> diagram; §4 shows how it fits the existing dispatcher code. §5–§12 specify the design one
> component at a time (each opens with its locked decision, then the reasoning and the
> alternatives weighed). §13 composes them into the v1 we ship; §14 walks two worked
> examples; §15 archives the rejected alternatives.

---

## 1. Problem & motivation

When two or more agents can handle the same input, the dispatcher detects a
**collision** and picks a winner. Every existing resolution strategy — the policy for
_picking_ a winner, a separate axis from the detection _points_ where collisions are noticed
(§4) — is _context-free_:

| Strategy             | What decides the winner                                           |
| -------------------- | ----------------------------------------------------------------- |
| `first-match`        | Heuristic match order (effectively arbitrary).                    |
| `score-rank`         | Grammar match shape (`matchedCount`/`nonOptionalCount`/wildcard). |
| `priority`           | A **static** `priorityOrder` string or registration order.        |
| `user-clarify`       | Ask the user every time.                                          |
| `preference-clarify` | A learned per-pair preference (after consent), else ask.          |

None use **what the conversation is currently about**. If the user has spent ten
turns in spreadsheets, `add a row` colliding between `excel.addRow` and
`list.addItems` should resolve to **excel** — without a clarify card, without an
LLM call, and without a brittle _global_ priority list that would wrongly pin
excel over list for every user forever.

`priority` is the closest existing tool but it is **global and static**. We want
a **dynamic, conversation-local priority** that shifts with the topic, is cheap
enough to run on every collision, deterministic (explainable, testable), and that
**abstains** when the signal is weak rather than guessing.

### Idea in one line

Give each agent a set of keywords, derive a keyword profile of the recent
conversation, and at collision time pick the candidate whose keywords are closest
to what the conversation is about — deferring to the existing tiers whenever the
topical signal is weak or ambiguous.

---

## 2. Goals & non-goals

### Goals

- **G1.** A new resolution behavior, `contextSelector` (strategy value
  `context-weight`), ranking colliding candidates by topical proximity to the
  recent conversation.
- **G2.** On the **grammar/cache path**, a confident deterministic
  decision keeps the request on the cache path and **avoids the downstream LLM
  translation**. On the **embedding/llmSelect path** there is **no LLM saved**
  — the benefit there is a _deterministic, explainable
  tiebreak_ of the embedding cluster, not latency/cost.
- **G3.** Deterministic in the hot path. Same conversation state ⇒ same decision.
- **G4.** **Abstains safely.** Weak/ambiguous/under-covered ⇒ no change; fall
  through to the existing tiers.
- **G5.** Off by default, per-point opt-in, fully observable via existing
  telemetry — matching the subsystem's soft-rollout posture.
- **G6.** No _required_ LLM, and none on the hot path. Production _prefers_ a one-off LLM
  distillation for quality, with a deterministic, drift-proof lexical floor as the guaranteed
  fallback — so an LLM is never required and never called during collision resolution.

### Non-goals

- Not replacing `user-clarify`/`priority`/learned preferences. It runs as an
  earlier tier and, on abstain, hands the same candidate set to them unchanged.
- Not an embedding/NLU re-architecture. Core matching is lexical. Embedding
  soft-match is an optional, flagged enhancement only.
- Not a durable per-user profile. The conversation profile is session-scoped.

---

## 3. Architecture (end to end)

The full system in one view — keyword production (frozen before runtime) on the left,
the per-turn context vector in the middle, and the collision-time decision on the right:

```
═══════════════════════════════════════════════════════════════════════════════
  A. KEYWORDS — produced before runtime, two sources                (§5–§6)
═══════════════════════════════════════════════════════════════════════════════
   ── Source 1: keyword file (holds one keyword vector per (schema, action)) ──
   agent schema text ──► lexical extract (floor) ──┐
   LLM (one-off, preferred) ──► distill ───────────┴─►  keyword vector ────────────┐
                                                                                    │
   ── Source 2: sidecar overrides (optional, layered, configurable) ──              │
   user tuning · misroute phrases · user preferences ──► collision-keywords.json ──┤
                                                           (add / remove / replace) │
                                                                                    ▼
                                        keyword index:  schema.action → { keywords }

═══════════════════════════════════════════════════════════════════════════════
  B. CONTEXT VECTOR — runtime, once per user turn                  (§7–§8, §12)
═══════════════════════════════════════════════════════════════════════════════
   each user request ──► ring buffer (last N=20, canonicalized tokens)
                              │
                              └──► decay each turn by λ^age (λ=0.9) ──► context vector
                                                                        { token → weight }

═══════════════════════════════════════════════════════════════════════════════
  C. RESOLVE — at a Stage-1 grammar collision                      (§4, §9–§11)
═══════════════════════════════════════════════════════════════════════════════
        keyword vectors (A)                 context vector (B)
                  └──────────────┬──────────────┘
                                 ▼
              D-4 scorer:  Σ  decayed-frequency × candidate-local-IDF        (§9)
                                 ▼
              E-2 decision:  coverage · history-only · evidence gate · margin (§10)
                       ┌─────────┴──────────┐
                  confident              abstain
                       │                    │
              resolve the winning     fall through, unchanged, to the
              Stage-1 match           configured grammar strategy
              (no LLM) + U-2          (first-match / priority / user-clarify)
              affordance              — never worse than today
```

**Reading it:** A produces a keyword vector per `(schema, action)` from two sources — an
always-present _keyword file_ (extracted from the schema) plus an optional _sidecar_ of layered
overrides; B maintains a live, decayed keyword-frequency map of the conversation; at a
collision, C scores each colliding candidate's keyword vector against that map and either resolves
(deterministically, no LLM) or abstains to today's behavior. The only LLM in the whole picture
is the _one-off_ distillation that produces the keyword vectors at onboarding/backfill (with
deterministic lexical extraction as the fallback floor) — the runtime hot path that reads them
is LLM-free and deterministic.

---

## 4. How it fits the existing code

A user request runs through a **two-stage pipeline**, where the second stage runs
**only if the first produces no match**. They are sequential fallback, not parallel
— the linchpin is literally `match ?? translateRequest(...)`
(`interpretRequest.ts:110-122`):

```
USER REQUEST
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1 — Grammar / cache match     (matchRequest.ts)        │  deterministic · NO LLM
│   construction cache + agent grammars validate the input    │
│   ≥2 agents match → collision → resolveGrammarCollision()   │
└───────────────┬─────────────────────────────────────────────┘
                │  HIT → return typed action ───────────────▶ DONE  (Stage 2 never runs)
                │  miss
                ▼
┌─────────────────────────────────────────────────────────────┐
│ STAGE 2 — Translate                 (translateRequest.ts)    │  cache-miss only
│   a) pickInitialSchema: embedding search picks a schema      │  · no LLM
│        near-tie cluster → applyLlmSelectStrategy() resolves   │
│   b) translateRequestWithSchema: LLM fills the typed action  │  ← the LLM call
└─────────────────────────────────────────────────────────────┘
```

### Quick summary of each stage

- **Stage 1 — grammar/cache (`matchRequest`).** Deterministic, no model call. Matches
  the input against the construction cache and agent grammars. When ≥2 agents validate
  the same input it is a **collision**, resolved today by `resolveGrammarCollision`
  (strategies: first-match / score-rank / priority / user-clarify / preference-clarify),
  plus the independent registry-first detector. A match returns a complete typed action
  (from a learned cache entry **or** a compiled grammar rule — no LLM either way).
- **Stage 2 — translate (`translateRequest`), runs only on a Stage-1 miss.** Two
  sub-steps: (a) `pickInitialSchema` uses an **embedding** similarity search to choose
  _which_ schema to translate against — and if the top candidates are a near-tie (the
  **`llmSelect`** collision point) it breaks the tie with `applyLlmSelectStrategy`,
  which makes **no model call**; (b) `translateRequestWithSchema` makes the **actual
  LLM call** to produce the typed action, regardless of which schema (a) chose.

> The name **`llmSelect`** refers to the selection step that _feeds_ the LLM
> translator — the selection itself uses **embeddings**, not an LLM.

### Where `contextSelector` fits

contextSelector is a tiebreaker for an **already-detected** collision: Stage 1 has
produced several competing `MatchResult`s (each a complete typed action, from the
learned cache _or_ a compiled grammar rule), and contextSelector **selects the winner
among them** — it never synthesizes an action. So it slots into **Stage 1**: confident
→ return the winning match (no LLM); abstain → fall through to today's strategy (and
ultimately to Stage 2). This is the **only** insertion that can avoid the LLM, because
a Stage-1 match short-circuits Stage 2. Inserting at the Stage-2
`llmSelect` tie would only change _which_ schema is translated — the LLM still runs, so
there is no cost saving (out of scope for v1; see §11).

**Inputs handed to the selector at resolution time.** contextSelector is a pure scorer
over two data inputs — it holds no conversational state of its own:

1. the **competing candidates** and their **keyword vectors** (per `(schema, action)`;
   see §5–§6); and
2. the **context vector** — a running keyword-frequency map derived from the ongoing
   conversation (e.g. `{ spreadsheet:8, formula:5, cell:4, … }`; see §7–§8). This is a
   session-scoped property _passed in_ at collision time — built from a contextSelector-owned
   ring buffer of recent user requests (§7), **not** derived from `ChatHistory` (which is empty
   in agent-server mode) and **not** computed inside the scorer.

```
each user turn ──▶  context vector  { spreadsheet:8, formula:5, … }   (the data)
                          │
  Stage-1 collision ──────┤  candidates + keyword vectors  +  context vector
                          ▼
                   contextSelector (scorer, §9)  ──▶  resolve winner / abstain
```

The split matters: the **context vector is the data**, contextSelector is the
**scorer**. Keeping conversational state out of the scorer is what makes it
deterministic and unit-testable (§12), and it is the line that the §7–§8 decisions
(what feeds the vector, and whether it is maintained running vs recomputed on demand)
operate on.

### Scope across the four detection points

The dispatcher detects collisions at four points (see `dispatcher.md` §"Detection points").
These are a _separate axis_ from the resolution **strategies** in §1 — strategies decide
_how_ to pick a winner; detection points decide _where_ a collision is noticed.
contextSelector is a new resolution behavior that targets exactly **one** of them:

| Detection point                                                                | Active today?                                | contextSelector's relationship                                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **`static`** (duplicate `actionName` across schemas, at registration)          | registration-time integrity check            | **N/A** — fires before any conversation exists, so topical context cannot apply.                                                     |
| **`grammarMatch`** (≥2 validated grammar/cache matches for one input, Stage 1) | active runtime                               | **Targeted** — the single v1 insertion (resolve or abstain here).                                                                    |
| **`llmSelect`** (top-N embedding scores within `scoreDeltaThreshold`, Stage 2) | active runtime                               | **Deferred** — saves no LLM there (the embedding pick is already model-free and translation runs regardless); out of v1 scope (§13). |
| **`fuzzy`** (meaning-overlap across differing names/grammars)                  | inert (scaffolded; default scorer returns 0) | **N/A** — never fires today.                                                                                                         |

So the only _active runtime routing_ points are `grammarMatch` and `llmSelect`;
contextSelector covers the first and defers the second. `static` is a build-time check and
`fuzzy` is dormant, so neither is in scope.

### Existing infrastructure we reuse

- **`resolvePreferenceClarify`** (`collisionResolution.ts`) is the shared resolution
  policy both stages already call for `preference-clarify` — the natural host if we
  later want both-stage coverage from a single change.
- **The learned-preference store** (`collisionPreferences.ts`, consulted via
  `resolvePreferenceClarify`) is the existing **consented-choice** mechanism. A possible
  reuse, deferred to §11: when the user confirms a topical pick, **bootstrap a learned
  preference** so the existing path auto-resolves it next time (U-3). This store is
  **separate from the live context vector** — the vector stays a full keyword map and is
  never collapsed into a single topic tag; whether/how a confirmed pick is persisted is a
  §11 concern, not part of the scoring data.
- **`neighborhoods.json`** (`session.ts:295-306`, `collisionResolution.ts:30-39`) is the
  runtime-loaded collision-_detection_ registry. It is **not** where keyword overrides live
  (those are a separate `collision-keywords.json` sidecar, §5) — but its recorded misroute
  phrases are a deterministic **source** for the misroute sidecar layer (§6.2).

---

## 5. Part A — Where keyword data lives

> **✅ DECIDED: keyword data lives in exactly two places — an auto-derived per-action
> keyword file, plus an optional hand-tuning sidecar.**
>
> 1. **Derived defaults (the keyword file).** Every `(schema, action)` gets a keyword vector
>    auto-derived from the schema (how it's produced is §6). This is the baseline —
>    nothing is hand-authored, and it tracks the live schema automatically.
> 2. **Override sidecar (`collision-keywords.json`).** A small, separate file that can
>    **add / remove / replace** keywords for the handful of actions that actually collide.
>    It stores only deltas over the derived defaults and hot-reloads as data — no rebuild
>    or re-ship.
>
> Keywords are keyed **per individual action** (matching the `(schema, action)` collision
> identity), not per whole agent — so two schemas of one multi-domain agent can't end up
> with identical vectors. (Indices: _A-2_ = per-action granularity; _A-3_ = the sidecar.)
> Rejected alternatives — whole-agent-level keywords, or per-user profile state — are in §15.

**Why this split.** Two forces pull in different directions. _Correctness_ pulls
toward per-action granularity: the keyword identity must match the `(schema, action)`
collision identity, or two schemas of one multi-domain agent get identical vectors and
permanently abstain — which is exactly what the **derived per-action defaults** provide.
_Evolvability_ pulls toward a runtime override: the colliding few must be tunable without
re-shipping an agent — which is what the **sidecar** provides. And because the defaults are
derived rather than hand-authored (§6), the "home" question largely dissolves — there is
nothing to store except optional overrides.

### 5.1 How the sidecar works (mechanism)

The override file is its **own** sidecar — a `collision-keywords.json`, **not**
`neighborhoods.json` (which keeps its separate collision-detection role). It
works the same way that registry does _mechanically_ — a plain JSON artifact on disk,
separate from any agent's code, loaded at runtime — keyed by `(schema, action)` and storing
only **deltas** over the derived defaults:

```jsonc
// collision-keywords.json (sidecar; only the colliding few need entries)
{
  "excel.addRow": { "add": ["spreadsheet", "formula"], "remove": ["office"] },
  "list.addItems": { "add": ["grocery"] },
}
```

**Effective keyword vector** for a `(schema, action)`:

```
effective = derived(schema.action)  ∪  override.add  −  override.remove
            (or, with the replace escape hatch: override.replace verbatim)
```

So the user is **adding** discriminative keywords on top of the auto-derived list,
not restating it — which keeps the file tiny and prevents the wholesale drift that
a fully hand-authored list would invite (the derived layer keeps tracking the live
schema automatically).

### 5.2 Why it is "hot-reloadable" (data, not code)

The reload mechanism is the one the registry already uses
(`ensureCollisionRegistry`, `collisionResolution.ts:30-39`):

```ts
const path = ctx.session.getConfig()....registryPath;
if (path !== ctx.collisionRegistryPath) {                 // path changed?
    ctx.collisionRegistry = CollisionRegistry.load(path); // fresh fs read
    ctx.collisionRegistryPath = path;
}
```

`CollisionRegistry.load` does a fresh `fs.readFileSync` and **never throws** — a
missing/malformed file degrades to empty (`collisionRegistry.ts:63-85`). The
consequences:

- **Hot = data, not code.** Editing the sidecar (or its path) takes effect with **no
  dispatcher rebuild and no agent re-ship**. Contrast a manifest list (A-1/A-2),
  which is baked into the in-memory schema at agent registration; editing it
  requires a rebuild **and** a shell restart (README:438-441). This is the entire
  reason A-3 is paired with A-2: the colliding handful can be corrected operationally
  and take effect immediately.
- **Caveat (honest):** as written, the registry re-reads only when the configured
  **path string changes** — it is not a file-watcher. After editing the file in
  place, the user re-points the path, or we add a small `@config … reload` /
  re-set-path trigger. Cheap to add; called out so "hot-reload" is not oversold.

### 5.3 The tuning flow in practice

Tuning is **telemetry-driven** — someone tunes because they saw a wrong routing:

1. **Notice it** — e.g. `add a row` routed to `list` instead of `excel`; visible in
   `@collision events` (the ring buffer records candidates + chosen).
2. **Pick a lever** (two exist, different blast radius):
   - **One-off, no keyword editing:** record a _learned preference_ — "for this exact
     candidate set, pick excel." Already ships (`@collision preferences set …`,
     README:423-426); lowest friction.
   - **Generalizable:** add a _discriminative_ keyword so the topic signal routes
     correctly going forward — the sidecar.

A command surface that mirrors the existing `@collision preferences` verbs
(set/remove/clear/list) keeps it familiar:

```
@collision keywords excel.addRow add spreadsheet formula
@collision keywords excel.addRow remove office
@collision keywords excel.addRow list     # shows derived + overrides, merged
@collision keywords excel.addRow clear     # revert to derived-only
```

Two ergonomics notes that connect to later parts:

- Because **Part D** leans toward _flattened/capped_ positional weights, the user
  **does not have to fuss about keyword order** when adding.
- Because **Part D** uses _candidate-local discriminativeness_, adding a keyword the
  _other_ colliding candidate also has won't help (it cancels). The `list` view can
  surface which added keywords are actually discriminative, guiding the user toward
  effective edits.

---

## 6. Part B — How keyword vectors are produced

> **✅ DECIDED: keyword vectors are produced two ways — **standard onboarding extraction**
> (automatic, runs for every action) and **ad-hoc tuning** (optional, refines only the
> actions that actually collide).**
>
> ```
> keyword vector =  standard extraction  (automatic — every action, at onboarding)
>                +  ad-hoc tuning         (optional — only actions that collide)
> ```
>
> 1. **Standard extraction (the default producer).** When an action first appears — at one of
>    **three moments**: a step in the **onboarding flow** (new agents), a one-time **backfill**
>    (already-shipped agents), or **dynamic generation** (agents/actions created at runtime, e.g.
>    flow creation) — a keyword vector is produced for it, with **no authoring required**.
>    **LLM distillation is the preferred producer**: a one-off, higher-quality pass we expect to
>    beat raw lexical output (it adds synonyms the schema never says, normalizes phrasing).
>    **Lexical extraction is the deterministic fallback floor** — it guarantees a vector for
>    _every_ action even when no LLM ran (dynamic runtime agents where a synchronous model call
>    is undesirable, agents not yet distilled, or LLM-less environments) and underpins the §10
>    full-coverage guard. We don't avoid LLM calls on principle; we only keep them from becoming a
>    **hard runtime dependency or repeated requirement** — and a one-off distillation is neither.
> 2. **Ad-hoc tuning (optional refinement).** For the handful of actions that actually collide,
>    the vector can be sharpened by three optional, independently-toggleable layers: **user
>    tuning** (manual keyword edits), **misroute tuning** (deltas mined from real misroute
>    phrases in `neighborhoods.json`), and **user preferences** (deltas derived from learned
>    routing preferences).
>
> Each action's **baseline vector is produced once** by standard extraction (at its onboarding /
> backfill / dynamic-generation moment) and is not recomputed thereafter; ad-hoc tuning is layered
> on afterward as additional, **lightweight** refinements. Extraction itself may use an LLM where
> quality matters — the offline distillation pass, and optionally when generating keyword vectors for
> dynamically-added actions — so it is **not** strictly LLM-free. What _is_ guaranteed
> deterministic and LLM-free is the **collision-time scoring path that reads these vectors (§9)**.
> (_Where_ the produced vectors are stored — the always-present keyword file vs. the tuning
> sidecar — is §5; this section is only about how they are produced, and no action-schema field is
> added either way.) The rejected alternative — generating keywords from embedding clusters — is
> in §15.

### 6.1 Standard extraction (every action, at onboarding)

This is the default producer. **LLM distillation is preferred** (a one-off, higher-quality pass
run at onboarding/backfill); **lexical extraction is the deterministic floor** that guarantees a
vector whenever no LLM ran. Either way it runs as a step in the **onboarding flow** (and the
equivalent backfill / dynamic-generation moments), so every action gets a vector with no
authoring.

**LLM distillation (the preferred producer).** A one-off LLM pass — run at onboarding and the
backfill, or at generation time for a dynamically-added action — produces higher-quality
keywords _and synonyms the schema never says_ (`sheet`→`spreadsheet`), normalizes phrasing, and
is committed/stored alongside the agent. We expect it to beat raw lexical output, so it is the
default where a model is available. Accepted costs: **drift** (stored artifacts go stale) —
mitigated later by an **automated refresh pipeline** in the spirit of the doc-autogen pipelines.
It runs **once** per action and is never on the collision-time hot path, so it adds no runtime
LLM dependency.

**Lexical extraction (the deterministic fallback floor).** A deterministic extractor mines each
agent's own schema text — manifest + schema `description`, de-camelCased action names
(`addItems`→"add items"), parameter names + their JSDoc comments, optionally `.agr` grammar
literals — minus stopwords and generic CRUD verbs. It is **drift-proof** (recomputed from the
live schema) and covers **every agent including runtime/dynamic ones** (`allowDynamicAgents`),
so it guarantees a vector — and thus the §10 full-coverage guard — even when distillation hasn't
run (not-yet-distilled agents, dynamic agents where a synchronous model call is undesirable, or
LLM-less environments). Lower quality (identifier-ish); it cannot invent synonyms the schema
never mentions, which is exactly why distillation is preferred when available.

**Three lifecycle moments — a vector always ends up existing:**

| Moment                 | Applies to                                             | What runs                                                                                           |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Onboarding flow**    | a newly-onboarded agent                                | LLM distillation (preferred), lexical fallback — as a step in the onboarding flow                   |
| **Initial backfill**   | agents that shipped before this feature                | a one-time LLM-distillation pass over the existing roster (lexical fallback)                        |
| **Dynamic generation** | agents/actions created at runtime (e.g. flow creation) | lexical extraction at load — optionally LLM-distilled if a model is available; no build step (§6.3) |

The extractor is classic IR, no model call:

```
1. tokenize + canonicalize (NFKC, lowercase, strip punctuation)
2. drop stopwords + generic CRUD verbs (add/get/update/remove/show/…)
3. count term frequency across the corpus
4. emit the top-N as the keyword vector
```

### 6.2 Ad-hoc tuning (only the colliding few)

Tuning refines the extracted vector for the handful of actions that actually collide. Its
overrides can be sourced from three layers, merged in a configurable priority; each is optional
and independently toggleable:

- **User tuning (manual).** Explicit add / remove / replace edits a human makes after seeing a
  misroute (the `@collision keywords …` flow, §5.3). Highest intent clarity, lowest volume.
- **Misroute tuning (auto-derived from real phrases).** `neighborhoods.json` records, per
  known-confusable cluster, the _real user phrases_ that misrouted between its members. A
  deterministic extractor mines those into discriminative keyword deltas — concentrated on
  exactly the hard, colliding pairs. It covers only clusters already in the registry, so it is
  a boost, never the base.
- **User preferences (learned).** Learned routing preferences (`@collision preferences`) can
  contribute deltas that bias a colliding set toward the user's observed choice — expressed as
  keyword weight rather than a hard pin.

Because the misroute and preference layers are auto-derived, the merge is **configurable**: a
deployment can run manual-only, manual + misroute, or all three.

**Misroute tuning shares the keyword-file extractor — still no LLM.** The misroute layer reuses
the same deterministic extractor as the keyword file, differing only in the input corpus
(misroute phrases instead of schema text). For a colliding pair it adds a distinctive-terms
step — rank a term by how much more it appears in this member's phrases than the sibling's
(TF-difference / log-odds-ratio) — so shared/ambiguous tokens cancel and discriminating tokens
rise.

> The misroute phrases in `neighborhoods.json` were themselves LLM-generated in the offline
> corpus run that built the registry — but that is committed _source data_, like a
> human-written schema description. The extraction on top is mechanical, and **runtime is
> never involved**.

**Worked example — misroute mining on a real cluster.** From the shipped registry, the cluster
`calendar.findTodaysEvents` ↔ `taskflow.dailyAgendaEmail` records 9 phrases the user _intended_
for `taskflow.dailyAgendaEmail` but that misrouted to `calendar.findTodaysEvents`:

> "Email me today's agenda." · "Could you send me an email with my schedule for today?" ·
> "Shoot me today's calendar events." · "Send me an email with today's calendar events."

Extraction for `taskflow.dailyAgendaEmail`:

- raw tokens → `email, agenda, schedule, send, inbox, calendar, events, today`
- distinctive-terms vs the `calendar` sibling: `today`, `calendar`, `events` appear for _both_
  intents (they are _why_ the two collide) → cancel; `email`, `agenda`, `send`, `inbox` are
  unique to the email intent → rise
- emitted keyword deltas → **`email, agenda, send, inbox`**

At runtime, if the conversation has been about email (context map `{ email:6, send:3, inbox:2 }`)
and the user says _"get me today's agenda"_ — colliding the two actions — those mined keywords
overlap the conversation for `taskflow` and not for `calendar`, so contextSelector resolves to
`taskflow.dailyAgendaEmail`. The phrases became override keywords; the keywords feed the normal
scorer (§9).

### 6.3 When extraction runs (performance)

This concerns the **lexical fallback floor** — the deterministic path. (LLM distillation, the
preferred producer, is a one-off onboarding/backfill cost that never touches boot or the
collision-time hot path.)

The lexical extractor is pure string processing — no model, no I/O beyond text already parsed at
agent registration. At real scale (~30 agents, ~10k tokens total) it is low-single-digit
milliseconds — rounding error next to grammar NFA compilation and embedding-model load already
on the boot path. A concrete sketch:

```ts
function extractKeywords(schema): string[] {
  const text = [
    schema.manifestDescription,
    schema.schemaDescription,
    ...schema.actions.map((a) => deCamel(a.name)), // "addItems" → "add items"
    ...schema.actions.flatMap((a) => a.params.map((p) => deCamel(p.name))),
    ...schema.actions.flatMap((a) => a.params.map((p) => p.jsdoc ?? "")),
  ].join(" ");
  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) {
    // lowercase, strip punct, split
    const t = stem(tok); // optional light Porter stemmer
    if (STOPWORDS.has(t) || GENERIC_VERBS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([t]) => t);
}
```

**Recommendation:** to keep even that off the boot path, **precompute at build time** for
shipped agents (emit `<agent>.keywords.json` into `dist/`, mirroring the `.ag.json` / `.pas.json`
pipeline — zero boot cost), with a **content-hash cache / lazy extraction** for dynamically-added
agents that have no build step. The only real cost risk is a heavy NLP dependency; a tiny
rule-based stemmer (or skipping stemming in v1, leaning on the §12 canonicalizer) avoids it.

---

## 7. Part C(i) — Conversation signal source

> **✅ DECIDED: the conversation signal comes from a swappable source. V1 reads the words from
> the user's recent requests — chosen for _simplicity and to get initial benchmarks fast_. V2
> swaps to knowPro's extracted topics/entities, which is the **intended destination**: the
> conversation-memory system that already owns this data is the architecturally correct place to
> read it from.** contextSelector reads the conversation through one interface
> (`getRecentConversationSignal()`), with two implementations:
>
> - **v1 (now — simplicity / benchmarking):** contextSelector keeps its own short buffer of
>   recent **raw user-request text**, tokenized into a keyword-frequency map. Deterministic, no
>   LLM, no new dependency, and — crucially — works in agent-server mode (the connected mode the
>   CLI always uses). Good enough to validate the scorer and gather initial numbers.
> - **v2 (intended):** the richer **topics and entities** that the conversation-memory system
>   (knowPro) already extracts. This is where the signal _should_ come from — knowPro is the
>   system of record for conversation history — so V2 is the target, pending that extraction
>   being available in agent-server mode.
>
> The seam is what makes the v1→v2 swap a drop-in; V1 is the pragmatic start, V2 the
> architecturally correct end state.

### Reasoning & context

This section decides **where the context vector's data comes from**. The natural raw material is
the user's own recent messages — but two facts make it non-trivial, both **decisive because our
target is agent-server mode** (the connected mode the CLI always uses):

1. The dispatcher's conversation stores (`ChatHistory`, knowPro memory) are populated only when
   knowledge-extraction is on, and agent-server turns it _off_ for cost — so the data we'd reach
   for first **isn't there in our target mode** (§7.1).
2. The correct long-term source — knowPro's extracted topics/entities, owned by the
   conversation-memory system of record — isn't usable for v1 yet: it's LLM-produced
   (non-deterministic) and currently unpopulated in agent-server mode (§7.3).

Hence the **source seam**: ship a deterministic, always-available source now (simple, good for
benchmarking) behind a clean upgrade path to knowPro — without the scorer caring which is behind it.

### 7.1 Why not source from `ChatHistory` (the agent-server finding)

The obvious source — the dispatcher's `ChatHistory` — does **not** work in agent-server
mode (the connected mode the CLI always uses). Verified line-by-line:

| Data in agent-server mode                                       | Present?           | Why                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatHistory` **user entries** (the user's words)               | ❌ No              | `addRequestToMemory` is gated by `requestKnowledgeExtraction`, which agent-server sets `false` (`server.ts:179-182`; gate at `requestCommandHandler.ts:469`). The user turn is never written to `ChatHistory`.                                                   |
| `ChatHistory` **assistant entries + entities** (action results) | ✅ Yes             | `addActionResultToMemory` runs because its gate is `actionResultEntityStorage \|\| actionResultKnowledgeExtraction`, and `actionResultEntityStorage` **defaults `true`** and isn't overridden (`actionHandlers.ts:532-535`, `commandHandlerContext.ts:710-712`). |
| knowPro `conversationMemory` (structured topics/entities)       | ❌ No              | its `queueAddMessage` calls are gated by the knowledge-extraction flags, both `false` in agent-server (`memory.ts:137`; user side gated entirely).                                                                                                               |
| Raw `request` string                                            | ✅ Yes (transient) | passed to `matchRequest` every turn, **ungated** by anything.                                                                                                                                                                                                    |

So in agent-server mode the **user's own words are recoverable only from the live
`request`** — not from any store. A `ChatHistory`-sourced context vector would simply be
empty there. (The flag is a cost/perf choice, not an internet check; the dispatcher's
"no internet" comment on it is misleading.)

> Correction to an earlier note in this doc: the **assistant-side entities do survive**
> agent-server mode — but they describe _system outputs_ (a resolved workbook, a found
> event), not the user's phrasing, so they're a secondary signal at best.

### 7.2 V1 — raw-token map

contextSelector owns a small **ring buffer of the last N raw user-request strings**,
appended at an ungated point (it already receives `request` in `matchRequest`). At
collision time the buffer is tokenized + canonicalized (the §12 pipeline, shared with
keyword extraction) into the context-vector frequency map.

- **Signal:** user-message tokens only (the original **C-1**) — cleanest topic signal, no
  feedback loop, no extraction-flag coupling.
- **Deferred:** **C-3** agent-of-record (recent winners) — real signal but a
  self-reinforcing feedback loop (lock-in); needs caps + same-pair exclusion before it's
  safe. Revisit behind local benchmark data.
- Because contextSelector owns the buffer (rather than deriving it from `ChatHistory`), it
  needs a few **invalidation hooks** (`@history clear`, session switch) — a small, bounded
  cost. This settles the §8 source-of-truth question: the map is **contextSelector-owned**,
  not recomputed from `ChatHistory` (which is empty in agent-server mode anyway), leaving
  §8 to decide only the _windowing / decay_ shape.
- **The context vector is per-request and candidate-independent — compute it once, memoize
  it.** It depends only on the conversation, not on _which_ candidates are colliding, so it
  should be built once per request and cached on the request context. v1 scores against it
  exactly once (the single grammar-stage insertion, §11). This memoization also future-proofs
  the deferred F-3 both-path coverage: if contextSelector ever also runs at the embedding
  stage, it must **reuse the same vector** (re-scoring only against the different candidate
  set), never rebuild it — recomputing would be wasteful and could drift the determinism
  contract (§12).

### 7.3 V2 — knowPro extracted topics + entities (the intended source)

knowPro is the conversation-memory system of record, so reading the signal from it — rather
than a contextSelector-owned buffer — is the architecturally correct end state. It already
defines exactly the shape we want (`knowledgeSchema.ts:25-66`):

```ts
type ConcreteEntity = {
  name: string;
  type: string[];
  facets?: { name; value }[];
};
type KnowledgeResponse = {
  entities: ConcreteEntity[];
  actions;
  inverseActions;
  topics: string[]; // "Detailed, descriptive topics and keyword"
};
```

- **`topics: string[]`** is already a distilled keyword list — the same shape as our agent
  keyword vectors — and entity `type[]` / `name` are keyword-like. A context vector built
  from these would be richer, pre-canonicalized, and sourced from the system that properly owns
  conversation history.
- **Why V1 ships first anyway:** knowPro knowledge is **LLM-extracted per message**, so it is
  (a) **non-deterministic** and (b) only exists when extraction runs — which agent-server
  disables today for cost. Extraction is _async / queued_, so _reading_ already-extracted topics
  is not a hot-path LLM call — but the data must first be populated. So V1's contextSelector-owned
  buffer is the pragmatic starting point for simplicity and benchmarking; the swap to knowPro
  happens once that extraction is available in agent-server mode.

So V1 is not so much "thrown away" as a **deterministic stepping stone**: it validates the
scorer and yields the first benchmarks, then V2 takes over the signal from knowPro — the system
that rightly owns conversation history — behind the same seam.

---

## 8. Part C(ii) — Conversation frequency model

> **✅ DECIDED: recent turns count more than older ones — each turn's influence fades
> smoothly as the conversation moves on, so the signal tracks topic shifts instead of
> lingering on stale topics.** We keep roughly the last 20 turns and weight each by how long
> ago it was, halving a turn's weight about every ~7 turns. Concretely the context vector
> sums each buffered turn's tokens weighted by `λ^age` (age = turns ago). The two numbers —
> `decay (λ) = 0.9` and `windowTurns (N) = 20` — are config knobs so they can be retuned from
> local benchmarks without code changes.

### Reasoning & context

Part C(i) (§7.2) already settled the **source** — a contextSelector-owned ring buffer of raw
requests (the only user-words signal available in agent-server mode; `ChatHistory` is empty
there). So the original **C-4** ("recompute on demand from `ChatHistory`") is **moot** and
the only open question here is the **recency model** over that buffer: how to weight older
turns vs. newer ones.

**Why decay (not a uniform window).** Uniform-last-`N` is just decay with `λ=1` — every turn
counts equally, with a hard cutoff at the window edge. Decay (`λ<1`) instead fades older
turns smoothly, which is what lets a **topic shift** flip the winner: after the user moves
from spreadsheets to calendar, the stale spreadsheet turns lose weight and calendar takes
over within a few turns instead of lingering until they age out of the window.

**Why `λ = 0.9`, `N = 20`.** Two intuitive readings of `λ` pin the choice:

| λ       | half-life `ln0.5/lnλ` | effective window `1/(1-λ)` | turns to flip after an 8-turn topic | feel             |
| ------- | --------------------- | -------------------------- | ----------------------------------- | ---------------- |
| 0.8     | ~3 turns              | 5                          | ~3                                  | snappy / jittery |
| **0.9** | **~6.6 turns**        | **10**                     | **~5**                              | gentle, stable   |
| 0.95    | ~13.5 turns           | 20                         | ~8                                  | sluggish         |

- `λ = 0.9` → ~6–7-turn half-life and ~10-turn effective window: recent enough to track a
  genuine topic change in a handful of turns, stable enough not to whipsaw on one stray
  message. (The "turns to flip" column is the geometric-sum crossover where a new topic
  outweighs a prior 8-turn topic: `(1−λ^m) > λ^m·(1−λ^8)`.)
- `N = 20` hard cap ≈ 2× the effective window, so the buffer keeps everything still carrying
  meaningful weight (`0.9^20 ≈ 0.12`) and discards the truly stale tail — `N` and `λ` stay
  consistent rather than fighting.
- Avoid `λ ≤ 0.8` (one off-topic message can swing routing) and `λ = 1.0` (no decay, the
  case we rejected).

**Implementation notes.**

- The owned buffer needs a few **invalidation hooks** (`@history clear`, session switch;
  §7.2) — the bounded cost of holding state instead of deriving it.
- If top-K pruning of the map is ever added, **prune by _effective_ (post-decay) weight**,
  not raw counts — otherwise a stale-but-frequent token can crowd out a fresh decisive one.
- Defer cross-session warm carryover entirely (reproducibility).

---

## 9. Part D — Scoring algorithm

> **✅ DECIDED: score with TF-IDF now, and evaluate embedding similarity later — those are the
> only two approaches on the roadmap.** The scorer ranks each candidate by how much the recent
> conversation overlaps its keywords, counting most the words that uniquely point to one
> candidate and cancelling words the colliding candidates share (candidate-local IDF). Keyword
> _order_ is ignored (each candidate's keywords are a set). This evolves in lockstep with the
> §7 signal source:
>
> 1. **Now — simple context vectors → TF-IDF.** V1's raw-token context vector feeds the
>    candidate-local IDF-weighted overlap below. Deterministic, explainable, no dependency.
> 2. **Next — knowPro entities → TF-IDF (same scorer).** When the signal source swaps to
>    knowPro's topics/entities (§7.3 V2), they project into the same `{ key → weight }` map and
>    feed the **same** TF-IDF scorer unchanged — the source seam means no scorer rewrite.
> 3. **Later — knowPro via embedding similarity (evaluated).** Once knowPro is the source, we
>    also evaluate **semantic** matching (embedding cosine between the conversation's
>    topics/entities and each candidate's keyword vector) to bridge vocabulary gaps TF-IDF's
>    exact-token overlap can't (e.g. `"spreadsheet editing"` ↔ `excel`). This is the one case
>    that genuinely departs from TF-IDF, and it stays a flagged enhancement (§2 non-goal).
>
> Explicitly **not** on the roadmap: plain cosine, plain dot-product (no IDF), BM25, and
> log-odds/Naive-Bayes. They were evaluated and set aside (below); the forward path is
> TF-IDF → embeddings, not these. (Index: _D-4_ = the chosen TF-IDF overlap.)

```
score(a) = Σ_{ token ∈ C ∩ K_a }  C[token] × disc(token)

  C[token]    = decay-weighted conversational frequency (§8)             — "how much talked about"
  K_a         = candidate a's keyword vector (flattened; order ignored)  — §6
  disc(token) = candidate-local IDF over the colliding set:              — "how distinguishing"
                  token in keywords of all colliding candidates → ~0  (cancels, like "the")
                  token unique to one candidate                 → high (distinguishes)
```

In words: **the sum of the decay-weighted conversational salience of the tokens that
distinguish this candidate.** Fully deterministic and printable — you can show exactly which
tokens fired and why.

### Reasoning & context

The scorer consumes the two §4 inputs: the context vector `C` (decay-weighted frequency map,
§8) and each candidate's keyword vector `K_a` (§6). Two sub-decisions shape it:

**Candidate-local, not global, IDF.** Global IDF (documents = all ~30 agents) is noisy and
non-local — installing an unrelated agent that also lists "item" would shift `idf("item")` and
perturb _excel-vs-list_ routing. Candidate-local IDF (documents = just the 2–3 colliding
candidates) asks only "does this token distinguish _these_ candidates?": shared tokens cancel
(`~0`), unique tokens score high. Computed fresh per collision, immune to unrelated agents, cheap.

**Flattened keyword sets (order ignored).** `disc` and `C[token]` already encode which keywords
matter; position is a noisier third proxy, and the ranks come from crude counts or LLM ordering.
So `posWeight = 1` always (the list is a **set**), with all weighting from `C × disc`. Capped
positional weighting is parked as a tuning lever if benchmarks show rank-0 keywords are
under-counted.

### The scoring roadmap — TF-IDF now, embeddings later

D-4 (TF-IDF) ships and stays unchanged as the signal source moves from raw tokens to knowPro
entities (the source seam, §7). The one forward step that adds genuinely new power is
**embedding similarity** — matching on _meaning_ rather than exact tokens, to bridge gaps like
`"spreadsheet editing"` ↔ `excel` that lexical overlap can't:

```
simple context vectors ─► D-4 TF-IDF ─► knowPro entities ─► D-4 TF-IDF ─► embedding similarity (evaluated)
   (§7 V1 source)         (now)          (§7 V2 source)      (same scorer)   (semantic match, flagged)
```

The other lexical formulas (cosine, dot-product, BM25, log-odds) were evaluated and set aside —
they lose information D-4 keeps or add untunable machinery that buys little on tiny, uniform
keyword lists (per-option rationale in §15). The forward path is TF-IDF → embeddings, not these.

---

## 10. Part E — Decision rule (resolve vs. abstain)

> **✅ DECIDED: resolve only when the winner is both clearly on-topic and clearly ahead of
> the runner-up — otherwise abstain and let today's behavior take over.** Concretely,
> contextSelector picks a winner only when (1) two mandatory safety guards pass, (2) the
> winner matches _enough_ topical signal (the "evidence gate"), and (3) it beats the
> runner-up by a margin. Fail any of these and it **abstains**, passing the candidates
> through unchanged. The bias is deliberately toward abstaining — a wrong silent reroute is
> worse than a missed opportunity.

### How it works, in plain language

A collision arrives; the scorer (§9) gives each candidate a number. Before trusting the top
score, contextSelector runs four checks, in order. **All four must pass to resolve;** failing
any one means abstain.

1. **Coverage check** — _do all the colliding candidates even have keywords?_ If any
   candidate's keyword vector is empty, abstain. (Otherwise an agent with keywords would beat an
   agent without them just for being covered — not because the conversation favored it.)
2. **History-only** — _score from what was said before this request._ The current message
   itself is excluded, so contextSelector reflects the _conversation_, not the words in the
   request being routed.
3. **Enough-signal check (the evidence gate)** — _is the winner actually on-topic?_ The
   winner must match at least a couple of the candidate's distinct keywords (`minUniqueTokens`,
   default 2), and those matches must carry enough total weight (`minMass`). One stale mention
   isn't enough.
4. **Clear-winner check (the margin)** — _is the winner clearly ahead?_ The top score must
   beat the runner-up by a margin. If two candidates are both on-topic, that's genuine
   ambiguity → abstain and let the user/priority decide.

### Worked examples

Running collision: user says _"add a row"_ → `excel.addRow` vs `list.addItems`.
(excel keywords ⊃ {spreadsheet, formula, cell, row, column}; list keywords ⊃ {item, grocery,
shopping}.)

| Recent conversation (context vector)                            | What happens        | Why                                                                                                                                 |
| --------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `{spreadsheet:8, formula:5, cell:4}`                            | **Resolve → excel** | excel matches 3 distinct keywords (≥2 ✓), mass 17; list matches 0. Clearly ahead.                                                   |
| `{meeting:6, calendar:3}`                                       | **Abstain**         | Neither candidate matches anything (0 < 2). Conversation isn't about either — fall through.                                         |
| `{spreadsheet:4, formula:3, grocery:4, shopping:3}`             | **Abstain**         | excel matches {spreadsheet, formula} = 7; list matches {grocery, shopping} = 7. Both on-topic, no clear winner → genuine ambiguity. |
| `{spreadsheet:8, formula:5}` but `list` has **no keywords yet** | **Abstain**         | Coverage check fails — don't let excel win just because list is uncovered.                                                          |
| `{excel:1}` (one stale mention, 12 turns ago)                   | **Abstain**         | After §8 decay, `excel`'s weight is tiny; fails `minMass`. One old mention shouldn't reroute.                                       |

Notice every resolve/abstain is **explainable from counts** — e.g. "resolved to excel:
matched {spreadsheet, formula, cell} (3 ≥ 2), mass 17, runner-up 0." That readability is
exactly what the local benchmark output needs to calibrate the thresholds.

### Why this rule

The evidence gate is what makes a _count-based_ score safe to threshold — it asks "enough
signal?" and "clear winner?" in units you can read, instead of an opaque similarity number.
Because D-4's candidate-local IDF cancels shared tokens, the runner-up often scores ~0, so an
**absolute** margin is clean and avoids the divide-by-zero a relative ratio would hit.

**Thresholds to calibrate (on fixtures, biased toward abstention):** `minUniqueTokens`
(start 2), `minMass`, and `margin`. A missed opportunity is cheaper than a wrong silent
reroute, so tune conservative.

---

## 11. Part F — Integration & UX

> **✅ DECIDED.**
>
> - **Where it runs:** only on the fast grammar/cache path (Stage 1) — the one place a
>   confident pick actually avoids an LLM call. Collisions on the slower embedding path keep
>   today's behavior. (Index: _F-2_, inside `resolveGrammarCollision`.)
> - **When it abstains:** by default it hands the collision to today's strategy
>   (`first-match` / `priority` / `user-clarify`) at no extra cost; an opt-in mode can instead
>   escalate the request to the LLM. Configurable, default = hand off to today's strategy.
> - **What the user sees:** when the feature is on, a small non-blocking note —
>   _"↪ routed to Excel — recent topic · change"_ — so a topical reroute is never invisible
>   (nothing is shown while the feature is off). A fully-silent mode is opt-in only; a
>   "confirm once, then remember" variant is documented as a future enhancement.

### 11.1 Where to insert (F)

**Why the grammar/cache path only (F-2).** contextSelector behaves like a deterministic
fast-path there: **confident → pick the winning Stage-1 match (no LLM); abstain → get out of
the way and let the request proceed to the LLM path.** This is the **only** place it avoids an
LLM, it's one insertion, and it matches the natural request flow (§4). Inserting at the
embedding/`llmSelect` tie is a _different, lower-value_ feature — a deterministic tiebreak when
we're already committed to the LLM, with **no cost saving** — so it is out of v1 scope.
Extending `resolvePreferenceClarify` (F-3) is worth it _only_ if we later want both-path
coverage plus consent/learning reuse from a single change. (Full option table in §15.)

#### Abstain semantics (what the fallback is)

On the grammar path Stage 1 _already_ produced a match, so "abstain" picks between two
fallbacks: **defer to the configured strategy** (`first-match`/`priority`/`user-clarify`) —
stays on the cache path, preserves today's behavior exactly, zero added cost — or
**escalate to the LLM path** (re-translate) — conceptually clean ("deterministic shortcut, else
LLM") but forces an LLM call on every low-confidence collision. **Default: defer-to-strategy**,
with `escalate-to-llm` as an opt-in. Either way, abstain never makes the decision worse than
today — it only chooses _which_ existing fallback runs.

### 11.2 UX — what the user sees when it resolves

When enabled, contextSelector shows a small non-blocking note on a reroute — **U-2**:
_"↪ routed to Excel — recent topic · change"_ — cheap, transparent, keeps the LLM-avoidance
win, and one-tap correctable. A pure-silent reroute (U-1) is opt-in only (it would be the
product's first zero-consent invisible reroute). A "first-time confirm → write a learned
preference → silent thereafter" variant (U-3) is documented as a future enhancement that
bootstraps Tier-1 preferences (pairs with F-3 if taken later).

### 11.3 Config surface (Part H)

The config type is kept lean (the existing `llmSelect` block has 4 fields). Only `detect`
is exposed via `@config` (per the existing convention); the rest are `data.json` hand-edits:

```ts
contextSelector: {
  detect: boolean; // off by default
  windowTurns: number; // ring-buffer look-back (N, default 20)
  decay: number; // per-turn recency decay (λ, default 0.9)
  minUniqueTokens: number; // evidence gate (default 2)
  minMass: number; // evidence gate (default tuned on fixtures)
  margin: number; // discriminative margin / ratio
  abstainFallback: "defer-to-strategy" | "escalate-to-llm"; // default "defer-to-strategy"
}
```

**Defer to follow-ups (don't ship the knobs):** weighting scheme + `gamma`, global
idf vs candidate-local toggle, `softMatch` embeddings, `warmCarryover`,
`useEntities`, `useAgentOfRecord`, sub-schema granularity switches.

---

## 12. Part G — Determinism hardening

Determinism (G3) is the whole reason this design exists instead of an LLM tiebreaker, so
each item below closes a specific way the _same_ conversation state could otherwise produce a
_different_ routing decision. This is a requirements checklist, not an either/or choice.

**Scoring & comparison**

- **Total ordering everywhere:** tie-break by canonical token string, then stable
  `schemaName`, then `actionName`. No reliance on `Map` insertion order or input
  order from the embedding search.
- **Quantize scores** to a fixed precision (or define an explicit epsilon) before
  threshold/margin comparisons, so float summation order can't flip a borderline decision.
- **Candidate-local IDF over a canonically-ordered candidate set (§9).** The
  discriminativeness math (and its telemetry) must see the colliding candidates in a stable
  sorted order — ties inside it resolve via the ordering above.

**Text processing**

- **Pin** the stemmer, Unicode normalization, and tokenizer versions; treat them
  as part of the determinism contract (snapshot-test the canonicalizer).
- **Domain-aware tokenizer with protected patterns** for product names,
  languages, file extensions, and refs (`C#`, `C++`, `.NET`, `A1:B2`, `xlsx`).

**Conversation state (the context vector, §7–§8)**

- **History-only** input: the current request never contributes to its own
  context profile.
- **Ring-buffer state is deterministic & invalidation-complete (§7.2).** The
  contextSelector-owned buffer must be a pure function of the request sequence and must
  reset on `@history clear` / session switch — no stale cross-session state, or "same
  conversation" stops meaning "same decision."
- **Decay from a stable turn index, not wall-clock (§8).** `λ^age` must use turn _position_,
  not elapsed time — otherwise the same conversation scores differently on a fast vs. slow
  replay, breaking fixture tests and benchmark replay.

**Note on the keyword pipeline.** LLM-distilled keywords (and the V2 knowPro source, §7.3)
are LLM-generated and therefore non-deterministic — **but only when the vector is produced**
(the offline distillation pass, or keyword-vector generation for a dynamically-added action). Each
action's vector is fixed once at that point and is not recomputed per request, so the
**collision-time scoring path that reads it stays fully deterministic**. The LLM in the
keyword pipeline does **not** violate G3.

---

## 13. The v1 design

### 13.1 What ships (the complete core design, as one change)

| Part            | Pick                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — home        | **A-2 × A-3** (§5): schema/action-granular derived defaults + a live-tunable `collision-keywords.json` sidecar override                                                                                                                                   |
| B — source      | **Two keyword sources** (§6): an always-present keyword vector per action (LLM distillation **preferred**, deterministic lexical extraction as the fallback floor) plus an optional, layered _sidecar_ (user tuning · misroute mining · user preferences) |
| C(i) — signal   | **V1 source seam** (§7): user-message tokens from a contextSelector-owned raw-request ring buffer                                                                                                                                                         |
| C(ii) — model   | **Recency-decayed ring buffer** (§8): `λ=0.9`, `N=20`                                                                                                                                                                                                     |
| D — scorer      | **D-4** candidate-local IDF-weighted token overlap (TF-IDF), flattened keyword vectors (§9)                                                                                                                                                               |
| E — decision    | full-coverage guard + history-only + **E-2** evidence gate (§10)                                                                                                                                                                                          |
| F — integration | **F-2** grammar/cache path only — confident ⇒ no-LLM shortcut; abstain ⇒ fall through (abstain fallback configurable, default defer-to-strategy) (§11)                                                                                                    |
| U — UX          | **U-2** visible non-blocking affordance when enabled (invisible while off) (§11.2)                                                                                                                                                                        |
| H — config      | 7-field type, only `detect` exposed via `@config` (§11.3)                                                                                                                                                                                                 |

All of the above ship **together** as v1: no manifest change, no onboarding-LLM in the hot
path, one integration point, a fixed correctness guard, and a trust-preserving affordance.
Delivers the named excel↔list scenario.

### 13.2 Deferred to later (stretch goals, not in v1)

Pulled in later only where local benchmarks show v1 abstaining too often or mis-resolving —
each explicitly **out of v1 scope**: the **V2 knowPro topic/entity source** (§7.3; requires
enabling agent-server-mode extraction first), per-action / sub-schema vectors, capped
**agent-of-record** (C-3; lock-in risk), **embedding-similarity scoring** (the planned step-3
upgrade once knowPro is the source — semantic match for synonyms, §9), the **F-3 both-path /
embedding-path coverage** (deterministic tiebreak only — no LLM saved), and **U-3
learned-preference bootstrap** (confirm-then-learn).

> The alternative lexical scorers (BM25, log-odds/Naive-Bayes) are **not** deferred upgrades —
> they were evaluated and rejected (§9); the intended scoring evolution is TF-IDF → embeddings.

### 13.3 Known gaps (accepted for v1)

- **Embedding/llmSelect-path collisions** are not handled — acceptable, since that path
  already selects a schema LLM-free (§4); contextSelector would save no LLM there anyway.
- **Same-agent / multi-domain collisions** (two schemas of one agent) rely on the
  schema/action granularity (§5); rare today.

### 13.4 Rollout & validation

No users / no production traffic, so there is **no real-traffic shadow phase**. Instead:

1. Ship with `detect: off` (a simple on/off feature gate).
2. **Validate locally against fixtures** — labeled collision scenarios (the vampire↔list set
   plus spreadsheet/calendar cases) — checking resolve/abstain behavior and calibrating the
   evidence-gate thresholds (`minUniqueTokens` / `minMass` / `margin`). `λ=0.9` / `N=20` were
   chosen up front (§8) and are likewise fixture-validated.
3. Flip `detect: on` once the local benchmarks pass.

Telemetry (per-candidate score + the matched `token→weight` pairs) is emitted so the local
benchmark output is explainable and exact.

---

## 14. Worked examples

A full end-to-end trace exercising every locked decision. Running collision: the user says
_"add a row"_, which the grammar matches for both `excel.addRow` and `list.addItems`
(Stage 1, §4).

**Candidates — flattened keyword vectors (§6, §9)** — shared by both scenarios below.

- `excel.addRow` → `{excel, spreadsheet, cell, formula, pivot table, workbook, row, column}`
- `list.addItems` → `{list, item, todo, grocery, shopping, checklist}`

### Scenario 1 — Resolve (a clear topical winner)

**Recent user turns, tokenized into the ring buffer (§7, most recent first; the current
"add a row" is excluded — history-only, §10).**

| age | prior user turn → canonical tokens (§12)               |
| --- | ------------------------------------------------------ |
| 1   | "fix the spreadsheet formula" → `spreadsheet, formula` |
| 2   | "which cell has that formula" → `cell, formula`        |
| 3   | "open the excel spreadsheet" → `excel, spreadsheet`    |
| 4   | "scroll to the last row" → `row`                       |

**Context vector — recency-decayed (§8, `λ=0.9`, weight = Σ `λ^age`).**

| token       | ages | weight `Σ 0.9^age`     |
| ----------- | ---- | ---------------------- |
| formula     | 1, 2 | 0.90 + 0.81 = **1.71** |
| spreadsheet | 1, 3 | 0.90 + 0.73 = **1.63** |
| cell        | 2    | **0.81**               |
| excel       | 3    | **0.73**               |
| row         | 4    | **0.66**               |

⇒ `C ≈ { formula:1.71, spreadsheet:1.63, cell:0.81, excel:0.73, row:0.66 }`.

**Score — D-4, candidate-local IDF (§9).** None of these tokens appear in _both_ candidate
sets, so each is fully distinguishing (`disc = 1`). `score(a) = Σ_{t ∈ C ∩ K_a} C[t]·disc`:

- `excel.addRow` matches all five (`formula, spreadsheet, cell, excel, row`) → **≈ 5.54**, across **5 distinct tokens**.
- `list.addItems` matches none → **0**.

**Decision — the four checks (§10), in order.**

1. **Coverage** — both candidates have non-empty keyword vectors ✓
2. **History-only** — `C` was built from turns _before_ "add a row" ✓
3. **Evidence gate** — excel matched 5 distinct tokens (≥ `minUniqueTokens` 2) ✓, mass 5.54 (≥ `minMass`) ✓
4. **Clear-winner margin** — 5.54 vs 0, decisive ✓

⇒ **Resolve to `excel.addRow`** — deterministically, on the grammar/cache path with **no LLM
call** (F-2), surfacing the U-2 affordance: _"↪ routed to Excel — recent topic · change"_.
The decision is fully explainable from counts: _matched {formula, spreadsheet, cell, excel,
row} (5 ≥ 2), mass 5.54, runner-up 0._

### Scenario 2 — Abstain (a genuine tie)

Same collision, but the recent conversation has touched **both** topics roughly equally —
the case where abstaining is exactly right (let the existing tiers ask or decide).

**Recent user turns (history-only, §7/§10):**

| age | prior user turn → canonical tokens (§12)                    | leans |
| --- | ----------------------------------------------------------- | ----- |
| 1   | "fix the spreadsheet formula" → `spreadsheet, formula`      | excel |
| 2   | "eggs for the grocery + shopping run" → `grocery, shopping` | list  |
| 3   | "my todo checklist" → `todo, checklist`                     | list  |
| 4   | "open excel, select the cell" → `excel, cell`               | excel |

**Context vector — decayed (§8, `λ=0.9`):**
`C ≈ { spreadsheet:0.90, formula:0.90, grocery:0.81, shopping:0.81, todo:0.73, checklist:0.73, excel:0.66, cell:0.66 }`

**Scores — D-4, candidate-local IDF (§9)** (still no token shared between the two sets, so
`disc = 1` throughout):

- `excel.addRow` matches `{spreadsheet, formula, excel, cell}` → 0.90+0.90+0.66+0.66 = **3.11**, 4 tokens
- `list.addItems` matches `{grocery, shopping, todo, checklist}` → 0.81+0.81+0.73+0.73 = **3.08**, 4 tokens

**Decision — the four checks (§10):**

1. **Coverage** — both non-empty ✓
2. **History-only** — built from prior turns ✓
3. **Evidence gate** — the top candidate (excel, 3.11) matches 4 distinct tokens (≥ 2) with
   ample mass ✓ — there _is_ plenty of signal
4. **Clear-winner margin** — 3.11 vs 3.08, gap **0.034** → **fails** the margin ✗

⇒ **Abstain.** Both candidates are strongly on-topic, so this is _genuine_ ambiguity, not a
weak signal — exactly when contextSelector should _not_ guess. The candidate set passes
through **unchanged** to the configured grammar strategy (default `first-match`; or
`user-clarify`/`priority` if set), which decides as it would today (§11.1).

> The margin check is what separates this from Scenario 1: both clear the _evidence_ gate, but
> only Scenario 1 has a clear _winner_. Without the margin, a 0.034 lead would silently route
> to excel — a coin-flip dressed up as a decision.

### Other abstain modes (brief)

- **No signal** — recent turns about scheduling (`C ≈ {meeting:…, calendar:…}`): neither
  candidate matches → both score 0 → evidence gate fails → **abstain**.
- **Coverage gap** — `list.addItems` has no keywords yet → coverage check fails → **abstain**
  (don't let excel win just for being covered).

In every abstain case the candidate set passes through **unchanged**, so contextSelector is
strictly additive — it can only resolve a collision the existing tiers would have, never make
routing worse.

---

## 15. Alternatives opted against

A running record of options considered and rejected as decisions are locked, kept
out of the main flow so the body reads as the chosen design.

### Part A — where keyword data lives (decided §5)

| Rejected option                                      | Why not                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-1** keywords on `AppAgentManifest` (agent-level) | Wrong granularity: one agent can own several schemas (`subActionManifests`), so two colliding `(schema, action)` candidates of the _same_ agent would get identical keyword vectors and permanently abstain. Also requires an agent re-ship to edit. |
| **A-4** keywords in profile / runtime-learned state  | Keywords are agent-descriptive — identical for every user — so they are not user data and do not belong in a per-user profile.                                                                                                                       |

_Folded into the decision rather than rejected: **A-2** supplies the correct
schema/action granularity, **A-3** supplies live, re-ship-free tuning — the
decision uses both (A-2 defaults + A-3 overrides)._

### Part B — keyword production (decided §6)

| Rejected option                               | Why not                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Embedding-cluster action vectors → labels** | Heavier and opaque, and the labeling step usually needs an LLM — collapsing back into the offline-distillation drift/dependency profile without its review/control. (Whether the _scorer_ may use embeddings is a separate open Part D question; embedding-derived _keywords_ are out.) |

_Folded into the decision rather than rejected: LLM distillation, lexical extraction, and
misroute mining are **layered, not competitors** — see §6. Each action's vector prefers
**LLM distillation** (higher quality — synonyms the schema never says) and falls back to a
**deterministic lexical floor** that guarantees coverage of every action (including
un-distilled and dynamic agents); misroute mining and learned preferences then sharpen only the
colliding few via the sidecar. Distillation-only loses guaranteed coverage; lexical-only loses
quality — so distillation is preferred with lexical as the floor._

### Part C(i) — conversation signal source (decided §7)

| Rejected / deferred                                      | Why                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source = `ChatHistory`** (C-4's premise)               | In agent-server mode (our target) `ChatHistory` has no user entries — `requestKnowledgeExtraction` is `false` there (§7.1). A `ChatHistory`-derived context vector would be empty exactly where contextSelector runs. |
| **C-3** agent-of-record (recent winners)                 | Self-reinforcing feedback loop → lock-in on a prior winner; needs caps + same-pair exclusion before it's safe. Deferred behind local benchmark data.                                                                  |
| **C-2 via `ChatHistory` entities** as the primary signal | The entities that survive agent-server mode are _action-result_ (system-output) entities, not the user's phrasing — output-biased. The richer user-topic signal is V2 (knowPro topics/entities) instead.              |

_Folded into the decision: V1 raw-token map (deterministic, agent-server-safe — a simple start
for benchmarking) and V2 knowPro topics/entities (the intended source, owned by the
conversation-memory system of record) behind one source seam — see §7._

### Part D — scoring algorithm (decided §9)

| Rejected (not on the roadmap)                | Why                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** pure cosine                          | Angle-only ⇒ `{excel:1}` and `{excel:100}` score identically; rewards tiny vectors; fixed confidence threshold uncalibratable.                                                                                                                                                                                                                                                                              |
| **D-2** weighted dot product (no IDF)        | "D-4 minus discriminativeness" — long-list/keyword-stuffing bias; generic shared tokens inflate both candidates. Choosing candidate-local IDF already subsumes it.                                                                                                                                                                                                                                          |
| **D-3** BM25-lite                            | Built for long, length-varied documents; our ~8-token keyword lists are tiny/uniform so length-norm does little, and `k1`/`b` have no data to tune. TF runaway already bounded by decay (§8) + the evidence gate (§10). **Not pursued** — the intended next step is embeddings, not a lexical refinement.                                                                                                   |
| **D-5** log-odds / Naive-Bayes               | The per-token `log[P(t\|a1)/P(t\|a2)]` is what candidate-local IDF approximates (D-4 ≈ smoothing-free log-odds). A "real" D-5 must fabricate `P(token\|a)` from tiny keyword lists → mandatory smoothing whose parameter dominates, illusory calibration without labeled data, independence-assumption overconfidence. **Not pursued** — D-4 already captures the useful part; the next gain is embeddings. |
| **Positional weighting** (reciprocal/capped) | Order signal is a third, noisier proxy already covered by `disc × C`; stacking three uncalibrated multipliers risks one factor dominating. **Flattened (set)** for v1; capped positional weighting parked as a tuning lever.                                                                                                                                                                                |

_Folded into the decision: the scoring roadmap is **TF-IDF now → embedding similarity later**.
**D-4** = candidate-local IDF-weighted token overlap with flattened keyword vectors (ships now,
unchanged when the source becomes knowPro entities); **embedding similarity** is the one
forward step that adds semantic matching (evaluated once knowPro is the source, flagged per §2).
Cosine/dot-product/BM25/log-odds are evaluated and set aside, not deferred upgrades — see §9._

### Part E — decision rule (decided §10)

| Rejected option                                           | Why                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **E-1** absolute threshold + margin on a **cosine** score | Cosine magnitude isn't calibratable across conversations (§9); cosine dropped anyway.                         |
| **E-3** relative ratio `s1/s2 ≥ ρ`                        | Runner-up is frequently ~0 (shared tokens cancel) → ratio explodes / divides by zero; needs an awkward floor. |
| **E-4** z-score / rank-gap                                | Needs a population of candidate scores; collisions are usually 2 candidates, where a z-score is meaningless.  |

_Chosen: an **absolute** evidence gate (`minUniqueTokens` + `minMass`) plus an absolute
discriminative `margin` — readable in count units and divide-by-zero-free; see §10._

### Part F — integration & UX (decided §11)

| Rejected option                                    | Why                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-1** standalone tier on **both** paths          | Two insertions; duplicates wiring; the llmSelect side saves no LLM.                                                                                    |
| **F-3** inside `resolvePreferenceClarify`          | One change covers both paths and reuses consent/learning — but couples to `preference-clarify` plumbing; revisit only if both-path coverage is wanted. |
| **F-4** dynamic `priorityOrder` feeding `priority` | Re-derives priority per request (surprising for a "static" knob); no evidence gate / abstain semantics.                                                |
| **U-1** pure-silent reroute                        | Product's first zero-consent invisible reroute; no correction affordance. Opt-in only.                                                                 |
| **U-3** confirm-once → learned preference → silent | Bridges into the existing consent model and bootstraps Tier-1 prefs — documented as a future enhancement (pairs with F-3).                             |

_Chosen: **F-2** grammar/cache-path-only insertion (the only place it avoids an LLM), abstain
defaults to deferring to today's strategy, and **U-2** a visible non-blocking affordance; see §11._
