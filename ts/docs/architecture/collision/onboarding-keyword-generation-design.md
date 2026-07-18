# Design: Onboarding keyword-vector generation

**Status:** Proposed — ready for implementation
**Date:** 2026-07-08
**Owner:** @GeorgeNgMsft
**Area:** `ts/packages/agents/onboarding` (scaffolder phase) + `ts/packages/dispatcher` (contextSelector)
**Related:** `context-weighted-collision-resolution-design.md` §5–§6.3 (keyword-file
storage and the three lifecycle moments)

> **How to read this doc.** §1 states the problem; §2 recaps the keyword-vector
> machinery this builds on; §3 is the end-to-end diagram; §4 specifies the
> dispatcher helper; §5 specifies the onboarding integration; §6 covers edge
> cases and failure semantics; §7 is the testing plan.

---

## 1. Problem & motivation

Context-weighted collision resolution (`context-weight`) routes an ambiguous
request to the agent whose **keyword vector** best matches what the conversation
is about. Each action's baseline vector is read from a committed
`<schema>.keywords.json` file that sits beside the schema source (design §5,
"Source 1"). When that file is absent, the read path falls back to the
deterministic **lexical floor** (live extraction from schema text) — always
correct, but lower quality: it cannot invent the synonyms (`sheet` → `spreadsheet`)
that make routing discriminative.

The context-weighted design names **three lifecycle moments** where a keyword file
is produced (design §6.1):

| Moment                 | Applies to                             | Status before this work                      |
| ---------------------- | -------------------------------------- | -------------------------------------------- |
| **Onboarding flow**    | a newly-onboarded agent                | **not implemented**                          |
| **Initial backfill**   | agents that shipped before the feature | implemented (`@collision keywords backfill`) |
| **Dynamic generation** | agents created at runtime              | lexical floor at load                        |

The backfill moment exists (`@collision keywords backfill`, in
`collisionKeywordHandlers.ts`). The **onboarding moment does not**: an agent
created by the Onboarding Agent ships with no keyword file, so until someone runs
the backfill it routes on the lexical floor only. This work closes that gap —
newly-scaffolded agents get committed, LLM-distilled keyword vectors as a step in
the scaffolder phase, exactly where the design says they should be produced.

## 2. What this builds on

The keyword machinery already exists in the dispatcher's
`context/contextSelector/`; this work reuses it, adding no new keyword logic:

- **`keywordProducer.produceKeywordFile(input, {createModel, topN})`** — for each
  action of a schema, runs LLM distillation when a model factory is supplied
  (preferred), falling back to the lexical floor per action. Returns a whole-schema
  `KeywordFile` plus distilled/lexical counts. Owns no I/O.
- **`keywordFile.keywordFilePathFor(originalPath, path)`** — the single source of
  truth for a keyword file's committable location: the `<name>.keywords.json`
  sibling of an absolute `.ts`/`.mts`/`.cts` schema source.
- **`keywordFile.writeKeywordFile(path, file)`** — persists the file (never throws;
  returns `undefined` on failure).
- **`parseActionSchemaSource(source, schemaName, typeName, fileName)`** (from
  `@typeagent/action-schema`) — parses a schema source string into the
  action-name → definition map `produceKeywordFile` reads.
- **`computeActionSchemaFileHash(schemaType, source)`** (from `agent-cache`) — the
  drift hash the dispatcher stamps on every loaded schema. Reproduced here so the
  committed file's `sourceHash` matches what the dispatcher will later compute (§4).

The read path (`KeywordIndex`) resolves a keyword file **by schema-source path +
action name** — the file's own `schema` field is cosmetic (telemetry /
`@collision keywords` display), never a lookup key. So the only hard requirement
is that each `<schema>.keywords.json` lands beside its schema source with the real
action names as keys.

## 3. End-to-end flow

