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

Give each agent a set of topic keywords, derive a keyword profile of the recent
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
- **G6.** No required LLM. Keyword sourcing has a deterministic, drift-proof
  default; LLM distillation is an _optional_ quality boost.

### Non-goals

- Not replacing `user-clarify`/`priority`/learned preferences — it composes with
  them and defers on abstention.
- Not an embedding/NLU re-architecture. Core matching is lexical. Embedding
  soft-match is an optional, flagged enhancement only.
- Not a durable per-user profile. The conversation profile is session-scoped.

---

## 3. Architecture (end to end)

The full system in one view — keyword production (frozen before runtime) on the left,
the per-turn context vector in the middle, and the collision-time decision on the right:

```
═══════════════════════════════════════════════════════════════════════════════
  A. KEYWORDS — build/author time, frozen before runtime          (§5–§6)
═══════════════════════════════════════════════════════════════════════════════
   agent schema text ──► B-2 lexical extract ─┐
   misroute phrases  ──► B-3 phrase mining   ─┤─►  keyword set per (schema, action)
   LLM (offline)     ──► B-1 distill         ─┘                 │
   collision-keywords.json ──► override (add / remove / replace)┘
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
        keyword sets (A)                    context vector (B)
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

**Reading it:** A produces a static keyword set per `(schema, action)`; B maintains a live,
decayed keyword-frequency map of the conversation; at a collision, C scores each colliding
candidate's keyword set against that map and either resolves (deterministically, no LLM) or
abstains to today's behavior. The only LLM in the whole picture is the _optional, offline_
B-1 distiller — the runtime hot path is LLM-free and deterministic.

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
  phrases are a deterministic **source** for keyword production (§6 B-3).

---

## 5. Part A — Where keyword data lives

> **✅ DECIDED: keywords are attached to each individual action, and can be hand-tuned at
> runtime via a small override file — without rebuilding or re-shipping the agent.**
> Each action gets a default keyword set (auto-derived, §6), and a separate
> `collision-keywords.json` sidecar lets you **add / remove / replace** keywords for the
> handful of actions that actually collide; it stores only those deltas and hot-reloads as
> data. (Indices: _A-2_ = per-action granularity, matching the `(schema, action)` collision
> identity; _A-3_ = the sidecar override.) Rejected alternatives — keywords at the
> whole-agent level, or in per-user profile state — are in §15.

**Why this split.** Two forces pull in different directions: _correctness_
(granularity must match the `(schema, action)` collision identity, or two schemas of
one multi-domain agent get identical vectors and permanently abstain) pulls
toward per-schema; _evolvability_ (tune the colliding few without re-shipping an
agent) pulls toward a runtime sidecar. A-2 supplies the first, A-3 the second.
Derived-at-load sourcing (§6 B-2) means the "home" question largely dissolves —
there is nothing to store except optional overrides.

### 5.1 How the sidecar works (mechanism)

The override file is its **own** sidecar — a `collision-keywords.json`, **not**
`neighborhoods.json` (which keeps its separate collision-detection role; see §6 B-3). It
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

**Effective keyword set** for a `(schema, action)`:

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

> **✅ DECIDED: every action's keywords come from a layered stack — automatically extracted
> from its own schema text (always available), optionally improved by an offline LLM pass,
> and optionally enriched from real misroute examples — with manual overrides on top.**
> The layers, highest priority first:
>
> ```
> effective keywords =  manual override (§5 sidecar)       // human fixes — top priority
>                    ▷  LLM-distilled  (+ misroute phrases) // quality layer, where present
>                    ▷  lexical-from-schema                 // always-on floor, every action
> ```
>
> The lexical floor guarantees _every_ action has keywords on day one (no authoring needed,
> drift-proof); the other layers add quality only where it's worth it. (Indices: _B-2_ =
> lexical floor, _B-1_ = LLM distillation, _B-3_ = misroute-phrase mining.) The rejected
> alternative — generating keywords from embedding clusters (_B-4_) — is in §15.

### 6.1 The three sources

- **B-2 — lexical-from-schema at load (the floor).** A deterministic extractor mines each
  agent's own schema text — manifest + schema `description`, de-camelCased action names
  (`addItems`→"add items"), parameter names + their JSDoc comments, optionally `.agr`
  grammar literals — minus stopwords and generic CRUD verbs. Recomputed every boot, so it
  is **drift-proof** and covers **every agent including runtime/dynamic ones**
  (`allowDynamicAgents`). This guarantees the §10 full-coverage guard always has something
  to work with. Lower quality (identifier-ish); cannot invent synonyms the schema never
  mentions.
- **B-1 — LLM distillation (the quality layer).** An offline/author-time LLM pass produces
  higher-quality keywords _and synonyms the schema never says_ (`sheet`→`spreadsheet`),
  committed alongside the agent. Accepted costs: a **one-time backfill** of the existing
  agents as part of rollout, and **drift** (committed artifacts go stale) — to be mitigated
  later by an **automated refresh pipeline** in the spirit of the doc-autogen pipelines.
  Determinism is preserved because distillation is offline; the runtime stays model-free.
- **B-3 — mine `neighborhoods.json` misroute phrases (the discriminative boost).** The
  registry records, per known-confusable cluster, the _real user phrases_ that misrouted
  between its members. Mining those yields keywords drawn from how users _actually_ phrase
  each intent — concentrated on exactly the hard, colliding pairs. It covers only agents
  already in the registry (a small **curated set of empirically-colliding clusters, not a
  roster of all agents**), so it is a boost, never the base.

### 6.2 B-2 and B-3 are one deterministic extractor, two corpora (no LLM)

A common point of confusion: **B-3 does not need an LLM.** B-2 and B-3 share a single
deterministic lexical extractor and differ only in the _input corpus_:

| Source  | Input corpus                                    | LLM?                                             |
| ------- | ----------------------------------------------- | ------------------------------------------------ |
| **B-2** | the agent's own schema text                     | no                                               |
| **B-3** | real misroute phrases from `neighborhoods.json` | no — the phrases are pre-existing committed data |
| **B-1** | schema + samples, distilled by a model          | yes — offline only                               |

The extractor is classic IR, no model call:

```
1. tokenize + canonicalize (NFKC, lowercase, strip punctuation)
2. drop stopwords + generic CRUD verbs (add/get/update/remove/show/…)
3. count term frequency across the corpus
4. (for a colliding pair) distinctive-terms weighting — rank a term by how much more it
   appears in this member's corpus than the sibling's (TF-difference / log-odds-ratio),
   so shared/ambiguous tokens cancel and discriminating tokens rise
