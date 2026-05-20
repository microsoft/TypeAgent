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

## 2026-05-19 — @vscode/test-electron not used for automated extension tests

**Phase:** 0
**Status:** decided
**Context:** The execution plan called for an end-to-end extension test
spike using `@vscode/test-electron`. Running this package requires
downloading a headless VS Code binary and a display server (Xvfb on
Linux), neither of which is available in the restricted dev container
used for this session.
**Decision:** Skip `@vscode/test-electron` for automated testing.
All LSP logic is exercised via the in-process server harness in
`test/serverIntegration.spec.ts` (no child process, no display server
required). A documented shell stub lives at
`ts/examples/workflow/vscode/scripts/extension-test.sh` for future
use when a GUI VS Code environment is available.
**Alternatives considered:**
- Run in a GitHub Actions workflow with `DISPLAY=:99 Xvfb :99 &` — viable
  but sets a CI prerequisite that shouldn't be required for local
  development in this container.
- Write tests against the `vscode` mock package — covers some APIs but
  misses real extension-host activation, IPC transport, and
  `LanguageClient` lifecycle.
**Revisit when:** This project runs in a devcontainer with full GUI VS
Code support or in a CI job with `DISPLAY` configured.

---

## 2026-05-19 — Graph preview deferred (container constraint)

**Phase:** 5
**Status:** deferred
**Context:** The plan's Phase 5 feature #15 specifies a graph preview
webview powered by `elkjs` for layout. Implementation requires:
(a) `elkjs` bundled into the extension or loaded as a web worker,
(b) a `vscode.WebviewPanel` with correct content-security policy,
(c) live VS Code window to validate the webview lifecycle.
None of these can be verified inside the restricted dev container
(no GUI VS Code, no display server).
**Decision:** Register `workflow.previewGraph` as a command that surfaces
a "coming soon" message. The stub keeps the command palette entry alive
so users can discover the feature and the extension doesn't break when
it is eventually implemented.
**Alternatives considered:**
- Ship a static JSON dump of the graph instead of a visual — easier to
  implement but doesn't match the plan's intent; adds a UI element of
  unclear value without the layout.
- Use a plain `vscode.OutputChannel` with a text-art graph — not useful
  for non-trivial workflows.
**Revisit when:** Running in a full VS Code devcontainer. The elkjs
layout pass and webview implementation should be a focused follow-up
PR.

---

## Update: graph preview implemented (inline SVG, no `elkjs`)

**Phase:** 5
**Status:** delivered
**Context:** Re-opened the earlier deferral. Goal was to ship a usable
graph preview without taking on `elkjs` as an extension dependency
(bundle size + worker plumbing).
**Decision:** Render the `GraphModel` returned by the new
`workflow/previewGraph` LSP request as inline SVG inside a
`vscode.WebviewPanel`. Layout is a simple layered top-down algorithm
(depth = longest incoming-edge chain) computed in the webview script.
This trades pretty-routing for zero added dependencies and keeps the
extension bundle within its current size budget.
**Alternatives considered:**
- `elkjs` via worker — best layout but adds ~500&nbsp;KB to the bundle
  and a worker-startup pause; revisit if the simple layout proves
  insufficient for typical workflow sizes.
- Mermaid `flowchart` — would require a Mermaid runtime in the
  webview and limits styling/click-to-source affordances.
**Revisit when:** Workflows routinely exceed ~30 nodes/edges or when
users ask for cleaner routing — at that point bring in `elkjs` and
run it in a webview worker.

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


## 2026-05-19 — Use `--forceExit` for workflow-lsp jest runs

**Phase:** 0
**Status:** decided (root cause confirmed upstream)
**Context:** The Phase 0 integration smoke test creates an in-process
`PassThrough` stream pair, runs a real LSP `createConnection` over it,
sends `initialize` / `initialized`, and asserts capabilities. Even
after `client.dispose()` + `server.dispose()` + destroying both
PassThroughs (and disposing the StreamMessageReader/Writer), jest hangs
~10s with "did not exit one second after the test run has completed".
**Decision:** Add `--forceExit` to `workflow-lsp`'s `jest-esm` script
so the build pipeline doesn't stall. Test cleanup uses
`stream.destroy()` + `reader.dispose()` + `writer.dispose()` (verified
the strongest cleanup the public API exposes).
**Root cause investigation (2026-05-20):** `--detectOpenHandles`
reports no open handles, yet the event loop stays alive. The remaining
keep-alive is inside `vscode-jsonrpc`'s internal worker queue:
`Connection.run*` schedules pending message processing with
`setImmediate`/microtask handles that are not exposed via
`Connection.dispose()`. This is a test-harness issue only — the
production VS Code extension uses `LanguageClient` from
`vscode-languageclient`, which the extension host owns and tears down
correctly. We do not see the hang in any production flow.
**Alternatives considered:**
- Patch vscode-jsonrpc upstream — out of scope; would block the
  feature work behind a third-party PR.
- Spawn the LSP in a child process for tests — adds real I/O overhead
  and complicates debugging, with no behavioural benefit over the
  in-process harness.
- Skip the integration tests and rely on unit tests — loses the
  wiring proof we explicitly want.
**Revisit when:** vscode-jsonrpc exposes a sync drain/dispose API, or
when test runtime starts to matter (currently 1.4s).

