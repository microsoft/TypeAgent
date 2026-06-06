# REM (Recall Engram Memory) — Status & Handoff

_Last updated: 2026-06-06 • Branch: `dev/robgruen/rem-memory`_

REM is a standalone TypeAgent memory system: ingest text → extract entities &
relations → store as RDF (Oxigraph) with SQLite-backed decay "signals" → recall
relevant facts (lexical + type-aggregation) → answer questions with an LLM
grounded only on recalled memory. A separate LLM-judge eval harness
(`examples/memoryEval`) scores REM against curated + generated questions.

---

## 1. Current State (TL;DR)

- **REM core** (`packages/memory/rem-memory`): complete, builds clean, **31/31 unit tests pass**, prettier clean.
- **Eval harness** (`examples/memoryEval`): complete, builds clean, validated end-to-end live.
- **Latest live eval result: 28%** (1 correct, 3 partial, 5 incorrect over 9 curated Episode 53 questions), up from 0%.
- This session added **set-intersection recall** ("books that are also movies")
  and made **extraction failures observable** (the feeder no longer silently
  swallows empty/failed extractions). See §4.

---

## 2. Architecture / Layout

### `packages/memory/rem-memory/src/`

| File                                                 | Responsibility                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model.ts`                                           | Types + `TrustTier` enum (`UserAsserted` > `ToolObserved` > `ExtractorInferred` > `ExternalInferred`) and `trustTierRank()`. `Entity{id,name,aliases,types,facets}`, `Relation`, `Observation`, `ObservedEntity`, `ObservedRelation`, `RecallResult{relation,subject,object,tier,weight}`. |
| `vocab.ts`                                           | RDF IRIs/predicates (`CLASS_ENTITY`, `P_NAME`, `P_ENTITY_TYPE`, `P_FACET*`, etc.) + IRI minting. `relationKey()` makes a deterministic relation IRI so the same fact reinforces one relation.                                                                                              |
| `rdfStore.ts` / `oxigraphStore.ts`                   | RDF store interface + in-memory Oxigraph 0.4.11 impl (`select()` runs SPARQL).                                                                                                                                                                                                             |
| `signalStore.ts`                                     | SQLite (better-sqlite3) decay signals — per-relation weight that grows on reinforcement and decays over time. `:memory:` for ephemeral.                                                                                                                                                    |
| `resolver.ts`                                        | `EntityResolver` — dedupes/links entity names to ids.                                                                                                                                                                                                                                      |
| `feeder.ts` / `feeders/knowledgeExtractionFeeder.ts` | `Feeder` interface + the knowledge-processor-backed extractor feeder (borrows `kpLib.createKnowledgeExtractor`, maps to REM observations).                                                                                                                                                 |
| `ingest.ts`                                          | `RemMemory(rdf, signals, resolver)` — `ingestFrom(feeder,input)`, `ingestObservation(obs)`, `recall(query,opts)`. `writeEntity` writes name/aliases/types/facets.                                                                                                                          |
| `recall.ts`                                          | `Recall` — lexical relation matching **+ type-aggregation path** (see §4). SECURITY: query text is NEVER interpolated into SPARQL (fixed queries + JS-side filtering).                                                                                                                     |
| `answer.ts`                                          | `RemAnswerGenerator` — recall → format numbered context → LLM with a strict "answer ONLY from MEMORY FACTS, else say 'I don't have that in memory'" system prompt.                                                                                                                         |

### `examples/memoryEval/src/`

| File                                      | Responsibility                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `benchmarkSchema.ts` / `gradingSchema.ts` | TypeChat schemas for question generation + LLM grading (mirror the .NET methodology).                         |
| `models.ts`                               | `createJudgeModel()` (temp 0, default endpoint) + `createTranslator()` (loadSchema → validator → translator). |
| `questionGen.ts`                          | Generate graded-difficulty questions from a transcript.                                                       |
| `oracle.ts`                               | Closed-book reference answers from the transcript ("NOT IN TRANSCRIPT" if absent).                            |
| `grade.ts`                                | LLM grader → `correct`/`partial`/`incorrect` + feedback.                                                      |
| `remRunner.ts`                            | `MemorySystem` interface + `RemSystem` (wires the whole REM stack; chunks text, ingests, answers).            |
| `curatedQuestions.ts`                     | 5 Episode-53 NL queries (no answers) + 4 hand-authored Q&A.                                                   |
| `report.ts`                               | Overall / by-difficulty / by-category score tables. `score()` = (correct + 0.5·partial)/total.                |
| `main.ts`                                 | CLI: `generate` and `run` commands.                                                                           |

---

## 3. How to Build / Test / Run

```powershell
# Build + test REM core
cd c:\repos\TypeAgent\ts\packages\memory\rem-memory
pnpm exec tsc -b
pnpm run test:local            # jest-esm against dist/test, *.spec.ts (27 tests)
pnpm run prettier:fix