5. emit the top-N as the keyword set
```

> The misroute phrases in `neighborhoods.json` were themselves LLM-generated in the offline
> corpus run that built the registry — but that is committed _source data_, like a
> human-written schema description. The extraction on top is mechanical, and **runtime is
> never involved**.

### 6.3 Worked example — B-3 on a real cluster

From the shipped registry, the cluster `calendar.findTodaysEvents` ↔
`taskflow.dailyAgendaEmail` records 9 phrases the user _intended_ for
`taskflow.dailyAgendaEmail` but that misrouted to `calendar.findTodaysEvents`:

> "Email me today's agenda." · "Could you send me an email with my schedule for today?" ·
> "Shoot me today's calendar events." · "Send me an email with today's calendar events."

Extraction (steps 1–5) for `taskflow.dailyAgendaEmail`:

- raw tokens → `email, agenda, schedule, send, inbox, calendar, events, today`
- distinctive-terms vs the `calendar` sibling: `today`, `calendar`, `events` appear for
  _both_ intents (they are _why_ the two collide) → cancel; `email`, `agenda`, `send`,
  `inbox` are unique to the email intent → rise
- emitted keywords → **`email, agenda, send, inbox`**

At runtime, if the conversation has been about email (context map `{ email:6, send:3,
inbox:2 }`) and the user says _"get me today's agenda"_ — colliding the two actions — those
mined keywords overlap the conversation for `taskflow` and not for `calendar`, so
contextSelector resolves to `taskflow.dailyAgendaEmail`. The phrases became keywords; the
keywords feed the normal scorer (§9).

### 6.4 When extraction runs (performance)

The B-2 extractor is pure string processing — **no model, no I/O beyond text already parsed
at agent registration**. At the real scale (~30 agents, a few KB of schema text each → ~10k
tokens total) it is **low-single-digit-milliseconds total** — rounding error next to what
boot already does (grammar NFA compilation, loading the embedding model for
`semanticSearchActionSchema`). The cross-agent discriminativeness is _not_ a boot cost
either: we use **candidate-local** weighting computed at collision time over the 2–3
colliding candidates (§10), so boot only produces each agent's keyword _set_.

A concrete sketch:

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

The only real cost risk is a **heavy NLP dependency** (large stemmer/lemmatizer/tokenizer).
Mitigation: a tiny rule-based Porter stemmer, or skip stemming in v1 and lean on the §12
canonicalizer; stopwords/generic-verbs are small `Set`s.

Even so, if "don't touch boot time" is a hard rule, extraction can be moved off the hot
boot path entirely. Strategies, in preference order:

| Strategy                                                     | When it runs                                                  | Boot cost              | Notes                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| **Build-time precompute** _(recommended for shipped agents)_ | at agent **build**; emit `<agent>.keywords.json` into `dist/` | **zero**               | Mirrors the existing `.agr`→`.ag.json` / `.pas.json` artifact pipeline; boot just reads the file. |
| **Content-hash cache**                                       | once, then cached by schema hash/mtime                        | ~zero after first boot | Re-extract only when the schema changes; lives in the agent cache dir. Covers dynamic agents.     |
| **Lazy / on-demand**                                         | first time an agent participates in a collision               | zero at boot           | Collisions are rare → most agents never extracted; sub-ms when one is.                            |
| **Inline at registration**                                   | every boot, piggybacking the existing schema parse            | a few ms total         | Simplest; likely fine as-is given the cost analysis above.                                        |

**Recommendation:** **build-time precompute (zero boot cost, fits the repo's existing
compiled-artifact pattern) for shipped agents**, plus a **content-hash cache / lazy
extraction for dynamically-added agents** (`allowDynamicAgents`) that have no build step.
Zero cost for the common case, correctness for runtime-added agents.

---

## 7. Part C(i) — Conversation signal source

> **✅ DECIDED: the conversation signal comes from a swappable source. For v1 it's the words
> from the user's recent requests; a clean seam lets a richer "extracted topics" source
> replace it later without touching the scorer.** contextSelector reads the conversation
> through one interface (`getRecentConversationSignal()`), with two implementations:
>
> - **v1 (now):** contextSelector keeps its own short buffer of recent **raw user-request
>   text**, tokenized into a keyword-frequency map. Deterministic, no LLM, and — crucially —
>   works in agent-server mode (the connected mode the CLI always uses).
> - **v2 (later):** the richer **topics and entities** that the conversation-memory system
>   (knowPro) already extracts, once that extraction is turned on in agent-server mode.
>
> The seam is what makes the v1→v2 swap a drop-in.

### Reasoning & context — what this section decides and why it's tricky

This section decides **where the context vector's data comes from** — the conversation
half of the scorer (§4). The vector should capture _what the user has recently been
talking about_, so the natural raw material is the user's own recent messages.

Two facts make this non-trivial, and both are **decisive because our deployment target is
agent-server mode** — the connected mode the CLI always uses, and the mode we assume _all_
traffic goes through. Anything that only works in the in-process Electron shell is not good
enough:

1. The dispatcher's conversation stores (`ChatHistory`, knowPro memory) are **populated
   conditionally**, and agent-server deliberately turns the relevant knowledge-extraction
   _off_ (a cost/performance choice — extraction is per-message LLM/embedding work). So the
   data we'd reach for first simply **isn't there in our target mode** (§7.1).
2. The genuinely ideal source — knowPro's _extracted topics and entities_ — is both richer
   and the wrong fit for v1: it is LLM-produced (non-deterministic) and currently
   unpopulated in agent-server mode (§7.3).

That combination is why the decision above is a **source seam**: ship a deterministic,
always-available source now, and leave a clean upgrade path to the richer source later —
without the scorer caring which implementation is behind it.

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

### 7.3 V2 — knowPro extracted topics + entities (the richer source, later)

knowPro already defines exactly the shape we want (`knowledgeSchema.ts:25-66`):

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
  from these would be richer and pre-canonicalized.
- **The tradeoff (why it's V2, not V1):** knowPro knowledge is **LLM-extracted per
  message**, so it is (a) **non-deterministic** and (b) only exists when extraction runs —
  which agent-server disables today for cost. Extraction is _async / queued_, so _reading_
  already-extracted topics is not a hot-path LLM call — but the data must first be
  populated. This mirrors the **B-1-vs-B-2** split on the agent side: a deterministic
  lexical baseline, with an optional richer LLM-backed tier.

So V1 is not so much "thrown away" as **promoted to a deterministic baseline** once V2
lands behind the same seam.

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

> **✅ DECIDED: score each candidate by how much the recent conversation overlaps its
> keywords — counting most the words that uniquely point to one candidate, and ignoring words
> the colliding candidates share.** A word both candidates list can't break the tie, so it's
> cancelled out; a word unique to one candidate, and frequent in the conversation, drives the
> score. Keyword _order_ is ignored (each candidate's keywords are just a set). The richer
> **log-odds / Naive-Bayes** scorer is a documented upgrade for later (it needs labeled data
> we don't have yet); plain cosine similarity was considered and rejected. (Index: _D-4_ =
> this candidate-local IDF-weighted overlap; _D-5_ = the log-odds upgrade; _D-1_ = the
> rejected cosine.)

```
score(a) = Σ_{ token ∈ C ∩ K_a }  C[token] × disc(token)

  C[token]    = decay-weighted conversational frequency (§8)             — "how much talked about"
  K_a         = candidate a's keyword SET (flattened; order ignored)     — §6
  disc(token) = candidate-local IDF over the colliding set:              — "how distinguishing"
                  token in keywords of all colliding candidates → ~0  (cancels, like "the")
                  token unique to one candidate                 → high (distinguishes)