```
Onboarding Agent — scaffolder phase (handleScaffoldAgent)
  │
  │  writes the new agent package's schema sources:
  │     src/<name>Schema.ts                      (main; type <Pascal>Actions)
  │     src/actions/<group>ActionsSchema.ts      (per sub-group; type <GroupPascal>Actions)
  │
  ▼
scaffolder/keywordGen.ts   (onboarding orchestrator — thin glue)
  │  builds one target per real schema:
  │     { schemaName, schemaSourcePath, entryTypeName, schemaDescription }
  │  skips the main schema when it is the placeholder-only union
  │  supplies the onboarding LLM model factory (instrumented for token accounting)
  │  try/catch per target — never throws, never breaks scaffolding
  │
  ▼  (once per target)
agent-dispatcher/contextSelector → generateKeywordFileForSchemaSource()
  │
  ├─ read schema source file
  ├─ keywordFilePathFor(sourcePath)            → <schema>.keywords.json sibling
  ├─ parseActionSchemaSource(source, …, entryTypeName)   → action definitions
  ├─ computeActionSchemaFileHash(entryTypeName, source)  → sourceHash (drift key)
  ├─ produceKeywordFile({… , sourceHash}, {createModel})  → LLM-distilled (+ lexical floor)
  └─ writeKeywordFile(path, file)              → commit <schema>.keywords.json
  │
  ▼
returns { keywordFilePath, actionCount, distilled, lexical, generatedBy }
  │
  ▼
scaffold result summary lists the generated keyword files
```

At runtime, when the scaffolded agent loads, `KeywordIndex` finds each committed
file beside its schema source and uses its vectors for `context-weight` collision
resolution — no backfill needed.

## 4. Dispatcher helper — `generateKeywordFileForSchemaSource`

New module `context/contextSelector/keywordGen.ts`, exported from
`contextSelector/index.ts` (so onboarding can reach it through the public
`agent-dispatcher/contextSelector` subpath). It is the I/O orchestrator around
the I/O-free `produceKeywordFile`: read source → resolve path → parse → hash →
produce → write. The backfill (`collisionKeywordHandlers.ts`) keeps its own
"produce from a **loaded ActionConfig**" path; both share `produceKeywordFile`.
This helper is the "produce from a **schema source file we own**" path — reused by
the onboarding moment now and available to the dynamic-generation moment later.

```ts
export type GenerateKeywordFileOptions = {
  schemaName: string; // cosmetic file `schema` field: <agent> or <agent>.<sub>
  schemaSourcePath: string; // absolute .ts/.mts/.cts; file is written beside it
  entryTypeName: string; // action union type, e.g. "FooActions"
  schemaDescription?: string;
  createModel?: CreateChatModel; // omit → deterministic lexical-only
  topN?: number;
};

export type GenerateKeywordFileResult = {
  keywordFilePath: string;
  schemaName: string;
  actionCount: number;
  distilled: number;
  lexical: number;
  generatedBy: "llm" | "lexical";
};

export async function generateKeywordFileForSchemaSource(
  options: GenerateKeywordFileOptions,
): Promise<GenerateKeywordFileResult>;
```

**`entryTypeName` does double duty.** It is (a) the `typeName` `parseActionSchemaSource`
uses to find the action union, and (b) the `schemaType` argument to
`computeActionSchemaFileHash`. The dispatcher hashes the schema-**type name string**
(`actionConfig.schemaType`, e.g. `"FooActions"`) — not the parsed object — so
passing `entryTypeName` here reproduces the exact `sourceHash` the dispatcher will
stamp when the agent later loads, letting a future refresh pipeline detect drift.
Scaffolded agents carry no `<schema>.json` sidecar, so the hash's optional `config`
argument is omitted.

**Errors throw** (bad/relative path, unparseable schema, zero actions, write
failure) so the caller can record them per target. `produceKeywordFile` itself
degrades gracefully (LLM failure → lexical floor per action), so the common case
never throws.

## 5. Onboarding integration

### 5.1 Model factory (`lib/llm.ts`)

