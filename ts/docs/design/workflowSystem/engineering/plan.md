# Workflow Engine v1 - Plan

Status: Active.

## 1. Goal

Build a standalone workflow execution engine that runs real developer
workflows from the CLI, with no dispatcher coupling or external auth
dependencies.

Done means: a developer can `workflow run standup.json --input '{...}'`
from a terminal and get a useful result.

## 2. Non-goals (for this plan)

- Pluggable task loading / dynamic discovery. All tasks are builtins.
- Dispatcher / AppAgent adapter.
- Visual editor or viewer.
- Authoring DSL.
- Run history / persistence.
- Durable execution, checkpointing, resume.
- Email, calendar, or any task requiring OAuth / external account setup.

## 3. What exists today

- **IR v1 spec**: adopted, validated against 2 scenarios (A4, B1).
- **Model package** (`examples/workflow/model/`): IR types, task
  definition types, structural validator.
- **Engine package** (`examples/workflow/engine/`): `WorkflowEngine`
  class supporting all three node kinds (task, branch, loop), template
  resolution, onError dispatch. 6 stdlib tasks. 11 passing tests
  including full A4 morning-brief with mock tasks.

## 4. Phases

### Phase 1: Housekeeping

- Delete `model/src/workflowSpec.ts` (dead code, superseded by `ir.ts`).
- Remove `ajv` from `model/package.json` (no longer imported).
- Update B1 scenario doc to use the template model (close the `??`
  markers that predate decision 0007).

### Phase 2: Builtin task library

Implement real tasks as builtins registered via `registerAllTasks()`.
No plugin mechanism; all tasks live in the engine package.

| Task            | Implementation             | Notes                                                                       |
| --------------- | -------------------------- | --------------------------------------------------------------------------- |
| `shell.exec`    | `child_process.execFile`   | Returns stdout, stderr, exit; no sandboxing in v1 (see §9 security note)    |
| `llm.generate`  | `aiclient`                 | Prompt + text in, text out; model config from `ts/.env` per repo convention |
| `file.read`     | `fs.readFile`              | Path in, contents out                                                       |
| `file.write`    | `fs.writeFile`             | Path + content in, path out                                                 |
| `file.glob`     | `glob` or `fs` + pattern   | Pattern in, path list out                                                   |
| `http.get`      | `fetch()`                  | URL in, body out                                                            |
| `text.template` | Mustache-style interpolate | Template + vars in, string out                                              |
| `json.parse`    | `JSON.parse`               | String in, object out                                                       |
| `string.split`  | `String.split`             | String + delimiter in, list out                                             |
| `string.join`   | `Array.join`               | List + delimiter in, string out                                             |

Plus the 6 existing stdlib tasks: `int.add`, `int.lessThan`,
`list.length`, `list.elementAt`, `list.append`, `bool.toLabel`.

`shell.exec` is the key enabler: it unlocks all git workflows without
needing a per-command task. Git-specific shaping (args, output format)
lives in the IR's constants and templates.

### Phase 3: First real workflow (D1 standup prep)

Build D1 as the first real `.json` IR file under
`examples/workflow/workflows/`. This replaces the original plan to
extract the A4 mock-based test IR; that test remains as-is for engine
unit testing but is not shipped as a workflow.

Phases 2, 3, and 5 are interleaved: build a task, write the workflow
nodes that use it, write unit tests to verify, repeat. This avoids
building tasks speculatively.

- Implement `shell.exec`, `text.template`, `string.join` (enough for
  D1).
- Author `d1-standup-prep.json` using those tasks plus existing
  stdlib.
- Unit test the new tasks. Integration test that loads and runs D1
  against a real git repo.
- Proceed to D4, D5, D8, adding tasks as each workflow demands.

### Phase 4: CLI

New package: `examples/workflow/cli/`.

Three commands:

```
workflow run <file.json> [--input <json>]   Load IR, register builtins, run, print output
workflow validate <file.json>               Load and validate only
workflow list-tasks                         Dump registered task names and schemas
```

Minimal implementation: a single entry point that parses args, loads
the IR file, creates an engine with all builtins registered, and runs.
No framework, no dependency beyond the engine package.

### Phase 5: Remaining developer workflows

Built interleaved with phase 2 tasks (see phase 3 note). Order:

**D1 - Standup prep** (built in phase 3)
`git log --since=yesterday --author=<user>` across N repos, grouped by
repo, rendered as markdown. Exercises: loop, templates, `shell.exec`,
stdlib tasks.

**D4 - Commit summary**
`git diff --staged` piped to LLM to generate a conventional commit
message. Exercises: `shell.exec`, `llm.generate`, linear pipeline.
Adds `llm.generate` task.

**D5 - Code review prep**
`git diff main..HEAD` with per-file diffs obtained by looping over
`git diff --name-only` output, each diff summarized by LLM, composed
into a reviewer's guide. Exercises: loop + LLM, template model at
depth. Exact task shape for splitting diffs will be chosen during
implementation; the top-line question is whether the engine supports
the workflow, not whether the task API is optimal. Task shape is a
separate design dimension per domain.