```

In words: **the sum of the decay-weighted conversational salience of the tokens that
distinguish this candidate.** Fully deterministic and printable — you can show exactly which
tokens fired and why.

### Reasoning & context

The scorer consumes the two data inputs from §4: the context vector `C` (decay-weighted
frequency map, §8) and each candidate's keyword set `K_a` (§6). It answers: _how much does
the recent conversation overlap each candidate's keywords, weighted toward tokens that
actually distinguish the candidates?_

**Why not cosine (D-1).** Cosine measures the _angle_ between vectors, so `{excel:1}` and
`{excel:100}` score identically — it cannot tell "mentioned once" from "the whole
conversation," and it rewards tiny keyword vectors. That makes a fixed confidence threshold
uncalibratable. The live options (D-2…D-5) all share the property that **magnitude tracks
evidence**; D-4 is the simplest of them.

**Why D-4 over D-5 (log-odds) for v1.** D-5 yields a calibrated probability, which is
genuinely nicer — but that benefit only matters once we're tuning thresholds against real
data, and it costs smoothing + per-class normalization to specify. D-4 already has every
property v1 needs (evidence-tracking magnitude, explainability, clean fit with the §10
evidence gate), so D-5 is the **documented upgrade**, not the starting point.

**Sub-decision 1 — discriminativeness: candidate-local, not global IDF.** IDF
(inverse document frequency) down-weights tokens that appear across many "documents." Two
flavors: _global_ (documents = all ~30 agents) is noisy at that scale and **non-local** —
installing an unrelated agent that also lists "item" would shift `idf("item")` and thus
perturb _excel-vs-list_ routing. _Candidate-local_ (documents = just the 2–3 colliding
candidates) instead asks "does this token distinguish _these_ candidates?": a token both
share cancels (`~0`), a token unique to one scores high. It is computed fresh per collision,
immune to unrelated agents, and cheap.

**Sub-decision 2 — positional weighting: flattened (order ignored).** Keyword lists come out
frequency-ranked, so an order exists, and one _could_ weight earlier keywords more. We don't,
for v1:

- `disc` (candidate-local IDF) and `C[token]` (conversational frequency) **already encode
  "which keywords matter"** — position is a third, weaker, noisier proxy for the same thing,
  and our ranks come from crude frequency counts (B-2) or LLM ordering (B-1), so they aren't
  trustworthy enough to lean on.
- Stacking _position × disc × frequency_ is three uncalibrated multipliers — exactly where a
  quirk in one factor can dominate. `reciprocal` weighting in particular can make a token the
  user is clearly discussing nearly worthless just because it ranks late in a list (e.g.
  `8 × 1 × 1/8 = 1.0` vs `8 × 1 × 1.0 = 8.0`), letting position override real signal.

Flattening = `posWeight = 1` always, i.e. the keyword list is a **set** ("is this token one
of the candidate's keywords?"), with all the weighting coming from `C × disc`. Capped
positional weighting is parked as a tuning lever if local benchmarks ever show rank-0 keywords
are under-counted.

### The D-spectrum — why D-4 is the sweet spot

The five options are points on one spectrum around D-4; evaluating the neighbors shows why
each is rejected, subsumed, or deferred:

```
D-2 (dot product) ──+ candidate-local IDF + flatten ─► D-4 (chosen) ──+ tf-saturation/length-norm ─► D-3 (BM25)
   "too naive"                                          the sweet spot          "more machinery, marginal here"

                          D-4 ──+ probabilities estimated from labeled data ─► D-5 (log-odds)
                                                                                "needs data we don't have yet"
