# Workflow Composition Implementation Plan

**Status:** Draft

**Purpose:** Translate `dsl/workflow-composition.md` into a concrete,
phased plan against the current `examples/workflow/*` packages.
This is the migration this design previously ignored.

**Companion to:** [`workflow-composition.md`](./workflow-composition.md)

---

## 1. Goal

Replace the G1 placeholder (`workflow.<name>` synthetic task nodes)
with the design's IR shape (`WorkflowCallNode` + `WorkflowBody` +
workflow table), wire end-to-end through compiler, engine, and CLI,
and close every decision recorded in §8 of the design doc.

Out of scope for this plan (all deferred per the design):

- Effect inference, versioning, anonymous workflow values, recursion,
  partial application, package-style imports.

---

## 2. Code under change

| Layer       | Package                      | Files                                                                            |
| ----------- | ---------------------------- | -------------------------------------------------------------------------------- |
| IR model    | `examples/workflow/model`    | `ir.ts`, `validate.ts`                                                           |
| DSL surface | `examples/workflow/dsl`      | `lexer.ts`, `ast.ts`, `parser.ts`, `typeChecker.ts`, `emitter.ts`, `compiler.ts` |
| Engine      | `examples/workflow/engine`   | `runner.ts`, `index.ts`                                                          |
| CLI         | `examples/workflow/compiler` | `wfc.ts`                                                                         |
| Adapter     | `examples/workflow/adapter`  | discovery + invocation (only if entry-workflow rule reshapes the API)            |

Spec docs touched at the end:

- `ir/ir-v0.2.md` &mdash; fold in the `workflow` node kind,
  `WorkflowBody`, workflow table, and `entry` field. No version
  bump; the changes land in the existing v0.2 document.
- `dsl/dsl-v0.1.md` &mdash; drop "inlined at compile time"; document
  `export`, `import`, name resolution, defaults, entry rule.
- `dsl/dsl-v0.1-gap.md` &mdash; close G1.

---

## 3. Per-phase process

Every phase below follows the same loop. Do not start the next phase
until the current phase has cleared all four gates.

### 3.1 Implementation

While implementing the phase, **log every design decision that was
not obvious from the design doc, or that contradicted a first
assumption** &mdash; even small ones. These are the entries reviewers
most need to see and the design doc most needs to absorb. Each entry
records: what was decided, what the first assumption was (if
different), why it changed, and any forward consequence.

### 3.2 Code review &times; 2 (sub-agent)

Run a code review pass on the phase's diff using a **sub-agent
reviewer** (the `code-review` agent type or equivalent), not
self-review. Address every actionable piece of feedback. Then run a
**second sub-agent review pass** &mdash; a fresh sub-agent
invocation, not the same one continued &mdash; on the updated diff,
and address its feedback. Two independent passes are intentional:
the first surfaces obvious issues, the second checks that fixes
didn't introduce new ones and that subtler issues weren't masked by
the first round's noise. Running each pass as a fresh sub-agent
keeps the second pass independent of the first's framing.

Feedback that is intentionally **not** acted on is logged with a
short reason (e.g. "out of scope; tracked separately as future doc
X"). A reviewer comment that is silently dropped is a bug; either
fix it or log it.

### 3.3 Test gap analysis &times; 2 (sub-agent)

After the code is in place and passing its own tests, run a
**test gap analysis** with a sub-agent &mdash; ask, "what behaviors
specified in the design doc are not exercised by a test?" &mdash;
and write the missing tests. Then run a **second sub-agent gap
analysis** (fresh invocation) against the updated test suite. Two
independent passes for the same reason as code review: the second
catches gaps the first round's additions created (e.g. new helpers
introduced for tests that themselves need coverage) and gaps that
were only visible once the first round of gaps was closed.

