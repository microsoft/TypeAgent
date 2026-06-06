# AEMG — Associative Episodic Memory Graph (ThreadWeave)

A standalone assistant memory system, built as a **competitor to REM** (not on top
of it). AEMG stores relationships, provenance, confidence, and supersession history
rather than embedding chunks alone, so recall is **grounded, correctable, and
associative**.

- Workspace package: `aemg-memory` (directory `ts/packages/aemg`).
- Status: design implemented end-to-end, in memory, no external dependencies.
- Tests: 17 passing across 4 suites (`*.spec.ts`).

---

## 1. Goals & thesis

AEMG is designed to beat plain RAG and REM on three axes:

1. **Recall quality** — find the right memory even when the query shares no words
   with it.
2. **Correction handling** — "actually I said M, not Z" is a first-class operation
   that never destroys history.
3. **Associative retrieval** — recall by concept association, the way human memory
   works, not by chunk similarity alone.

The headline claim — _better than any RAG system today_ — rests on one structural
difference: **AEMG is a typed knowledge graph with spreading activation, plus a
decaying salience signal, plus an append-only provenance log.** Chunk-RAG has none
of these; it can only return text whose embedding is near the query embedding.

---

## 2. Architecture overview

```
                       ingest(turns, beliefs)        correct(M not Z)
                                │                            │
                                ▼                            ▼
        ┌───────────────────────────────────────────────────────────┐
        │                      MemoryStore (store.ts)                 │
        │                                                             │
        │   append-only        canonical state          fast signal  │
        │   ObservationLog  →   Episodes + Beliefs   →   SignalStore  │
        │   (observationLog)    (types.ts)               (signal.ts)  │
        │                            │                                │
        │                            ▼                                │
        │                   KnowledgeGraph (graph.ts)                 │
        │                   entities + typed edges                    │
        └───────────────────────────────────────────────────────────┘
                                │
                                ▼
                  recall(query)  ──►  lexical  ⊕  spreading activation
                                       (graph.ts + activation.ts)
                                │
                                ▼
                 RecallResult { items[+provenance], conflicts[] }
```

Two stores, split by change-rate (mirrors the REM hybrid idea but self-contained):

- **Structure** (graph, episodes, beliefs, observation log) — slow-changing,
  authoritative for _existence_ and _provenance_.
- **Signal** (`SignalStore`) — fast-changing, authoritative for _salience_
  (recency, reinforcement, decay). A missing signal simply defaults to zero, so
  the structure store is never corrupted by the signal store.

---

## 3. Data model (`src/types.ts`)

