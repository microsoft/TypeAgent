# Plan: VS Code Language Service for the Workflow DSL

## Problem

The workflow DSL (`.wf` files) at `ts/examples/workflow/dsl/` has a complete
lex / parse / type-check / emit pipeline and a formatter, but no editor
support. Authors get no syntax highlighting, no inline diagnostics, no
hover, and no integration with the compiler. We want a VS Code language
service that surfaces all of the existing DSL tooling in the editor and is
reusable in other LSP-capable editors.

## Approach

Build a standalone **Language Server Protocol** server (`workflow-lsp`)
that wraps `workflow-dsl`'s existing lexer/parser/typechecker/formatter,
and ship a thin **VS Code extension** (`workflow-vscode`) that registers
the `.wf` language, provides a TextMate grammar for fast highlighting,
and spawns the LSP server via `vscode-languageclient`.

Key design choices:

- **LSP, not in-process.** Reuse the server in other editors (Neovim,
  Zed, IntelliJ via LSP). Keeps the DSL tooling free of `vscode` deps.
- **Reuse existing APIs.** `compile()`, `format()`, `lex()`,
  `Parser`, `TypeChecker`, `extractGraph()` already expose what we need
  with `SourceLocation` on every node. Phase 0 includes a spike to
  confirm the `TypeChecker` exposes a symbol table (with declaration
  locations) usable by hover / definition / rename. If it doesn't, a
  thin symbol resolver lands in Phase 2 before the navigation features.
- **Two packages, sibling to `formatter`/`compiler`.** Place under
  `ts/examples/workflow/lsp/` (server) and `ts/examples/workflow/vscode/`
  (client + grammar). Mirrors `wff` / `wfc` packaging.
- **Incremental document sync.** Advertise
  `TextDocumentSyncKind.Incremental` and apply changes via
  `vscode-languageserver-textdocument`'s `TextDocument.update()`. Full
  reparse on every change is fine for v1; what we avoid is shipping the
  whole buffer on each keystroke.
- **Cancellation tokens honored.** Every async feature handler
  (completion, hover, code actions, semantic tokens) checks the
  `CancellationToken` between work units so superseded requests don't
  block newer ones.
- **Debounced diagnostics.** 100ms debounce before publishing
  diagnostics to avoid flicker; other features run synchronously off
  the cached parse from the document store.
- **Task schemas = built-ins only, via a runtime-free export.**
  `compile()` and the type checker need `TaskSchemaInfo[]`.
  `workflow-engine`'s `builtinTasks.ts` imports `aiclient` (and
  transitively OpenAI SDK / dotenv), which the LSP should not pull in.
  Phase 0 adds a `builtinTaskSchemas()` export to `workflow-engine`
  that returns `{name, inputSchema, outputSchema}[]` without importing
  any runtime handler. The LSP depends on that export only. Revisit
  if/when the engine grows a user task-extension API.
- **Pin `extractGraph()` consumption.** The graph preview consumes
  `extractGraph()` from `workflow-dsl`. Treat its return shape as part
  of the LSP's stable surface and add a snapshot test on it; if the
  upstream shape changes, the preview gets a deliberate update rather
  than a silent break.

## Architecture

```
+-------------------+        LSP/stdio        +-----------------------+
| VS Code extension | <---------------------> | workflow-lsp server   |
|  - language id    |                         |  - DocumentStore      |
|  - grammar (.tmLanguage.json)               |  - re-parse on change |
|  - LanguageClient |                         |  - feature handlers   |
|  - IR preview cmd |                         |     |                 |
+-------------------+                         |     v                 |
                                              | workflow-dsl          |
                                              |  lex/parse/check/fmt  |
                                              +-----------------------+
```

## Features (in order of implementation)