# Build the eval app (its dist consumes rem-memory's dist — rebuild REM first)
cd c:\repos\TypeAgent\ts\examples\memoryEval
pnpm run build                 # tsc -b + postbuild copies *Schema.ts into dist

# Run the full curated live eval (~3 min ingest + 9 gradings; needs API keys)
node ./dist/main.js run `
  --transcript ..\..\packages\knowPro\test\data\Episode_53_AdrianTchaikovsky.txt `
  --curated --out results.json
```

CLI commands:

- `generate --transcript <f> --out <f> [--count 30]` — generate a question set.
- `run --transcript <f> [--questions <f>] [--curated] [--generate N] [--maxQuestions N] [--out <f>]`.

### Environment gotchas (important)

- **API keys are configured** in this environment; live runs work.
- `pnpm install` hangs on an invisible Corepack prompt → prefix with
  `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- `Tee-Object -FilePath x.log` **buffers until the process exits** (log won't
  update live); watch the console scrollback instead.
- Run terminal commands one at a time.

---

## 4. Changes Landed This Session

### (a) Set-intersection recall — `recall.ts`

The type-aggregation path could only union types, so "books that are also
movies" returned every book and every movie instead of their intersection.
Added:

- `hasIntersectionCue(query)` — detects an explicit set cue (`also` / `both`)
  that distinguishes "books that are **also** movies" (intersect) from "books
  **and** movies" (union).
- `recallEntitiesByType(keywords, intersectionCue)` — now groups each entity's
  declared types, records which stored types the query actually named, and:
  - **UNION (default)**: surfaces every entity matching any named type.
  - **INTERSECTION**: when the query names ≥2 stored types **and** carries the
    cue, surfaces only entities carrying **all** named types.
- Extracted the synthetic `is_a` builder into `makeIsAResult(...)` (no behaviour
  change for the existing single-type path).