| Type           | Role                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Observation`  | Append-only record of something told or inferred. Canonical state is a fold over these, so the system is replayable and auditable.          |
| `Provenance`   | Pointer back to the exact source turn (`sourceId`, `turnIndex`, `speaker`, `quote`). This is what lets recall quote instead of hallucinate. |
| `Episode`      | A compressed conversation segment indexed on four cue axes: **topic**, **participants**, **time**, **action-intent**.                       |
| `Claim`        | A salient utterance within an episode, with its own provenance.                                                                             |
| `Belief`       | A **versioned** `subject/predicate/value` fact. Corrections add a new version and link the prior via `supersededById`. Never deleted.       |
| `RecallItem`   | One ranked hit, always carrying `confidence` + `provenance[]`.                                                                              |
| `RecallResult` | `items[]` plus `conflicts[]` — conflicts are surfaced, not collapsed.                                                                       |
| `ConflictNote` | A subject/predicate with ≥2 live candidate values.                                                                                          |

Trust tiers (`src/trust.ts`) gate every merge/supersession:

```
UserAsserted > ToolObserved > ExtractorInferred > ExternalInferred
```

---

## 4. Modules

### 4.1 `observationLog.ts` — append-only log

`ObservationLog` only appends; nothing is mutated or removed. Canonical state
(episodes, beliefs, graph) is derived from it, which makes replay and repair
possible.

### 4.2 `graph.ts` — typed knowledge graph

`KnowledgeGraph` holds **entity** and **episode** nodes joined by **typed, weighted,
undirected** edges. Adding the same edge again **accumulates weight**, so repeated
co-occurrence strengthens an association. Key edges built during ingest:

- `episode —about→ topic`
- `episode —mentions→ subject` (for each belief)
- `episode —intent→ actionIntent`
- `subject —predicate→ value` (weight `1 + confidence`)

### 4.3 `activation.ts` — spreading activation

`spreadingActivation(graph, seeds, opts)` seeds energy on query-matched nodes and
propagates it across edges, **split by normalized edge weight** and **attenuated by
`decay` per hop**, stopping at `maxHops` or when energy drops below `minActivation`.
Accumulated activation per node = associative relevance.

> **This is the RAG-beating mechanism.** A query for "guitar" with no lexical match
> to an episode still reaches it via `guitar → Fender → "weekend jam"`. See
> `test/associativeRecall.spec.ts`.

### 4.4 `signal.ts` — decay / reinforcement / pinning

`SignalStore` implements **lazy** exponential decay — no sweep writes:

```
strength(t) = base · exp(-λ · (t − lastSeen))      (pinned ⇒ strength = base)
```

- **Reinforce**: decay `base` forward to `now`, add the increment, reset `lastSeen`.
- **Pin/unpin**: freeze at the current decayed value; pinned memories never fade.
- Default half-life: 14 days (`DEFAULT_HALF_LIFE_MS`).

All methods take an explicit `now`, so decay is deterministically testable.

### 4.5 `store.ts` — MemoryStore (the orchestrator)

Public API:

| Method                                            | Behavior                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ingest(input)`                                   | Captures an `Episode`, records observations, asserts beliefs, builds graph nodes/edges, seeds the salience signal.          |
| `correct(correction)`                             | High-trust assertion; adds a new belief version, links/supersedes the prior (trust-gated).                                  |
| `recall(query, {hybrid})`                         | Lexical scoring ⊕ spreading activation, weighted by salience; reinforces surfaced episodes; returns provenance + conflicts. |
| `recallAssociative(query)`                        | Graph-only recall (no lexical scoring).                                                                                     |
| `currentBelief` / `beliefHistory`                 | Live value and full version chain.                                                                                          |
| `pinEpisode` / `unpinEpisode` / `episodeStrength` | Salience control + inspection.                                                                                              |

Constructor takes `MemoryStoreOptions { now?, signalHalfLifeMs? }` for an injectable
clock.

---

## 5. How each capability is delivered

| Capability                       | Mechanism                                                            | Where                                 |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| Better-than-RAG retrieval        | Hybrid fusion: lexical ⊕ graph activation (vector slot reserved)     | `store.recall`                        |
| Associative recall               | Spreading activation over typed edges                                | `activation.ts`, `graph.ts`           |
| "Remember when we did X"         | Episodes indexed on topic / participant / time / intent cue axes     | `types.ts`, `store.ingest`            |
| Correction ("M not Z")           | Versioned beliefs + `supersededById`, trust-gated                    | `store.correct`, `store.assertBelief` |
| Contradiction without corruption | Lower-trust conflict stays live; surfaced in `conflicts[]`           | `store.detectConflicts`               |
| Memory hygiene                   | Lazy exponential decay + reinforcement + pinning                     | `signal.ts`                           |
| Grounded answers                 | Every `RecallItem` carries confidence + provenance                   | `types.ts`, `store.recall`            |
| Trust arbitration                | `UserAsserted > ToolObserved > ExtractorInferred > ExternalInferred` | `trust.ts`                            |

---

## 6. AEMG vs RAG vs REM

| Property                               | Chunk-RAG         | REM                 | AEMG                              |
| -------------------------------------- | ----------------- | ------------------- | --------------------------------- |
| Retrieval primitive                    | Embedding chunks  | Hybrid RDF + SQLite | Typed graph + activation + signal |
| Zero-overlap associative recall        | ✗                 | partial             | ✓ (spreading activation)          |
| Corrections without deletion           | ✗                 | ✓                   | ✓ (versioned beliefs)             |
| Contradiction surfaced (not collapsed) | ✗                 | planned             | ✓                                 |
| Salience decay / reinforcement         | ✗                 | lazy decay (SQLite) | ✓ lazy decay + pin                |
| Provenance-grounded answers            | weak              | ✓                   | ✓                                 |
| External deps to run                   | vector DB + model | Oxigraph + SQLite   | none (in-memory)                  |

