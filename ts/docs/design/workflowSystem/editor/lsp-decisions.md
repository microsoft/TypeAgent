# LSP — Design Decisions Log

Companion to [`lsp-plan.md`](./lsp-plan.md). Append an entry for every
non-obvious design choice, wrong initial assumption that needed change,
or solution with viable alternatives worth revisiting. Fixed bugs and
straightforward implementation choices do NOT need entries — the diff
is the record.

Entries are appended in chronological order; newest at the bottom.

---

## 2026-05-19 — TypeChecker does not expose a symbol table

**Phase:** 0
**Status:** decided
**Context:** The plan assumes `TypeChecker` can serve as the source of
truth for go-to-definition, hover, references, and rename. Reading
`typeChecker.ts`: it has a private `Scope` that tracks name -> TypeInfo
during a single pass, but does NOT record per-reference declaration
locations and does not survive past `check()`. The errors array is the
only public output.
**Decision:** Phase 2 will include a thin **symbol resolver** pass that
walks the AST and produces, per identifier reference, the declaring
node (param or const) with its `SourceLocation`. This is independent of
`TypeChecker` and lives in the LSP package. The resolver also drives
semantic tokens (param vs local vs builtin classification).
**Alternatives considered:**
- Modify `workflow-dsl`'s `TypeChecker` to expose its `Scope` as a
  result — rejected: cross-package surface change, harder to evolve.
- Use the IR emitter's symbol resolution — rejected: emitter only runs
  on a successful typecheck; LSP needs symbol info even on partial
  parses.
**Revisit when:** `workflow-dsl` grows a richer compiler API that
exposes scoping naturally (e.g., for IDE service integration).

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

---

## 2026-05-19 — Phase 0 exempt from 2+2 subagent review cycle

**Phase:** 0
**Status:** decided
**Context:** The 2-round code review + 2-round test-gap review protocol
adds latency proportional to phase complexity. Phase 0 is mechanical
scaffolding plus two spikes; there's little surface for a reviewer to
engage with beyond "are the package.jsons correct?".
**Decision:** Skip the review rounds for Phase 0. The first review
cycle runs at the end of Phase 1 against real feature code (grammar,
diagnostics, formatter integration).
**Alternatives considered:** Run a single round-1 review on Phase 0
just to validate the scaffolding pattern — deferred unless a Phase 1
finding indicates the scaffold itself has issues.
**Revisit when:** Future projects with similar scaffolding can reuse
this exemption pattern.

---

## 2026-05-19 — `workflow-engine/schemas` sub-export to keep `aiclient` out of the LSP bundle

**Phase:** 0
**Status:** decided
**Context:** Even though `getBuiltinTaskSchemas` lives in its own
aiclient-free module, the engine's barrel `src/index.ts` re-exports
`builtinTasks.ts` (which imports `aiclient` at the top). Importing
*anything* from `"workflow-engine"` therefore drags `aiclient` into the
import graph. esbuild bundling of the LSP for the VS Code extension
would pull ~MB of OpenAI / Azure SDK code into `dist/server.js`.
**Decision:** Add a sub-export to engine's `package.json`:
```jsonc
"exports": {
  ".": "./dist/index.js",
  "./schemas": "./dist/builtinTaskSchemas.js"
}
```
The LSP uses `import { getBuiltinTaskSchemas } from "workflow-engine/schemas"`.
A post-bundle check script (`vscode/scripts/check-server-bundle.mjs`)
greps the produced `dist/server.js` for `aiclient/dist`, `@azure/openai`,
`@azure/identity` and fails the build if any leak in. Verified clean:
171 KB server bundle.
**Alternatives considered:**
- Strip the `builtinTasks.ts` re-export from engine's barrel — would
  break existing consumers (engine and others import from the barrel).
- Side-effect-free dynamic import in taskSchemas.ts — wouldn't help
  because esbuild bundles dynamic imports too.
**Revisit when:** the engine refactor (paired with the schema-duplication
decision above) consolidates schemas; the sub-export can stay
indefinitely as the canonical "LSP / static-analysis" entrypoint.

---

## 2026-05-19 — Use `--forceExit` for workflow-lsp jest runs

**Phase:** 0
**Status:** provisional
**Context:** The Phase 0 integration smoke test creates an in-process
`PassThrough` stream pair, runs a real LSP `createConnection` over it,
sends `initialize` / `initialized`, and asserts capabilities. Even
after `client.dispose()` + `server.dispose()` + ending both
PassThroughs, jest hangs ~10s with "did not exit one second after the
test run has completed". The vscode-jsonrpc connection registers timers
that aren't all unrefed.
**Decision:** Add `--forceExit` to `workflow-lsp`'s `jest-esm` script
for Phase 0 so the build pipeline doesn't stall.
**Alternatives considered:**
- `--detectOpenHandles` and chase the handles — does not move Phase 0
  forward; revisit if Phase 1 integration tests grow.
- Skip the integration test and rely on unit tests of feature handlers
  — loses the wiring proof we explicitly want.
**Revisit when:** Phase 1 adds the real integration harness; we may
ship a shared test helper that registers cleanup hooks before resorting
to `--forceExit`.