Add `getKeywordGenModel(endpoint?)`, mirroring the other phase factories:
`instrumentModel(openai.createChatModel(endpoint, …, ["onboarding:keywordgen"]))`.
The `instrumentModel` wrapper folds LLM usage into the active
`runWithTokenUsage` accumulator, which `executeAction` establishes around every
onboarding action — so keyword-gen tokens are reported on the scaffold result's
"Action Tokens" like every other phase.

### 5.2 Orchestrator (`scaffolder/keywordGen.ts`)

A thin onboarding-side function that turns the scaffold outputs into helper calls:

- Build one target per **real** schema:
  - **main:** `entryTypeName = <Pascal>Actions`, source `src/<name>Schema.ts`,
    `schemaName = <name>`, description = the agent description.
  - **each sub-group:** `entryTypeName = <GroupPascal>Actions`, source
    `src/actions/<group>ActionsSchema.ts`, `schemaName = <name>.<group>`,
    description = the group description.
- **Skip the placeholder-only main schema.** When every action is grouped, the
  scaffolder emits a placeholder main union (`actionName: "__placeholder__"`);
  that schema has no real action to distill, so it is skipped (detected via the
  scaffolder's `"__placeholder__"` sentinel — same-package coupling is acceptable).
- Call `generateKeywordFileForSchemaSource` per target with the onboarding model
  factory `(_name) => getKeywordGenModel()`.
- **`try/catch` per target** — collect `{ generated, skipped, errors }`; never
  throw. Return the summary and the generated files' relative paths.

### 5.3 Wiring (`scaffolder/scaffolderHandler.ts`)

Call the orchestrator in `handleScaffoldAgent` after the schema sources are on
disk, wrapped in an outer `try/catch` as defense in depth. Append the generated
keyword files to the scaffold `files` list and add a "Keyword vectors" section to
the result markdown (generated / skipped / errored, with per-file distilled vs
lexical counts). Keyword generation is a **step within** the scaffolder phase —
not a new approval phase — so `OnboardingPhase` / `PHASE_ORDER` are untouched, and
a failure here does not change the phase's `approved` status.

## 6. Edge cases & failure semantics

- **Keyword gen must never break scaffolding.** Per-target `try/catch` in the
  orchestrator plus an outer `try/catch` at the call site. A schema that won't
  parse, a write failure, or an LLM-less environment degrades to "skipped/errored"
  in the summary; the package still scaffolds.
- **LLM-less / misconfigured environments.** `produceKeywordFile` attempts
  distillation per action and falls back to the lexical floor when the model
  factory fails, so the committed file is always complete (just `generatedBy:
"lexical"`). `generatedBy` is `"llm"` only when **every** action distilled.
- **Sub-schema-only agents.** Handled by the placeholder skip — only the real
  sub-schemas get files.
- **Non-`.ts` / relative paths.** `keywordFilePathFor` returns `undefined`; the
  helper throws and the target is recorded as errored. Scaffolded agents always
  have absolute `.ts` sources, so this is a guard, not an expected path.

## 7. Testing plan

- **Dispatcher unit test** (`test/*.spec.ts`, offline) for
  `generateKeywordFileForSchemaSource`: write a schema source to a temp dir, run
  the helper with (a) no model → assert `generatedBy: "lexical"`, a
  `<name>.keywords.json` sibling exists with the real action names as keys, a
  `sourceHash` equal to `computeActionSchemaFileHash(entryTypeName, source)`, and
  (b) a stub model factory → assert `generatedBy: "llm"` and the stub's keywords
  flow through. Assert it throws on a zero-action / bad-path input.
- **Manual E2E:** run the onboarding scaffolder for a small agent and confirm the
  committed keyword files appear beside the schemas and are picked up by
  `@collision keywords <schema>.<action>`.

## 8. Out of scope

- The **refresh pipeline** that re-distills drifted files (design §6.1) — the
  `sourceHash` stamped here is what it will key off.
- The **dynamic-generation** moment (runtime-created agents) — the same helper is
  reusable there, but wiring it is separate work.