| #   | Feature              | LSP method                                | Backed by                                |
| --- | -------------------- | ----------------------------------------- | ---------------------------------------- |
| 1   | Syntax highlight     | TextMate grammar (client-side)            | hand-written `.tmLanguage.json`          |
| 2   | Diagnostics          | `textDocument/publishDiagnostics`         | `compile()` errors (lex/parse/typecheck) |
| 3   | Formatting           | `textDocument/formatting`, `rangeFormatting` | `format()`                            |
| 4   | Hover                | `textDocument/hover`                      | `TypeChecker` symbol/type info, task schema descriptions |
| 5   | Document symbols     | `textDocument/documentSymbol`             | AST walk: workflows, params, lets        |
| 6   | Semantic tokens      | `textDocument/semanticTokens/full`        | Lexer + symbol table (params vs locals vs builtins) |
| 7   | Completion           | `textDocument/completion`                 | Keywords, in-scope identifiers, dotted builtins (`shell.exec`, `string.join`, ...), task names, member access on typed values |
| 8   | Signature help       | `textDocument/signatureHelp`              | Task schema parameters at call site      |
| 9   | Go-to-definition     | `textDocument/definition`                 | Symbol table from `TypeChecker`          |
| 10  | Find references      | `textDocument/references`                 | AST walk over identifiers                |
| 11  | Rename               | `textDocument/rename` + `prepareRename`   | Symbol table; rename param/local across scope |
| 12  | Code actions         | `textDocument/codeAction`                 | Quick fixes: insert missing param, inline let, extract let, convert template to concat |
| 13  | Inlay hints          | `textDocument/inlayHint`                  | Inferred types on `const`, return-type on task calls |
| 14  | IR preview           | Custom command `workflow.previewIR`       | `compile()` -> JSON in a side webview, updated on save |
| 15  | Graph preview        | Custom command `workflow.previewGraph`    | `extractGraph()` rendered as inline SVG (layered top-down) in a webview. A real layout engine (`elkjs`, `dagre`, …) was considered and deferred — bundle cost not justified for typical workflow sizes; revisit if graphs exceed ~30 nodes or routing complaints arrive. |

## Packages and files

### `ts/examples/workflow/lsp/` (new)

```
package.json                 # bin: workflow-lsp; deps: workflow-dsl, workflow-model, vscode-languageserver, vscode-languageserver-textdocument
src/server.ts                # connection, capabilities, lifecycle
src/parsedDocument.ts        # URI -> { text, tokens, ast, diagnostics }
src/taskSchemas.ts           # builds TaskSchemaInfo[] from workflow-engine's allBuiltinTasks (one-shot)
src/features/
  diagnostics.ts
  formatting.ts
  hover.ts
  symbols.ts
  semanticTokens.ts
  completion.ts
  signatureHelp.ts
  definition.ts
  references.ts
  rename.ts
  codeActions.ts
  inlayHints.ts
  compileIR.ts
  previewGraph.ts
src/util/position.ts         # SourceLocation <-> LSP Position/Range
src/index.ts                 # bin entry: starts server on stdio
test/                        # per-feature jest specs against in-memory docs
README.md
tsconfig.json / src/tsconfig.json / test/tsconfig.json
jest.config.cjs
```

### `ts/examples/workflow/vscode/` (new)

```
package.json                 # extension manifest; activationEvents on language:workflow
src/extension.ts             # activate(): start LanguageClient, register preview commands (IR preview inline here)
src/graphPreview.ts          # webview that renders extractGraph() as inline SVG (layered top-down)
syntaxes/workflow.tmLanguage.json   # TextMate grammar
language-configuration.json  # brackets, comments, auto-indent
icons/wf.png
README.md
.vscodeignore
esbuild.mjs                  # bundle extension + server for shipping
tsconfig.json
```

The extension bundles the server (`workflow-lsp`) so users don't install
it separately; `esbuild` produces `dist/extension.js` and `dist/server.js`.

## Testing strategy

- **Headless/automated first.** The dev container has restricted
  capability — no GUI VS Code, no Electron rendering. All tests that
  can run in CI must run there. Anything that genuinely needs a real
  VS Code window goes into the manual test plan (next bullet) rather
  than being a phase-exit blocker.
- **Manual test plan doc.** Each phase appends to
  `ts/docs/design/workflowSystem/editor/lsp-manual-tests.md` (created in
  Phase 0). It lists the user-facing scenarios that should be
  exercised in a real VS Code session by someone with a capable
  environment, organized by phase. Phase exit does not depend on
  running these — they're a checklist for a future smoke pass.
- **Headless VS Code attempt.** `@vscode/test-electron` can run an
  extension host headlessly via xvfb. Try it in Phase 0; if the dev
  container can't run it, document the failure mode in
  `lsp-decisions.md` and rely on the in-process LSP harness instead.
