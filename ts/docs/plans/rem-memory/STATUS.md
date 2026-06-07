# REM (Recall Engram Memory) — Status & Handoff

_Last updated: 2026-06-06 • Branch: `dev/robgruen/rem-memory`_

REM is a standalone TypeAgent memory system: ingest text → extract entities &
relations → store as RDF (Oxigraph) with SQLite-backed decay "signals" → recall
relevant facts (lexical + type-aggregation) → answer questions with an LLM
grounded only on recalled memory. A separate LLM-judge eval harness
(`examples/memoryEval`) scores REM against curated + generated questions.

---

## 1. Current State (TL;DR)

- **REM core** (`packages/memory/rem-memory`): complete, builds clean, **50/50 unit tests pass**, prettier clean.
- **Eval harness** (`examples/memoryEval`): complete, builds clean, validated end-to-end live.
- **Latest live eval result: 33–39%** (3 correct + 1 flaky over 9 curated Episode 53 questions; up from a 28% baseline, 0% originally). The 9-question set is noisy run-to-run — see §5.
- This session added **set-intersection recall** ("books that are also movies"),
  made **extraction failures observable** (the feeder no longer silently swallows
  empty/failed extractions), added **fuzzy (typo-tolerant) lexical recall**,
  added **multi-entity OR-query splitting**, now **surfaces entity facets** into
  the answer context, and **tuned answer grounding** (anti-hallucination prompt
  that still allows reading/combining facts + optional high-confidence filter).
  See §4. Remaining misses are upstream extraction-fidelity gaps (§6).

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

### (c) Fuzzy (typo-tolerant) lexical recall — `recall.ts`

Exact-substring matching missed misspelled queries (e.g. "Tchaikovski" → stored
"Tchaikovsky"), so relation recall returned nothing. Added Levenshtein-based
near matching:

- `levenshtein(a, b)` — edit distance (rolling two-row DP, O(a·b) time,
  O(b) space).
- `editSimilarity(a, b)` — normalized `1 - distance / maxLen` in [0, 1].
- `fuzzyLexicalScore(keywords, haystack, threshold)` — per keyword: an exact
  substring still scores 1.0 (so "child" keeps matching "children"); otherwise
  the best per-word edit similarity counts only if it clears `threshold`.
- `recall()` now scores relations via `fuzzyLexicalScore` and accepts a new
  `RecallOptions.fuzzyThreshold` (default `DEFAULT_FUZZY_THRESHOLD = 0.8`; set
  to 1 to require exact matches).
- 6 new unit tests in `test/ingestRecall.spec.ts` (2 end-to-end recall, 4 pure
  helper tests).
- SECURITY unchanged: matching stays in JS over a fixed-query result set.

### (d) Multi-entity OR-query splitting — `recall.ts`