Gaps intentionally **not** filled are logged with a reason
(e.g. "exercise-able only with cross-file imports, deferred to
Phase 7").

### 3.4 Phase exit gate

A phase is complete only when **all** of the following hold:

- Phase-specific exit criteria (listed under each phase below).
- Two code review passes done; all feedback either acted on or
  logged.
- Two test gap analyses done; all gaps either filled or logged.
- Design-decision log updated with anything non-obvious from the
  phase.

---

## 4. Logs

Three log files capture the artifacts the per-phase process
produces. They live next to this plan and are appended to as work
progresses:

- `workflow-composition-decision-log.md` &mdash; non-obvious design
  decisions discovered during implementation, grouped by phase.
  When an entry materially changes the design, also update
  `workflow-composition.md` and cross-link.
- `workflow-composition-review-log.md` &mdash; review feedback that
  was **not** acted on, with reason. Acted-on feedback does not
  need a log entry; the diff is the record.
- `workflow-composition-test-gap-log.md` &mdash; identified test
  gaps that were **not** filled, with reason and (where relevant)
  a pointer to the future doc or phase that would address them.

Create each file on first use; do not pre-create them empty.

---

## 5. Phases

Phases are ordered by dependency. Each phase ends with a green build +
test of the affected packages **and** the per-phase process gate (§3.4).
The "Exit criteria" lines below are the phase-specific items; the
two-pass code review, two-pass test gap analysis, and decision logging
are implied by §3 and apply to every phase.

**No back-compat layer.** Each phase migrates the affected fixtures
and downstream callers to the new shape at the same time as the
production code change. The artifact format change in Phase 1 is not
read alongside the old format; any pre-existing artifact files in
`examples/workflow/workflows/` are regenerated as part of the phase
that introduces the change.

### Phase 1 — IR model (`model`)

Add to `model/src/ir.ts`:

- `WorkflowCallNode` discriminant with the §2.1 shape (`workflowRef`,
  `inputSchema`, `outputSchema`, `inputs`, `bind`, `next`, `onError`).
- `WorkflowBody` type (`inputSchema`, `outputSchema`, `entry`,
  `nodes`, `output`).
- `WorkflowRef` = `{ name: string; source?: "bundle" }`.
- Top-level workflow artifact shape:
  - `workflows: Record<string, WorkflowBody>` (the **workflow table**).
  - `entry: string` &mdash; name of the entry workflow. Always
    present; Phase 6 wires the selection rules that populate it.
- Migrate existing fixtures in `examples/workflow/workflows/` to the
  new artifact shape (single workflow → table with one entry, plus
  `entry` field). Fixture-migration rule for `entry`: if the file
  has exactly one workflow, `entry` is that workflow's name; if the
  file has multiple workflows, `entry` is the one named `main`
  (rename if necessary as part of this migration). The Phase 6
  selection rule will reproduce the same choice once it lands.

Update `validate.ts`:

- Validate `WorkflowCallNode` schemas match the referenced body.
- Validate every `workflowRef.name` resolves in the workflow table.
- Validate the call graph is acyclic (rejects recursion per §2.4).
- Validate `entry` names a workflow present in the table.
- All existing CFG/scope invariants apply unchanged.

**Exit criteria:** `pnpm --filter workflow-model build test` green;
all in-tree fixtures use the new shape.

### Phase 2 — DSL surface: parser only (`dsl`)

Add **parsing-only** support for the surface forms downstream phases
will rely on. No semantic changes yet; the parser produces richer AST
nodes that the existing type checker / emitter will start consuming
in Phases 3 and 4.

`lexer.ts` / `parser.ts` / `ast.ts`:

- `export` keyword as a prefix on `workflow` declarations; AST
  workflow node gains `exported: boolean` (default `false`).
- Named-record argument syntax at call sites
  (`summarize({ text, maxLen: 200 })`).
- Mixed positional + named permitted up to the first named arg
  (matches the JS/TS convention). All-or-nothing is **not** the
  rule.
- Default-expression syntax on parameter declarations
  (`maxLen: number = text.length / 10`).
- `import { name1, name2 } from "./path.wf"` form parses (semantic
  resolution is Phase 7).

Round-trip tests confirm the new AST shapes; no behavior change yet.

**Exit criteria:** `pnpm --filter workflow-dsl build test` green;
new AST shapes round-trip; existing fixtures still parse identically
(no behavioral diff in type checker / emitter at this point).

### Phase 3 — Type checker (`dsl`)

`typeChecker.ts`:

- Construct with **all** workflows in the file (today defaults to
  `[]`; this is the G1 root cause).
- Resolve `WorkflowCallExpr` against the workflow scope: by-name
  lookup, workflows shadow tasks of the same name. Ambiguity
  between a local workflow and a local task of the same name is a
  compile error with a suggestion. Imported-name collisions are
  not surfaced here &mdash; imports are not semantically wired
  until Phase 7; the visibility predicate is in place but the
  cross-file ambiguity case is tested in Phase 7.
- Visibility predicate: private workflows are callable only inside
  their declaring file. Wired and tested now; becomes load-bearing
  in Phase 7 when imports actually cross files.
- Type-check named-record arguments and positional desugar against
  declared parameters.
- Type-check default expressions against the parameter's declared
  type; defaults may reference earlier parameters of the same
  workflow (§4.3).

**Exit criteria:** multi-workflow files type-check; recursion
(direct or mutual) is a compile error citing §2.4; ambiguous-shadow
errors fire; default-expression typing errors fire.

### Phase 4 — Emitter (`dsl`)

`emitter.ts`:

- Replace the `task: "workflow.<name>"` placeholder with a
  `WorkflowCallNode` carrying `workflowRef = { name, source:
"bundle" }`.
- Build the workflow table for each compiled file: include every
  in-file workflow body. Phase 7 extends this to imported bodies.
- Default-argument inlining: at every defaulted call site, splice
  the default's expression tree into the calling scope just before
  the workflow call (§4.3). Document the duplication for future
  optimization (`ir/future/workflow-default-arguments.md`).
- Static cycle check before emit (mirrors validator; emitter fails
  fast with a usable error).

**Exit criteria:** existing single-workflow IR matches the Phase 1
shape; multi-workflow files produce `WorkflowCallNode` references;
default inlining produces the expected expanded IR.

### Phase 5 — Engine (`engine`)

`runner.ts`:

- Add `WorkflowCallNode` handler matching the §2.1 lifecycle:
  evaluate `inputs`, push a sub-scope frame for the referenced
  `WorkflowBody`, run `entry → output`, pop frame, apply `bind`.
- Reuse the existing loop-body / fork-branch sub-scope frame
  machinery (§2.6 of the design: not a new scope rule). If a new
  frame type is necessary, that is a design-decision-log entry.
- Resolve `workflowRef` against the artifact's workflow table; the
  `source` field is read but only `"bundle"` is implemented.
- Error propagation (§2.5): uncaught errors escaping the body
  follow the call node's `onError` exactly like task errors.
- Observability: emit `workflow.enter` / `workflow.exit` events
  analogous to existing task events; sub-workflow frames appear in
  traces (P2, P4). The exact event payload is a phase-5 design
  decision to log.

**Exit criteria:** a two-workflow fixture (`main` calls `helper`)
runs end-to-end through `pnpm --filter workflow-engine test`;
error injected in `helper` lands on `main`'s `onError`;
observability output shows nested frames.

### Phase 6 — Entry workflow rule and CLI

The IR `entry` field exists from Phase 1; the parser understands
`export` from Phase 2; this phase wires the selection logic.

`compiler.ts` / `wfc.ts`:

- Add an `entry` parameter to the compile/run API (CLI flag
  `--entry <name>`).
- Selection rule per §4.6 of the design: caller-specified name
  wins; otherwise look for an exported workflow named `main`;
  otherwise compile/load error.
- Only `export`ed workflows are eligible as entries. Importing a
  workflow does not make its name eligible as an entry of the
  importing file (Phase 7 is what surfaces this).
- The compiler writes the resolved entry name into the artifact's
  `entry` field; the engine reads it without re-resolving.

**Exit criteria:** `--entry` override works; `main` fallback works;
missing-entry produces a clear error; existing fixtures (post
Phase 1 migration) run via the new entry rule.

### Phase 7 — Cross-file imports

`compiler.ts`:

- File loader resolves `./` and `../` against the importing file's
  directory; absolute or workspace-rooted forms are not v1.
- Canonical file extension is `.wf` (rename existing fixtures if
  needed as part of this phase).
- Imports may only name `export`ed workflows; importing a private
  name is a compile error citing §4.4.
- Build the transitive workflow table: BFS from the entry file,
  visit each imported workflow body, add to the table.
- **Cycle policy:** the **call graph** must be acyclic (§2.4);
  file-level mutual imports are permitted as long as no workflow
  cycle exists through them.
- Re-exports (`export { name } from "./other.wf"`) are **not
  supported** in v1; reject with a clear error.
- Name aliasing on import (`import { summarize as articleSummarize }
from "./writing.wf"`) is in from the start to handle collisions
  cleanly.
- Adapter (`workflow-agent`) discovery uses the same resolver;
  adjust `workflowDiscovery.ts` to enumerate exported workflows
  and surface them as actions (still entry-by-name, not arbitrary
  workflow invocation).

**Exit criteria:** two-file fixture (`pipeline.wf` imports
`writing.wf`, per §5 of the design) compiles, type-checks, runs;
private-import attempts and re-export attempts both error
appropriately; alias imports work.

### Phase 8 — Specs, gap entries, fixtures, docs

- Update `dsl/dsl-v0.1.md` §4: replace "inlined at compile time"
  with the §2/§4 wording of the design.
- Fold the IR additions into `ir/ir-v0.2.md` in place &mdash; no
  version bump. Add the `workflow` node kind to the node-kind
  table, add `WorkflowBody` to the sub-scope contracts, add the
  artifact-level `workflows` table and `entry` field, and add the
  acyclic call-graph invariant.
- Close `dsl/dsl-v0.1-gap.md` G1 with a pointer to the resolved
  design + this plan.
- Add `examples/workflow/workflows/` end-to-end fixtures matching
  the §5 worked example.

---

## 6. Test matrix

| Area         | Test                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parser       | `export` keyword parses; named-record arg syntax; default-expression parameter syntax; `import` statement parses; mixed positional+named call sites |
| Type checker | Multi-workflow scope resolution; ambiguous shadow error; private-visibility error; default-expression typing; named-record arg typing               |
| Validator    | Workflow-call schema mismatch; cycle in call graph; dangling `workflowRef`; missing/invalid `entry` field                                           |
| Emitter      | Workflow table contents; default inlining at multiple call sites; `WorkflowCallNode` shape                                                          |
| Engine       | Frame push/pop; output binding; error escape into caller `onError`; observability events; sub-scope frame reuse vs new frame type (log decision)    |
| CLI          | `--entry` override; `main` fallback; missing-entry error; non-exported entry rejection                                                              |
| Imports      | Path resolution; private-import rejection; transitive bundle; call-graph cycle rejection through imports; alias imports; re-export rejection        |
| End-to-end   | `pipeline.wf → writing.wf` runs to completion with expected outputs                                                                                 |

---

## 7. Risk and contingency

- **Default-inlining duplication.** v1 trade. If a fixture hits
  the duplication problem during this work, do not adopt the
  alternatives mid-plan — file an `ir/future/workflow-default-arguments.md`
  trigger entry and proceed.
- **Engine frame model interaction with existing loop/fork frames.**
  Phase 5 reuses the existing sub-scope frame machinery (§2.6 of
  the design says no new scope rule). If reuse is not possible, the
  divergence is a phase-5 design-log entry and likely an escalation
  point to revisit the design.
- **Existing fixtures in `examples/workflow/workflows/`.** The plan
  is **no back-compat**: fixtures are migrated to the new shape in
  the phase that introduces the change (Phase 1 for the artifact
  shape; Phase 7 for any imports). If migration during Phase 1
  uncovers fixtures that depend on the old shape outside the
  workflow packages, treat as a phase-1 design-log entry.

---

## 8. Sequencing notes

- **Phase 1 (IR model)** is the foundation: the artifact shape
  including `entry` and the workflow table lands here. All
  existing fixtures are migrated as part of this phase &mdash;
  there is no dual-shape acceptance window.
- **Phase 2 (DSL surface, parser-only)** lands the syntactic
  forms (`export`, named-record args, defaults, `import` syntax)
  before any phase consumes them semantically. This is the
  ordering fix from the prior plan.
- **Phases 3–5** are the semantic spine (type checker → emitter →
  engine). Each depends on Phase 2's parser output.
- **Phase 6 (entry workflow + CLI)** wires the runtime selection
  logic on top of the `export` parsing (Phase 2) and `entry` field
  (Phase 1).
- **Phase 7 (cross-file imports)** is the only cross-file work; it
  can be skipped for an early milestone if a single-file
  multi-workflow story is sufficient. The design does not require
  it for the IR to be correct, only for the §4.4 ergonomics.
- **Phase 8** is documentation + fixtures + spec edits, after the
  code phases pass review.

### 8.1 Inter-phase integration (expected breakage)

Because the work is phased bottom-up, the full DSL → emit → run
pipeline is **intentionally not integrated** between Phases 1 and 5.
Reviewers and CI gates should expect the following:

| After phase | Model package | DSL package                                  | Engine package     | Full pipeline (parse → emit → run)                                                    |
| ----------- | ------------- | -------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| P1          | works         | unchanged                                    | unchanged          | broken (emitter/engine on old shape; migrated fixtures don't round-trip through emit) |
| P2          | works         | parses new syntax; emit/type-check unchanged | unchanged          | broken (same as P1)                                                                   |
| P3          | works         | type-checks new shapes; emitter unchanged    | unchanged          | broken (emitter still placeholder)                                                    |
| P4          | works         | emits new shape                              | still on old shape | broken (engine can't read new IR)                                                     |
| P5          | works         | works                                        | works              | **integrated**: single-file multi-workflow runs end-to-end                            |
| P6          | works         | works                                        | works              | + entry selection wired                                                               |
| P7          | works         | works                                        | works              | + cross-file imports                                                                  |
| P8          | works         | works                                        | works              | + spec + fixtures + docs current                                                      |

Per-phase exit criteria (§5) name the specific tests that **must**
pass at each phase. Tests outside that named scope failing between
P1 and P5 is expected, not a regression.

---

## 9. What this plan does **not** do

- Introduce any deferred feature from the design (anonymous
  workflows, recursion, effect annotations, versioning, partial
  application, package-style imports, re-exports).
- Change the engine's inlining behavior. Inlining remains absent;
  if a future optimization adds it, this plan's IR shape is the
  contract it must preserve.
- Provide a back-compat layer for the old artifact shape. Old
  fixtures are migrated in-phase, not preserved.
