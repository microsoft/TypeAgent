# LSP — Design Decisions Log

Companion to [`lsp-plan.md`](./lsp-plan.md). Append an entry for every
non-obvious design choice, wrong initial assumption that needed change,
or solution with viable alternatives worth revisiting. Fixed bugs and
straightforward implementation choices do NOT need entries — the diff
is the record.

Entries are appended in chronological order; newest at the bottom.

---

## 2026-05-19 — Schemas are duplicated between builtinTasks.ts and builtinTaskSchemas.ts (provisional)

**Phase:** 0
**Status:** provisional
**Context:** `workflow-engine/src/builtinTasks.ts` imports `aiclient`
at the top of the module (transitively pulls in OpenAI SDK, dotenv).
The LSP must not import this module. The plan chose "schemas-only
export from workflow-engine" over duplication, but doing this without
schema duplication requires refactoring 30+ TaskDefinition objects to
reference externally-defined schemas — a large diff that risks
breaking the engine.
**Decision:** For Phase 0, introduce a new file
`src/builtinTaskSchemas.ts` containing `getBuiltinTaskSchemas(): {name,
inputSchema, outputSchema}[]` that **redeclares** the schemas. A jest
spec asserts the two declarations stay in sync (deep-equal across all
task names and schemas). This gives the LSP a clean import path now;
the dedup refactor happens later.
**Alternatives considered:**
- Refactor builtinTasks.ts to import schemas — correct end state, but
  ~30 careful edits; risk to the engine outweighs Phase 0 benefit.
- Have the LSP duplicate schemas internally — worse: drift would be
  silent across packages.
- Move `llmGenerate` / `llmGenerateJson` into a separate file so the
  remaining `builtinTasks.ts` doesn't import `aiclient` — would let
  the LSP import `builtinTasks.ts` directly, but still requires
  surgery and doesn't compose well if more LLM-using tasks land.
**Revisit when:** Phase 5 (after feature work is stable), or when a
schema drift is reported.
**Planned follow-up (2026-05-20):** Address by refactoring
`builtinTasks.ts` to import the schemas from `builtinTaskSchemas.ts`
(the "correct end state" alternative above), removing the duplication
and the sync test. Tracked as the resolution path for this entry.

---

## Update: @vscode/test-electron scaffolding added (still gated on display)

**Phase:** 0/5
**Status:** scaffolding landed, execution still env-gated
**Context:** Earlier decision deferred adding the harness at all. The
follow-up plan called for landing the runner + a single smoke test so
that developers with a GUI VS Code host (or a CI runner with `xvfb`)
can run it without further setup.
**Decision:** Add `@vscode/test-electron`, `mocha`, and `glob` as
dev-dependencies; create `src/test/runTests.ts`,
`src/test/suite/index.ts`, and `src/test/suite/extension.test.ts`
(activation + command-registration smoke); add `test:e2e` script;
replace the previous error-stub `scripts/extension-test.sh` with a
thin wrapper that fails loudly if `DISPLAY` is missing on Linux.
**Revisit when:** A CI job adds `xvfb-run` so this can run on every
PR — at that point promote it from manual to required.