AEMG and REM share design DNA (append-only log, trust tiers, lazy decay), but AEMG
foregrounds the **graph + spreading activation** as the primary retrieval engine,
where REM foregrounds RDF storage.

---

## 7. Build & test

```bash
pnpm --filter aemg-memory build      # tsc -b
pnpm --filter aemg-memory test       # jest against dist/test
```

Note: `exactOptionalPropertyTypes: true` is on — never assign `undefined` to an
optional field; use a conditional spread `...(x !== undefined ? { k: x } : {})`.

Test suites:

- `verticalSlice.spec.ts` — ingest → episode → correction → grounded recall.
- `associativeRecall.spec.ts` — spreading activation + zero-overlap recall.
- `signal.spec.ts` — decay, reinforcement, pinning.
- `contradiction.spec.ts` — quarantine of lower-trust conflicts.

---

## 8. TODO — benchmarking (NOT yet implemented)

The "better than RAG/REM" claim must be **measured**, not asserted. The plan:

### 8.1 Harness

Reuse the existing LLM-judge harness at `ts/examples/memoryEval` (currently targets
`rem-memory` via `src/remRunner.ts`). Add a parallel `src/aemgRunner.ts` implementing
the same runner interface so the two systems answer the **same** questions over the
**same** ingested transcripts.

### 8.2 Baselines to compare

1. **Embedding-only RAG** — chunk + vector top-k (the control).
2. **REM** — existing `remRunner.ts`.
3. **AEMG** — new `aemgRunner.ts`.

### 8.3 Scenario classes (one labeled set each)

| Class              | What it probes                            | AEMG mechanism under test |
| ------------------ | ----------------------------------------- | ------------------------- |
| Precise recall     | Quote-exact retrieval                     | provenance + lexical      |
| Associative recall | Zero lexical overlap, concept-linked      | spreading activation      |
| Correction         | "M not Z" honored over time               | versioned beliefs         |
| Contradiction      | Conflicting facts surfaced, not collapsed | quarantine                |
| Staleness          | Old facts fade, pinned/reinforced persist | signal decay              |

### 8.4 Metrics

- **Answer correctness** (LLM-judge, as in `memoryEval/src/grade.ts`).
- **Retrieval accuracy** — precision/recall@k against labeled gold memories.
- **Wrong-recall rate** — how often a confidently-wrong memory is returned (trust signal).
- **Latency** — per-query recall time.
- **Grounding** — fraction of answers with valid provenance pointers.

### 8.5 Success criterion

AEMG must **beat embedding-only RAG on associative recall and correction handling**,
and **match or beat REM** on precise recall and answer correctness, at comparable
latency.

### 8.6 Open decisions before building the benchmark

1. Optimize first for conversational continuity, factual recall, or preference learning?
2. Should AEMG add a pluggable `EmbeddingProvider` (a real semantic "near" signal) as
   a third fusion input before benchmarking, or benchmark lexical⊕graph first to
   isolate the graph's contribution?
3. Shared ingestion adapter so all three runners consume identical transcripts.

---

## 9. Roadmap status

| Step                                                                | Status       |
| ------------------------------------------------------------------- | ------------ |
| 1. Vertical slice (ingest → episode → correction → grounded recall) | ✅ done      |
| 2. Hybrid retrieval (lexical + graph; vector slot reserved)         | ✅ done      |
| 3. Spreading activation                                             | ✅ done      |
| 4. Contradiction quarantine surfacing                               | ✅ done      |
| 5. Lazy decay + reinforcement + pinning                             | ✅ done      |
| 6. Eval harness vs embedding-only RAG / REM                         | ⏳ TODO (§8) |
| Optional. Pluggable `EmbeddingProvider` (3rd fusion signal)         | ⏳ future    |