```

- **D-1 cosine — rejected.** Angle-only: `{excel:1}` and `{excel:100}` score identically; a
  fixed confidence threshold is uncalibratable.
- **D-2 weighted dot product — subsumed.** D-4 _is_ a weighted dot product; D-2 without IDF
  is "D-4 minus discriminativeness" → long-list/keyword-stuffing bias and generic shared
  tokens inflate both candidates. Choosing candidate-local IDF already rejects it.
- **D-3 BM25-lite — deferred refinement.** Adds tf-saturation + length-normalization, but
  it's built for long, length-varied documents; our ~8-token keyword lists are tiny and
  uniform, so length-norm does little, and its `k1`/`b` params have no data to tune. TF
  runaway is already bounded by our **decay** (§8) + the **evidence gate** (§10); if mild
  saturation is wanted, a one-line sublinear `1+log(f)` buys most of it. Borrow BM25 only if
  local benchmarks show a token-dominance or length-bias pathology.
- **D-5 log-odds / Naive-Bayes — documented upgrade (data-gated).** The per-token term
  `log[P(t|a1)/P(t|a2)]` _is_ what candidate-local IDF approximates (shared tokens cancel,
  unique tokens dominate) — so D-4 is essentially a **smoothing-free log-odds**. Real D-5
  needs `P(token|a)`, which we'd have to fabricate from tiny keyword lists today: that forces
  **mandatory smoothing whose parameter dominates the result** (no data to set it), its
  "calibrated probability" is **illusory without labeled data** (still needs fixture
  calibration), and the **independence assumption inflates confidence** on correlated topic
  tokens. It earns its place only once a **labeled collision
  corpus** (from local benchmarks/fixtures) lets us estimate `P(token|a)` from data — exactly why it's the upgrade, not v1.

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
   candidate's keyword set is empty, abstain. (Otherwise an agent with keywords would beat an
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

### Reasoning & the rejected options

The evidence gate is what makes a _count-based_ score safe to threshold — it directly asks
"enough signal?" and "clear winner?" in units you can read, instead of an opaque similarity
number. Because D-4's candidate-local IDF already cancels shared tokens, the runner-up often
scores ~0, so an **absolute** margin is clean and avoids divide-by-zero.

| Option                                                    | Why not                                                                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E-1** absolute threshold + margin on a **cosine** score | Cosine magnitude isn't calibratable across conversations (§9); we dropped cosine anyway.                                                                                                        |
| **E-3** relative ratio `s1/s2 ≥ ρ`                        | The runner-up is frequently ~0 (shared tokens cancel), so the ratio explodes / divides by zero; needs an awkward floor. Pairs naturally with D-5 (log-odds) — revisit if we adopt that upgrade. |
| **E-4** z-score / rank-gap                                | Needs a population of candidate scores to be stable; our collisions are usually just 2 candidates, where a z-score is meaningless.                                                              |

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

| Option                                                        | Pros                                                                                    | Cons                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **F-1** New standalone tier on **both** paths                 | Symmetric coverage.                                                                     | **Two separate insertions**; duplicates wiring; llmSelect side saves no LLM.                            |
| **F-2** **Grammar/cache path only**                           | The **only** place it avoids an LLM; one insertion; biggest concrete win.               | Embedding-path collisions unaddressed (acceptable — they already run LLM-free selection).               |
| **F-3** **Inside `resolvePreferenceClarify`** (shared policy) | **One change covers both paths**; reuses the consent/learning model; least new surface. | Couples to the `preference-clarify` strategy plumbing; needs care so it composes with Tier-1/registry.  |
| **F-4** Dynamic `priorityOrder` feeding existing `priority`   | Tiny surface; reuses a shipped strategy.                                                | Re-derives priority per request (surprising for a "static" knob); no evidence gate / abstain semantics. |

**Why F-2.** contextSelector behaves like a deterministic fast-path on the grammar path:
**confident → pick the winning Stage-1 match (no LLM); abstain → get out of the way and let
the request proceed to the LLM path.** This is the only place it avoids an LLM,
it's one insertion, and it matches the natural request flow (§4). The
llmSelect insertion is a _different, lower-value_ feature (a deterministic tiebreak
when we're already committed to the LLM — **no cost saving**), so it is **out of
scope for v1**. F-3 (extend `resolvePreferenceClarify`) is worth it _only_ if we
later want that both-path coverage plus the consent/learning reuse from a
single change; otherwise it adds plumbing for the low-value half.

#### Abstain semantics (what the fallback is)

On the grammar path Stage 1 _already_ produced a match, so "abstain" has two possible
fallbacks — pick deliberately:

| Abstain target                                                                 | Behavior                                                                             | Pros                                                                                                            | Cons                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Defer to the configured strategy** (`first-match`/`priority`/`user-clarify`) | Stays on the cache path (no LLM) unless the strategy itself clarifies.               | Least-surprising; preserves today's behavior exactly; cheap.                                                    | Doesn't match "low confidence ⇒ let the LLM decide" — a static strategy still resolves it.                                                                                         |
| **Escalate to the LLM path** (re-translate)                                    | Treats contextSelector as a pure shortcut; on low confidence the smart path decides. | Conceptually clean ("deterministic shortcut, else LLM"); matches the intuition that ambiguity deserves the LLM. | Discards the Stage-1 match and forces an LLM call on every low-confidence collision (cost/latency); the LLM's own schema pick may land on the same agent `first-match` would have. |

**Why configurable, default defer-to-strategy.** Default _defer-to-strategy_
(preserves current behavior, zero added LLM cost) with an explicit
`escalate-to-llm` fallback option for callers who prefer "confident shortcut, else
LLM." Either way, **abstain never makes the decision worse than today** — it only
chooses _which_ existing fallback runs.

### 11.2 UX — what the user sees when it resolves

| Option                                                                          | Pros                                                                                                                   | Cons                                                                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **U-1** Pure-silent reroute                                                     | Zero friction; full LLM-avoidance.                                                                                     | **First zero-consent invisible reroute in the product**; no correction affordance; erodes trust on wrong picks. |
| **U-2** Visible affordance ("↪ routed to Excel — recent topic · change")       | Cheap; transparent; keeps the LLM-avoidance win; one-tap correct.                                                      | Slight UI noise on every topical resolve.                                                                       |
| **U-3** First-time confirm → write a **learned preference** → silent thereafter | Bridges into the **existing consent/trust model**; turns contextSelector into a _bootstrapper_ for Tier-1 preferences. | First hit costs a confirm; needs the preference-write plumbing (already exists).                                |

**Decision recap (see §11 DECIDED block):** **U-2** when enabled; U-1 silent only as an
explicit opt-in; **U-3 documented as the enhancement** (it pairs with F-3 if taken later).

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

**Note on the keyword pipeline.** B-1 distilled keywords (and the V2 knowPro source, §7.3)
are LLM-generated and therefore non-deterministic — **but only at author/extraction time**.
The committed/extracted artifact is frozen before runtime, so the hot path that reads it
stays fully deterministic. The LLM in the keyword pipeline does **not** violate G3.

---

## 13. The v1 design

### 13.1 What ships (the complete core design, as one change)

| Part            | Pick                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A — home        | **A-2 × A-3** (§5): schema/action-granular derived defaults + a live-tunable `collision-keywords.json` sidecar override                                |
| B — source      | **Layered B-1+B-2+B-3** (§6): B-2 lexical floor + B-1 distilled quality + B-3 misroute-phrase mining                                                   |
| C(i) — signal   | **V1 source seam** (§7): user-message tokens from a contextSelector-owned raw-request ring buffer                                                      |
| C(ii) — model   | **Recency-decayed ring buffer** (§8): `λ=0.9`, `N=20`                                                                                                  |
| D — scorer      | **D-4** candidate-local IDF-weighted token overlap (TF-IDF), flattened keyword sets (§9)                                                               |
| E — decision    | full-coverage guard + history-only + **E-2** evidence gate (§10)                                                                                       |
| F — integration | **F-2** grammar/cache path only — confident ⇒ no-LLM shortcut; abstain ⇒ fall through (abstain fallback configurable, default defer-to-strategy) (§11) |
| U — UX          | **U-2** visible non-blocking affordance when enabled (invisible while off) (§11.2)                                                                     |
| H — config      | 7-field type, only `detect` exposed via `@config` (§11.3)                                                                                              |

All of the above ship **together** as v1: no manifest change, no onboarding-LLM in the hot
path, one integration point, a fixed correctness guard, and a trust-preserving affordance.
Delivers the named excel↔list scenario.

### 13.2 Deferred to later (stretch goals, not in v1)

Pulled in later only where local benchmarks show v1 abstaining too often or mis-resolving —
each explicitly **out of v1 scope**: the **V2 knowPro topic/entity source** (§7.3; requires
enabling agent-server-mode extraction first), per-action / sub-schema vectors, capped
**agent-of-record** (C-3; lock-in risk), **BM25 (D-3)** / **log-odds (D-5)** scoring
(D-5 needs a labeled corpus), the **F-3 both-path / embedding-path coverage** (deterministic
tiebreak only — no LLM saved), **U-3 learned-preference bootstrap** (confirm-then-learn), and
**embedding soft-match** for synonyms.

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

**Candidates — flattened keyword sets (§6, §9)** — shared by both scenarios below.

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

1. **Coverage** — both candidates have non-empty keyword sets ✓
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

| Rejected option                                   | Why not                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B-4** embedding-cluster action vectors → labels | Heavier and opaque, and the labeling step usually needs an LLM — collapsing back into B-1's drift/dependency profile without B-1's review/control. (Whether the _scorer_ may use embeddings is a separate open Part D question; embedding-derived _keywords_ are out.) |

_Folded into the decision rather than rejected: **B-1**, **B-2**, **B-3** are layered
(floor + quality + discriminative boost), not competitors — see §6. "B-2-only" and
"B-1-only" were considered: B-2-only loses synonyms/quality; B-1-only loses guaranteed
coverage of un-distilled and dynamic agents — so the stack uses all three._

### Part C(i) — conversation signal source (decided §7)

| Rejected / deferred                                      | Why                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source = `ChatHistory`** (C-4's premise)               | In agent-server mode (our target) `ChatHistory` has no user entries — `requestKnowledgeExtraction` is `false` there (§7.1). A `ChatHistory`-derived context vector would be empty exactly where contextSelector runs. |
| **C-3** agent-of-record (recent winners)                 | Self-reinforcing feedback loop → lock-in on a prior winner; needs caps + same-pair exclusion before it's safe. Deferred behind local benchmark data.                                                                  |
| **C-2 via `ChatHistory` entities** as the primary signal | The entities that survive agent-server mode are _action-result_ (system-output) entities, not the user's phrasing — output-biased. The richer user-topic signal is V2 (knowPro topics/entities) instead.              |

_Folded into the decision: V1 raw-token map (deterministic, agent-server-safe) and V2
knowPro topics/entities (richer, LLM-backed) behind one source seam — see §7._

### Part D — scoring algorithm (decided §9)

| Rejected / deferred                          | Why                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** pure cosine                          | Angle-only ⇒ `{excel:1}` and `{excel:100}` score identically; rewards tiny vectors; fixed confidence threshold uncalibratable.                                                                                                                                                                                                                                                                            |
| **D-2** weighted dot product (no IDF)        | "D-4 minus discriminativeness" — long-list/keyword-stuffing bias; generic shared tokens inflate both candidates. Choosing candidate-local IDF already subsumes it.                                                                                                                                                                                                                                        |
| **D-3** BM25-lite                            | Built for long, length-varied documents; our ~8-token keyword lists are tiny/uniform so length-norm does little, and `k1`/`b` have no data to tune. TF runaway already bounded by decay (§8) + the evidence gate (§10); a sublinear `1+log(f)` is a lighter option. **Deferred refinement** if local benchmarks show token-dominance/length-bias.                                                         |
| **D-5** log-odds / Naive-Bayes               | The per-token `log[P(t\|a1)/P(t\|a2)]` is what candidate-local IDF approximates (D-4 ≈ smoothing-free log-odds). Real D-5 must fabricate `P(token\|a)` from tiny keyword lists → mandatory smoothing whose parameter dominates, illusory calibration without labeled data, and independence-assumption overconfidence. **Documented upgrade**, gated on a labeled collision corpus from local benchmarks. |
| **Positional weighting** (reciprocal/capped) | Order signal is a third, noisier proxy already covered by `disc × C`; stacking three uncalibrated multipliers risks one factor dominating. **Flattened (set)** for v1; capped positional weighting parked as a tuning lever.                                                                                                                                                                              |

_Folded into the decision: **D-4** = candidate-local IDF-weighted token overlap with
flattened keyword sets — the sweet spot between too-naive (D-2) and over-engineered
(D-3/D-5); see §9._