**D8 - Summarize a URL (B1)**
Fetch public URL, extract text, LLM summarize, write to file.
Exercises: `http.get`, `llm.generate`, `file.write`, onError/retry
pattern.

These four workflows cover all IR features (loop, branch, templates,
onError, stdlib, constants) across real use cases.

**Task authoring signal.** Each workflow is also a data point on how
easy it is to write a task that hooks into the engine. Record friction
(awkward input shapes, missing context, lifecycle gaps) as it arises.
This is v1 evidence for the engine-implementor audience (§7.1), not a
commitment to a stable task API.

### Phase 6: End-to-end validation

- Run each workflow from the CLI against real data.
- Fix engine bugs surfaced by real execution.
- **Unit tests**: per-task tests and engine tests (programmatic,
  import engine directly).
- **Integration tests**: spawn the CLI as a child process, run it
  against the `.json` files, verify stdout.
- Verify event emission is correct and useful for debugging.

## 5. Package layout

```
examples/workflow/
  model/         IR types, task definition, validator (exists)
  engine/        WorkflowEngine, builtin tasks, events (exists)
  cli/           CLI entry point (new, phase 4)
  workflows/     .json IR files for real workflows (new, phase 3+5)
```

## 6. Dependencies

- `model/` depends on nothing.
- `engine/` depends on `model/`, `aiclient` (for `llm.generate`).
- `cli/` depends on `engine/`.
- No dependency on `agentSdk`, `dispatcher`, or any TypeAgent runtime
  package beyond `aiclient`.

## 7. IR validation

The IR spec claims to serve multiple audiences. V1 provides evidence
for some of those claims but not all. Being explicit about scope
prevents false confidence.

### 7.1 Audiences v1 validates

| Audience                   | Claim                                                       | Evidence v1 provides                                        | Scope of evidence                                                                            |
| -------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Engine implementor**     | The IR carries sufficient information for correct execution | 4 working workflows, 3 node kinds exercised, real tasks     | Strong: if the engine is straightforward to build, the IR serves this audience well          |
| **Workflow author (hand)** | A developer can write IR by hand and run it                 | D1-D8 authored as `.json`, loaded by CLI                    | Moderate: proves expressibility, but verbosity is known and expected (DSL compensates later) |
| **Schema validator**       | Structural typing catches mismatches before runtime         | Schema compatibility checking at load time + runtime guards | Strong if implemented; this is a distinguishing feature                                      |

### 7.2 Audiences v1 does NOT validate

| Audience                                           | Why deferred                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **DSL compiler** (codegen emitting IR)             | No DSL exists yet; the "one way to say each thing" claim is untested from the producer side |
| **Static analyzer** (dominator analysis, liveness) | Dominator-based reference validity is designed but not implemented; deferred to post-v1     |
| **Debugger / visualizer**                          | Event stream is emitted but not consumed by any tool                                        |
| **External runtime** (compile-to-foreign)          | No foreign backend exists                                                                   |

### 7.3 IR validation criteria

These are tracked during phases 2-6 and assessed at exit:

1. **Schema compatibility checking.** Implement structural subtyping
   checks over JSON Schema at two levels:

   - **Static (load time):** validator checks that each node's
     producer outputSchema is compatible with the consumer's
     inputSchema.
   - **Runtime:** engine validates that task outputs conform to
     declared outputSchema before passing data downstream.

   Structural type guarantees are a distinguishing feature of the IR.
   They must work, not just be declared. Use an existing JSON Schema
   validation library (e.g., `ajv`) for runtime checks rather than
   hand-rolling. For static subtype compatibility, evaluate whether
   an existing library covers it or whether a focused implementation
   is needed.

2. **Stdlib surface area tracking.** As D1-D8 are built, record every
   case where a new stdlib task is needed that would be a one-liner
   with expressions. If the count stays small (2-3 beyond the current
   16), decision 0006 (no expressions) holds. If it grows large or
   the tasks feel forced, 0006 must be reopened.

3. **Engine implementation ease.** The IR's value to the engine
   audience is measured by how straightforward the engine is to build.
   Track:

   - Cases where the engine needs non-obvious logic to interpret the IR.
   - Cases where the IR forces the engine to do work that a different
     IR shape would avoid.
   - Cases where the engine must silently compensate for IR verbosity
     or structural awkwardness.
     If these accumulate, the IR is not serving its primary audience.

4. **Template model depth.** Decision 0007 introduced nested templates
   with mixed `$from` refs and literals, plus `$literal` escape. Not
   a blocker for v1, but noted: if a workflow needs deep nesting or
   `$literal` and the engine struggles, revisit.

### 7.4 IR design choice validation matrix

Tracks which specific IR choices and decisions receive evidence in v1
and which do not.

#### Core structural choices