A query naming several entities ("anything on Empire in Black and Gold **or**
Children of Ruin?") collapsed into one keyword bag, so no single relation could
match every keyword and both entities scored poorly. Added clause splitting:

- `splitOrClauses(query)` — splits on the whole word "or" and tokenizes each
  clause independently (a query with no "or" yields a single clause).
- `recall()` now scores each relation against its **best-matching** clause and
  unions the hits, so each named entity surfaces on its own merits. The
  type-aggregation path runs per clause and dedupes by synthetic relation id.
- 2 new unit tests in `test/ingestRecall.spec.ts` (end-to-end OR recall + the
  `splitOrClauses` helper).
- SECURITY unchanged: matching stays in JS over a fixed-query result set.

### (e) Surface entity facets into the answer context — `answer.ts`

Facets (e.g. "unsuccessful writing: 7 years") are stored on entities and ride
along on resolver-backed recall results, but `formatContext()` rendered only
subject–predicate–object and dropped them, so attribute / multi-hop questions
could never be answered. Now:

- `formatContext()` appends an **`ENTITY DETAILS:`** section listing each
  distinct recalled entity's facets (`name: value; ...`), deduped by entity id
  so an entity appearing in several relations is listed once.
- The section is omitted entirely when no recalled entity has facets (so
  existing facet-free output is byte-for-byte unchanged).
- New `test/answer.spec.ts` with 4 unit tests (empty, no-facets, with-facets,
  dedupe). `formatContext` is pure, so these run offline without the LLM.

### (f) Tighten answer grounding — `answer.ts`

Q7 hallucinated a co-host (added "Christina Warren" alongside Kevin Scott) —
the model padded the answer with a name not in the recalled facts. Hardened the
answer path on both levers from §6:

- **Anti-hallucination prompt**: `SYSTEM_PROMPT` (now exported) tells the model
  to answer only from MEMORY FACTS and never add a name/entity/detail the facts
  don't support, while still allowing it to **read, interpret, and combine** the
  given facts (an earlier, stricter "verbatim / no-inference" wording regressed
  the eval to 22% by making REM refuse answerable questions like "who is the
  guest" — see §5).
- **High-confidence filter**: new `filterByWeight(results, minWeight)` + a
  `RemAnswerOptions.minWeight` floor (default 0 = off) drops weak/stale facts
  from the answer context before formatting, so they can't seed a hallucination.
- 4 new unit tests in `test/answer.spec.ts` (3 `filterByWeight`, 1 prompt
  grounding-contract guard).

### (g) Capture action-implied subject facets — `feeders/knowledgeExtractionFeeder.ts`

The knowledge schema surfaces a per-action `subjectEntityFacet` (a facet implied
by the action, e.g. an interest, duration, or outcome). The REM mapper dropped
it, losing attribute/duration details that multi-hop questions (e.g. Q9 "how
long did he write unsuccessfully") depend on. Now:

- `knowledgeToObservation()` indexes entities by name and attaches each action's
  `subjectEntityFacet` back onto its subject entity (Quantity values coerced to a
  scalar like other facets), via a new `addFacet()` helper that dedupes by
  case-insensitive facet name. Facets on unknown subjects are ignored.
- 3 new unit tests in `test/knowledgeExtractionFeeder.spec.ts` (capture, unknown
  subject, no-duplicate).
- This is a strictly-additive fidelity fix: it only surfaces data the extractor
  already produced. Whether it helps a given question still depends on the
  (non-deterministic) extractor actually emitting the facet — see §5 on eval
  variance.

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

**Overall: 33–39%** — correct 3, with the 4th graded item (Q6 podcast name)
flipping between partial and a refusal across runs (post-2026-06-06 fixes; up
from 28% baseline, and recovered from a 22% regression caused by an over-strict
grounding prompt — see §4(f)).

> **Eval is noisy.** Two runs with the *same* softened prompt scored 39% then
> 33%; the only graded delta was Q6 (podcast name) flaking partial→refusal, and
> ingest time halved (351s→179s) between runs. Knowledge extraction is
> LLM-driven and non-deterministic, so a 9-question curated set is not a stable
> signal. Use the larger `--generate N` set (§6) to measure real movement. The
> table below is the 39% run; the 33% run differed only at Q6.

| #   | Question                                                      | Grade       | Note                                                                                                         |
| --- | ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | List all books                                                | incorrect   | Type path returns a book list; oracle is "NOT IN TRANSCRIPT" so any list grades wrong (grading artifact).     |
| 2   | List all books and movies                                     | **correct** | Union path lists both books and movies.                                                                       |
| 3   | List all books that are also movies                           | incorrect   | Intersection returns empty — no extracted entity carries **both** `book` and `movie` types (extraction gap).  |
| 4   | Anything on the novel _Empire in Black and Gold_?             | **correct** | "Novel by Adrian Tchaikovsky, 2008" — recovered by the softened grounding prompt.                            |
| 5   | Anything on _Empire of Black and Gold_ or _Children of Ruin_? | incorrect   | OR-split **works** (retrieves Children of Ruin), but oracle is "NOT IN TRANSCRIPT" (grading artifact).        |
| 6   | Name of the podcast?                                          | partial     | "Behind the Tech" (missing "with Kevin Scott").                                                              |
| 7   | Who hosts the podcast?                                        | incorrect   | "Christina Warren and Kevin Scott" — extraction fidelity issue (a wrong host is stored), not grounding.       |
| 8   | Who is the guest?                                             | **correct** | Adrian Tchaikovsky — recovered by the softened grounding prompt.                                             |
| 9   | How long did Adrian write unsuccessfully?                     | incorrect   | The "7 years" detail only lands when the extractor emits it as a `subjectEntityFacet`; the mapper now keeps it (§4(g)) but the LLM emitted it inconsistently. |

By difficulty: easy 38%, moderate 67%, hard 0%.

The remaining misses are **extraction/recall fidelity gaps or grading artifacts,
not answer-path bugs** — see §6.

---

## 6. What's Left / Next Steps

### Recall & answer quality (REM v1 limitations)

_This session's answer-path items are done and verified by a live re-run (§5).
What remains are eval-stability work and upstream extraction-fidelity gaps._

1. **Stabilize the eval before chasing more points** — the 9-question curated
   set swings 33–39% run-to-run on extractor non-determinism (§5), which is
   larger than most single-fix deltas. Run `--generate N` (≥30 Q) and/or average
   multiple runs so changes are measurable. Optionally lower extractor
   temperature / seed it for repeatability.
2. **Extraction fidelity** — the clearest remaining quality losses are at
   extraction time, not in recall/answer: Q7 stores a wrong host ("Christina
   Warren"), Q3 never tags an entity as both `book` and `movie`, and Q9's
   "7 years" facet is emitted inconsistently. The mapper now keeps action-implied
   subject facets (§4(g)); next is a prompt/extraction-quality pass for
   consistent facet capture and host/role disambiguation.

### Deferred (todo #14)

3. **KnowPro adapter** — `KnowProSystem implements MemorySystem` that loads the
   prebuilt `Episode_53_AdrianTchaikovsky_index_data.json` +
   `_index_embeddings.bin`, so the eval can run REM **vs** KnowPro head-to-head.
4. **MCP tools** `rem_recall` / `rem_answer` in `commandServer.ts addTools()`
   (hollow until a populated `RemMemory` data source is wired up).

### Eval methodology

5. Run with `--generate N` for a larger, auto-generated question set (not just
   the 9 curated) to get a more stable score.
6. The oracle returns "NOT IN TRANSCRIPT" for "list all books" (Q1) which then
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