- New unit test in `test/ingestRecall.spec.ts` ("intersection recall lists
  entities matching all named types").
- SECURITY unchanged: query text is still matched in JS against a fixed-query
  result set; never interpolated into SPARQL.

### (b) Surface extraction failures — `feeders/knowledgeExtractionFeeder.ts`

The feeder previously swallowed `!result.success` and returned `[]`, so a
misconfigured extractor (see prior session's endpoint bug) could silently leave
the store empty with no signal. Made these cases observable:

- `ExtractionStats { attempts, failures, empty }` + `newExtractionStats()`.
- `observationsFromExtraction(result, input, timestamp, stats)` — pure mapper
  (apart from mutating `stats` + debug logging) that records failures / empty
  extractions and logs them via `debug` channel
  **`rem-memory.extraction:error`**. Unit-testable without the LLM.
- `KnowledgeExtractionFeeder.produce()` now delegates to it; new
  `feeder.extractionStats` getter exposes the running counters (a rising
  `failures`/`empty` count = silent-empty ingest).
- 3 new unit tests in `test/knowledgeExtractionFeeder.spec.ts` (failure, empty,
  clean outcomes).

---

## 4b. Changes From The Prior Session

### (a) Type-aggregation recall path — `recall.ts`

Lexical recall alone can't answer "list all X" because entities are matched by
name, not by RDF `type`. Added:

- `typeCandidates(token)` — singular/plural variants so "books" matches stored type "book".
- `fetchEntityTypes()` — fixed SPARQL pulling every `(entity, name, type)`.
- `recallEntitiesByType(keywords)` — for keywords matching a known stored type,
  emit each matching entity as a synthetic `is_a` `RecallResult`
  (`subject`=entity, `object`=the type, tier `ExtractorInferred`, weight 1).
- Wired into `recall()`: synthetic results are pushed into the scored set
  (score `lexicalWeight + 1`) before the existing sort/slice/touch, so the
  answer/format path is unchanged.
- New unit test in `test/ingestRecall.spec.ts` ("type-aggregation recall lists
  all entities of a type").

### (b) Critical extraction-endpoint bug — `feeders/knowledgeExtractionFeeder.ts`

`createExtractionModel()` pinned the extractor to a **named `"GPT_4_O"` endpoint**
that resolves to a malformed URL
(`/openai/v1/chat/completions?api-version=2024-05-01-preview`) and returns
`400 BadRequest: API version not supported`. Because the feeder swallows
failures (`if (!result.success) return []`), **every** extraction silently
returned nothing and the store stayed empty — REM answered "I don't have that
in memory" for everything (first re-run was 0% across all 9, including relation
questions). Fixed by using the **default** chat endpoint
(`openai.apiSettingsFromEnv(openai.ModelType.Chat)`), which is correctly
configured and extracts successfully.

> Lesson: the feeder silently swallows extraction errors. Consider logging /
> surfacing extraction failures (see §6).

---

## 5. Latest Eval Results (Episode 53, curated, 9 Q)

**Overall: 28%** — correct 1, partial 3, incorrect 5.

| #   | Question                                                      | Grade       | Note                                                                                                     |
| --- | ------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| 1   | List all books                                                | incorrect   | Returns 11 books (type path works); oracle had "NOT IN TRANSCRIPT" so graded against a strict reference. |
| 2   | List all books and movies                                     | partial     | Both lists returned; some spurious + missing entries.                                                    |
| 3   | List all books that are also movies                           | incorrect   | Needs **intersection**; type path returns a union → empty here.                                          |
| 4   | Anything on the novel _Empire in Black and Gold_?             | partial     | Identified as a novel; missing author/year context.                                                      |
| 5   | Anything on _Empire of Black and Gold_ or _Children of Ruin_? | incorrect   | Misspelled title + multi-entity retrieval missed.                                                        |
| 6   | Name of the podcast?                                          | partial     | "Behind the Tech" (missing "with Kevin Scott").                                                          |
| 7   | Who hosts the podcast?                                        | incorrect   | Hallucinated extra host (Christina Warren) alongside Kevin Scott.                                        |
| 8   | Who is the guest?                                             | **correct** | Adrian Tchaikovsky.                                                                                      |
| 9   | How long did Adrian write unsuccessfully?                     | incorrect   | Multi-hop / facet not recalled.                                                                          |

By difficulty: easy 38%, moderate 33%, hard 0%.

These remaining misses are **genuine REM v1 quality limitations, not bugs**.

---

## 6. What's Left / Next Steps

### Recall & answer quality (REM v1 limitations)

1. **Lexical recall is brittle** — misspellings ("Empire of Black and Gold") and
   multi-entity OR queries miss. Consider fuzzy/alias matching or embedding-based
   recall.
2. **Multi-hop / facet answers** ("how long did he write unsuccessfully") — facets
   are stored but not surfaced into the answer context. Consider including entity
   facets in recall results.
3. **Answer grounding** — Q7 hallucinated a host. Tighten the answer system
   prompt and/or only pass high-confidence facts.

### Deferred (todo #14)

6. **KnowPro adapter** — `KnowProSystem implements MemorySystem` that loads the
   prebuilt `Episode_53_AdrianTchaikovsky_index_data.json` +
   `_index_embeddings.bin`, so the eval can run REM **vs** KnowPro head-to-head.
7. **MCP tools** `rem_recall` / `rem_answer` in `commandServer.ts addTools()`
   (hollow until a populated `RemMemory` data source is wired up).

### Eval methodology

8. Run with `--generate N` for a larger, auto-generated question set (not just
   the 9 curated) to get a more stable score.
9. The oracle returns "NOT IN TRANSCRIPT" for "list all books" (Q1) which then
   grades REM's real list as incorrect — revisit oracle handling of
   aggregation questions, or mark such questions as curated-with-answers.

---

## 7. Key Conventions / Reminders

- MIT header on every `.ts`; 4-space indent; LF; prettier defaults.
- **`exactOptionalPropertyTypes: true`** — optional props that may receive
  `undefined` must be typed `?: T | undefined`; to pass an optional through, use
  conditional spread `...(x !== undefined ? { prop: x } : {})`.
- Tests compile to `dist/test` and run against JS — **build before test**.
- Do **not** touch the separate `aemg-memory` package (different workstream).
- Memory notes: `/memories/session/plan.md`, `/memories/repo/rem-memory-design.md`.