| Choice                                       | Validated? | How                                                            | Notes                                                   |
| -------------------------------------------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| Three node kinds (task/branch/loop)          | Yes        | D1 (loop), D5 (branch), D4 (task)                              | All three exercised by real workflows                   |
| Four namespaces (input/constant/scope/state) | Yes        | All workflows use input/constant/scope; D1 uses state          |                                                         |
| `next` as explicit control edge              | Yes        | All workflows                                                  |                                                         |
| Closed loop scopes                           | Yes        | D1 loop body cannot reference outer bindings                   |                                                         |
| `onError` edge model                         | Partially  | D8 exercises recovery; A4 test covers placeholder substitution | No nested onError or loop-level onError tested          |
| Per-node schemas (0003)                      | Yes        | Schema validation at load time + runtime (§7.3 item 1)         |                                                         |
| Dominator-based reference validity           | **No**     | Deferred to post-v1                                            | Designed but not implemented                            |
| Structural subtyping over JSON Schema        | Partially  | Runtime via ajv; static subtype checking at load time          | Depth of subtype checking depends on library evaluation |

#### Decision records

| Decision                     | Claim                                              | Validated? | How                                                                       |
| ---------------------------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| 0001 - Bound outputs         | `bind` + named scope refs beats positional wiring  | Yes        | All workflows use bind + scope refs                                       |
| 0002 - CFG/DDG separation    | Control and data are separate concerns             | Implicitly | Engine sequences independent producers correctly                          |
| 0003 - Task schema source    | Schemas live in IR, not in registry                | Yes        | Schema validation uses IR-declared schemas                                |
| 0004 - Pure SSA              | Scope bindings are write-once                      | Yes        | Engine enforces; any violation is a runtime error                         |
| 0006 - No expressions        | Stdlib tasks replace inline expressions            | Tracked    | Stdlib surface area count at exit (§7.3 item 2)                           |
| 0007 - Template model        | Mixed literals + `$from` refs at any depth         | Partially  | Flat and one-level nesting exercised; depth is a watch item (§7.3 item 4) |
| 0008 - Discriminant encoding | Case keys are strings; `bool.toLabel` for booleans | Yes        | Branch node in D5                                                         |
| 0009 - Loop output source    | `output` resolves in full body scope at `@exit`    | Yes        | A4 engine test; D1 loop                                                   |

## 8. Exit criteria

V1 is done when all of the following are true:

1. **Engine runs all three node kinds** against real (non-mock) tasks,
   verified by at least one workflow per kind (task: D4, branch: within
   D5 or D1, loop: D1).
2. **Four developer workflows** ship as `.json` files and produce
   correct output when run from the CLI against real data (D1, D4, D5,
   D8).
3. **CLI loads and runs** any valid IR file without code changes:
   `workflow run`, `workflow validate`, and `workflow list-tasks` all
   work.
4. **Builtin task library** covers the 10 tasks in the phase 2 table
   plus the 6 stdlib tasks, sufficient to build the four target
   workflows without adding new tasks.
5. **Error paths work**: at least one workflow exercises `onError`
   recovery with a real failure (e.g., D8 fetch of a bad URL produces
   a meaningful error message rather than crashing).
6. **No mock tasks in shipped workflows**: every task in every `.json`
   file produces real output (git commands, LLM calls, file I/O).
7. **Tests pass**: unit tests for the engine, integration tests that
   run the CLI against the `.json` files.
8. **Schema validation works**: static compatibility checking at load
   time and runtime output validation are implemented and exercised
   by at least one workflow.
9. **Stdlib surface area is bounded**: the number of new stdlib tasks
   added beyond the initial 16 is documented; if it exceeds 3,
   decision 0006 is explicitly reassessed before exit.
10. **Engine ease is assessed**: a brief written summary of IR friction
    points encountered during implementation (§7.3 item 3), even if
    the answer is "none."

**Explicitly not required for v1:**

- Works on anyone else's machine without setup guidance.
- Performance targets.
- Polished error messages beyond "identifies the failing node."
- Dominator-based static reference validity analysis.
- Event stream consumed by anything (emitted but not persisted or
  displayed).

## 9. What comes after

Once this plan is complete, the natural next steps are:

- **Dominator-based reference validator**: implement the static
  analysis that proves every `$from` reference resolves on every
  execution path. This is the spec's strongest structural claim and
  the primary audience v1 defers (§7.2).
- **Dispatcher adapter**: wrap the engine as an AppAgent so workflows
  can be invoked via chat.
- **Pluggable tasks**: extract task registration into a discovery
  mechanism so tasks can ship as separate packages.
- **Run viewer**: visualize execution traces from the event stream.
- **Authoring DSL**: a text surface that compiles to IR (16-23x
  compression per B1 analysis).
- **More workflows**: expand the library with community contributions.

### Security note

`shell.exec` and `file.write` execute and write without restriction
in v1. This is acceptable for personal-use developer workflows on a
local machine, but **must be addressed soon after v1** before any of
the following: running untrusted workflow files, dispatcher
integration (where chat input influences workflow parameters),
shared/team workflow registries, or any networked execution surface.
The IR spec already has a placeholder for capability declarations
(§4.2 in the vision doc); the engine needs to enforce them.