- **Coverage tooling.** Configure `c8` (or jest's built-in `--coverage`)
  for the LSP package. Capture a baseline at the end of Phase 0; each
  later phase must not regress overall line coverage.
- **Server unit tests (jest).** For each feature, feed source text +
  cursor position, assert LSP response (diagnostics list, hover content,
  completion items, edits). No vscode dependency.
- **Integration smoke harness lands in Phase 0.** Set up an in-process
  stdio transport (`vscode-languageserver/node`) and a tiny driver in a
  jest spec. Every later phase adds at least one integration spec for
  its feature; Phase 5 only needs to widen coverage, not build the
  harness from scratch.
- **Golden tests for grammar.** Tokenize the existing `.wf` examples
  with `vscode-tmgrammar-test` and snapshot scope assignments.
- **Grammar / lexer drift test.** A jest spec enumerates keywords from
  `lexer.ts` (`TokenKind` values that are keywords) and asserts each
  has a matching `keyword.*` rule in `workflow.tmLanguage.json`. Same
  for the operator/punctuation set. Prevents silent grammar rot when
  the DSL adds tokens.
- **Cancellation tests.** A unit test simulates a cancelled request for
  at least completion and hover, asserting handlers stop early.
- **`extractGraph()` snapshot.** A snapshot test pins the shape of the
  graph the preview consumes; upstream changes are visible diffs.
- **Dep-cycle audit.** A CI step runs `npm ls aiclient` from the LSP
  package and fails if `aiclient` appears in the dependency tree.
  Generalize to: the LSP must not pull in any runtime AI/network
  dependency.
- **License headers.** Lint step (or a script in the LSP test suite)
  asserts every `.ts` / `.json` file in the new packages begins with
  the standard MIT header.

## Open considerations

1. **Task schemas are fixed to built-ins, sourced via a runtime-free
   export.** Phase 0 adds `builtinTaskSchemas()` to `workflow-engine`
   so the LSP avoids the `aiclient` / OpenAI SDK transitive deps.
   Unknown task names produce typecheck diagnostics. When the engine
   adds an extension API, add a discovery layer here.
2. **Multi-file support.** v0.1 of the DSL is single-file (one
   `workflow` per `.wf`). Cross-file go-to-def is out of scope until
   the DSL grows imports.
3. **Performance.** Full reparse on every keystroke is fine for files
   under a few KB. Incremental sync + 100ms debounce on diagnostics.
4. **Reuse of formatter CLI exit semantics.** Server formatting must
   never throw on parse errors; return the original range edits empty
   and rely on diagnostics to surface the error (matches `wff` behavior).
5. **Server packaging in v1: bundle-only.** The extension bundles the
   server (`esbuild` → `dist/server.js`); the server is not published
   to npm or the VS Code marketplace in v1. Standalone install for
   Neovim/Zed users is a future task; the in-extension server stays
   architecturally identical so that future is cheap.
6. **Naming.** Server binary `workflow-lsp`; extension display name
   "Workflow DSL"; language id `workflow`; file extension `.wf`
   (already established).
7. **Server tracing.** Extension exposes a `workflow.trace.server`
   setting (`off | messages | verbose`) wired into the `LanguageClient`
   for protocol-level debugging.
8. **Rename scope.** Symbol rename respects: lexical shadowing
   (renaming an inner `const` doesn't touch the outer one), references
   inside template literal `${...}` substitutions, and prepareRename
   refuses to start on built-in task names, namespaces, or keywords.
9. **`extractGraph()` API stability.** The graph preview pins the
   shape of `extractGraph()` via a snapshot test. If the upstream
   shape changes, the preview update is intentional, not silent.
10. **TypeChecker symbol table.** The plan assumes `TypeChecker`
    exposes per-symbol declaration locations usable by navigation
    features. Phase 0 verifies this; if not, a thin symbol resolver
    lands ahead of Phase 2 (logged in the decisions file).

## Out of scope

- Debugger / DAP integration (run + step through workflows in the editor).
- Visual graph **editor** (see `docs/design/workflowSystem/editor/plan.md`;
  this LSP only provides a read-only graph **preview**).
- Workspace-wide refactors across multiple `.wf` files.
- Marketplace publishing.

---

## Execution phases

Six phases. Each phase ends at a usable checkpoint — you can stop after
any phase and still have a working editor experience that's strictly
better than the previous one.

### Phase 0 — Scaffolding & spikes

Goal: two empty packages that build, lint, and test inside the existing
pnpm workspace; a dev-host VS Code can launch the extension and start an
LSP server that responds to `initialize`. Plus: resolve the two
plan-level risks before any feature work begins.

Todos: `scaffold-lsp`, `scaffold-ext`, `ci-build`, `engine-schemas-export`,
`typechecker-symbol-spike`, `int-test-harness`, `decisions-log`.

Exit criteria:

- `pnpm -w build` succeeds with both packages.
- Pressing F5 on the extension opens a dev host, the server starts on
  stdio, and "Workflow DSL" appears as the language for `.wf` files.
- `workflow-engine` exposes `builtinTaskSchemas()` with no runtime
  imports; the LSP consumes it and ships with no `aiclient` in its
  dependency tree (verify via `npm ls`).
- Symbol-table spike has a written outcome in the decisions log:
  either "TypeChecker exposes what we need" or "Phase 2 must include a
  symbol resolver of shape X".
- Integration test harness exists: an in-process stdio jest spec
  sends `initialize` + `didOpen` and asserts a response.
- Coverage tooling configured (c8/jest); baseline captured.

Note: Phase 0 does **not** run the 2+2 subagent review cycle — the
work is mechanical scaffolding plus two spikes whose outputs go into
the decisions log. The first review cycle runs at the end of Phase 1
against real feature code.

### Phase 1 — "It looks like a real language" (syntax + diagnostics + format)

Goal: opening a `.wf` file is immediately useful: colored syntax, red
squigglies for parse/lex errors, format on save. No semantic features
yet, so no dependence on task schemas.

Todos: `grammar`, `tests-grammar`, `document-store`, `feat-diagnostics`
(lex/parse only initially), `feat-formatting`.

Exit criteria:

- Examples `d1-standup-prep.wf` / `d8-summarize-url.wf` render with
  expected token colors.
- Introducing a syntax error shows a diagnostic at the right range.
- "Format Document" produces the same output as `wff` CLI.

### Phase 2 — Semantic awareness (task schemas + typecheck + navigation basics)

Goal: the server understands names, types, and the built-in task
registry. Diagnostics now include typecheck errors. Hover, document
symbols, and go-to-definition land here because they all depend on the
symbol table built by `TypeChecker`.

Todos: `task-schemas`, upgrade `feat-diagnostics` to include typecheck
phase, `feat-hover`, `feat-symbols`, `feat-definition`, `feat-semantic-tokens`.

Exit criteria:

- Hover on a task call shows its description and signature.
- Outline view lists workflow, params, lets.
- Ctrl/Cmd-click on a variable jumps to its declaration.
- Unknown task names produce typecheck diagnostics.
- Semantic-token coloring distinguishes params vs locals vs tasks.

### Phase 3 — Authoring assists (completion + signature help + inlay hints)

Goal: typing speed and discoverability. The user can explore the
built-in task registry from the keyboard without reading docs.

Todos: `feat-completion`, `feat-signature-help`, `feat-inlay-hints`.

Exit criteria:

- Typing `shell.` shows all `shell.*` members with descriptions.
- Inside a task call, signature help shows current parameter highlighted
  as the user types commas.
- Inferred types render as inlay hints on `const` declarations.

### Phase 4 — Refactoring (references + rename + code actions)

Goal: safe, minimal restructuring. Rename a parameter or local across
the document; quick fixes resolve common diagnostics.

Todos: `feat-references`, `feat-rename`, `feat-code-actions`.

Exit criteria:

- `Shift-F12` lists all uses of a symbol.
- `F2` rename updates every reference atomically.
- Quick-fix lightbulbs appear for at least: missing required arg,
  concat → template, extract const, inline const.

### Phase 5 — Visual previews + polish

Goal: the unique value-add — see the compiled IR and the graph extracted
from the DSL without leaving the editor. Write user-facing docs.

Todos: `cmd-ir-preview`, `cmd-graph-preview`, `tests-server` (final
integration sweep), `docs-readme`.

Exit criteria:

- "Workflow: Preview IR" opens a side panel showing live `compile()`
  output that refreshes on save.
- "Workflow: Preview Graph" renders the graph from `extractGraph()`.
- Server has integration tests covering each feature over an in-process
  stdio transport.
- Both packages have READMEs; an architecture note lands at
  `ts/docs/design/workflowSystem/editor/lsp.md`.

### Cross-cutting

- `tests-server` is listed in Phase 5 as the integration sweep, but
  per-feature unit tests should land alongside each feature in
  Phases 1-4 (jest specs in the same PR as the feature).
- Each phase is independently shippable as a `.vsix` for internal
  preview.

---

## Execution protocol (per phase)

Every phase follows the same loop. The intent is to catch mistakes
early, surface non-obvious tradeoffs, and keep the test surface honest.

### A. Implement

Land the phase's todos. Move them through `pending → in_progress → done`
in the session SQL store. Each feature ships with its own unit tests.

### B. Maintain two log files

**Decisions log:** `ts/docs/design/workflowSystem/editor/lsp-decisions.md`
(created at the start of Phase 0). Append an entry whenever:

- A non-obvious design choice is made.
- An initial assumption from this plan turned out wrong and had to
  change.
- A solution has a viable alternative worth revisiting later.

Decision entry format:

```
## YYYY-MM-DD — <short title>
**Phase:** N
**Status:** decided | provisional | revisit
**Context:** what we hit
**Decision:** what we did
**Alternatives considered:** ...
**Revisit when:** ...
```

`lsp-decisions.md` is the artifact the user reviews after each phase.
It covers plan deviations: choices we made and alternatives worth
revisiting.

### C. Code review — 2 rounds via subagents

For each round:

1. Launch a `code-review` subagent against the phase's diff
   (`git diff main...HEAD` scoped to the LSP / extension paths). Provide
   the phase's exit criteria as context so the reviewer judges
   completeness, not just correctness.
2. Triage the reviewer's findings against this severity bar:
   - **Must fix (blocks phase exit):** bug, security/perf regression,
     correctness gap, exit-criterion failure, accessibility regression.
   - **Should fix (nice-to-have, fix if cheap):** unclear naming,
     duplication, missing comment on non-obvious code.
   - **Reject / defer:** style or preference, or scope creep.
   Any finding that is **not** addressed in this phase — regardless of
   severity — is logged with its disposition and rationale.
3. Re-run the reviewer for round 2 against the updated diff.
4. Phase is not done until round-2 review surfaces **no must-fix items**.
   Should-fix items in round 2 may be deferred with a logged entry.

### D. Test-gap review — 2 rounds via subagents

For each round:

1. Launch a `general-purpose` (or `code-review`) subagent with the
   prompt: *"Audit the test coverage for phase N of the workflow LSP.
   List feature behaviors, edge cases, and error paths that the
   current jest specs do not exercise. Do not suggest style changes;
   only missing coverage."* Provide the phase's exit criteria, the
   list of test files, and the current coverage report.
2. For each gap, decide against this bar:
   - **Must add:** any behavior named in the phase exit criteria;
     any error path of a public LSP method; cancellation / debounce
     boundaries; rename / refactor edits applied to source.
   - **Should add:** edge cases not in exit criteria but in the
     feature spec.
   - **Defer:** combinatorial cases, perf benchmarks.
   Any gap that is **not** filled in this phase — regardless of
   severity — is logged with its disposition and rationale.
3. Run the reviewer again for round 2 after gaps are addressed.
4. Phase is not done until round-2 surfaces no must-add tests and
   overall coverage has not regressed from the prior phase.

### E. Phase exit

A phase is complete when:

- All phase todos are `done` in the session SQL store.
- All automated tests pass; coverage has not regressed.
- Phase exit criteria that can be checked automatically have been
  checked automatically. Exit criteria that require a real VS Code
  window are not blockers — they get appended to
  `lsp-manual-tests.md` for a later capable-environment smoke pass.
- Two code-review rounds and two test-gap rounds (Phases 1-5; Phase 0
  is exempt — see Phase 0 note) have completed with no outstanding
  must-fix / must-add items. Note: subagent reviewers are stateless,
  so round 2 may surface new findings; the protocol terminates after
  two rounds regardless (we iterate once, we don't chase convergence).
- `lsp-decisions.md` has an entry for any plan deviation introduced
  during the phase.
- `lsp-manual-tests.md` has any new manual scenarios appended.
- A `pN-decisions-review` checkpoint todo is marked done by the user
  (signals they've actually read the log files).

Only then proceed to the next phase.
