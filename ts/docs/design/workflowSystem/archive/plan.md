# Workflow Execution Engine - Plan

> **Status: ARCHIVED.** This plan predates the v1 spec. The IR sketch in
> §5 has been superseded by [../spec/spec-v1.md](../spec/spec-v1.md). The
> engineering content (§1 Goals, §2 Non-Goals, §4 Architecture, §6 Task
> Plugin API) is still partially live and will be distilled into
> `engineering/` and a future `tasks/` component. Preserved for context.

Status: Draft v0.5 (blocking issues resolved, ready for M1)

## 1. Goals

Build a workflow execution engine where:

- A workflow is a directed graph of **nodes**.
- Each node is a **plug-in task** with a schematized input and output.
- Inputs and outputs are validated against their schemas at runtime.
- **Data flows** between nodes via `inputMap` (output of one node feeds input of another).
- **Decision nodes** can pick the next node from a fixed, declared set of successors.
- The workflow **specification is serializable** (JSON / YAML), human-authorable, and agent-authorable.
- The engine emits **observable execution events** so that running workflows can be monitored and visualized.

Out of scope for v1 (planned for later milestones):

- Visual graph editor.
- Live web-based monitoring UI.
- Distributed / multi-process execution.
- Long-running durable persistence (beyond simple checkpoint-to-disk).

## 2. Non-Goals (v1)

- Replacing the dispatcher's action routing.
- Replacing existing agent activity machinery.
- A general-purpose BPMN / Temporal alternative.

## 3. Key Concepts

| Concept               | Description                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `TaskDefinition`      | A registered, named task type. Declares input schema, output schema, branch labels (if any), and an `execute` function. |
| `TaskInstance` (Node) | A specific occurrence of a task in a workflow, with an id, optional `inputMap`, and `next` edge(s).                     |
| `Workflow`            | A serialized graph: nodes + edges + entry node + variables.                                                             |
| `WorkflowRun`         | A single execution of a workflow, with state, history, and current node.                                                |
| `InputMap`            | A flat dictionary mapping input field names to data source paths. Engine resolves via dictionary lookup.                |
| `Decision Node`       | A node whose task returns a `branch` label that selects one of N declared successors.                                   |
| `Engine`              | Loads a workflow, validates it, runs it, and emits events. A simple graph walker.                                       |
| `TaskRegistry`        | Discovery + lookup of `TaskDefinition`s by name.                                                                        |

## 4. Architecture (packages)

New packages under `examples/workflow/` (delete the existing `examples/workflowEditor/` stubs):

- `examples/workflow/model/` - serialized workflow types, JSON Schema, validation, (de)serialization. Pure data, no execution.
- `examples/workflow/engine/` - task registry, runtime, scheduler, event bus, run state. **Zero dependency on agentSdk or dispatcher.**
- `examples/workflow/cli/` - run / inspect / list workflows from the terminal.
- (later) `examples/workflow/adapter/` - thin `WorkflowAgent` adapter that wires the engine into the TypeAgent dispatcher. Depends on `agentSdk`; opt-in.
- (later) `examples/workflow/viewer/` - visualization + monitor.
- (later) `examples/workflow/builtinTasks/` - reusable, common tasks (http, llm-call, transform, branch, wait, sub-workflow).

**Integration model (decided: Hybrid).** The engine is a standalone library with no dispatcher coupling. A separate adapter package can wrap it as an `AppAgent` for dispatcher integration. This keeps the engine testable and reusable outside TypeAgent while allowing first-class integration when desired.

## 5. Workflow Specification

### Authoring strategy (decided: Hybrid)

The JSON spec is the **execution-time artifact** (an IR). It is machine-friendly and minimal, with no authoring sugar. For M1-M3, the spec is also the authoring format (keep it clean but accept verbosity). Once the spec shape stabilizes, a higher-level **authoring DSL** will be introduced that compiles to this spec. The visual editor, agent generators, and text DSL are all "compilers" targeting the same IR.

Design discipline: if something feels like syntactic sugar (inline conditions, shorthand defaults), it belongs in the future authoring layer, not the spec. Use a task node instead.

### IR Design Principle: P2 "Bytecode"

_The IR has a small, fixed set of primitives beyond node execution. The engine is a simple graph walker with minimal interpretation._

- `inputMap` (flat field-to-path dictionary) is the only data-wiring mechanism.
- `variables` are workflow-level named constants, referenced in `inputMap` paths.
- `next: string | object` - one polymorphism encoding two distinct transition semantics (unconditional vs. decision).
- No expressions, no inline conditions, no nested bindings. Everything else is a task node.
- Engine does: load, validate, resolve inputMap (dictionary lookup + dot-path traversal), execute, route.

**Reassessment trigger:** If data transform nodes (remap, string formatting, etc.) become frequent enough that per-node overhead (schema validation, state persistence, event emission) is a measurable cost, evaluate moving to P3 (VM) or P4 (Two-tier). Migration from P2 to P3 is straightforward.

### Spec shape

```jsonc
{
  "specVersion": 1,
  "name": "weekly-news-digest",
  "version": "1",
  "input": {
    "type": "object",
    "properties": { "topic": { "type": "string" } },
    "required": ["topic"],
  },
  "output": {
    "type": "object",
    "properties": { "digest": { "type": "string" } },
  },
  "variables": {
    "maxArticles": 10,
    "urlTemplate": "https://news/api?q={topic}",
  },
  "entry": "buildUrl",
  "nodes": {
    "buildUrl": {
      "task": "string.template",
      "inputMap": {
        "template": "variables.urlTemplate",
        "topic": "input.topic",
      },
      "next": "fetch",
    },
    "fetch": {
      "task": "http.get",
      "inputMap": {
        "url": "nodes.buildUrl.output.result",
      },
      "next": "summarize",
      "onError": "handleFetchError",
    },
    "summarize": {
      "task": "llm.summarize",
      "inputMap": {
        "text": "nodes.fetch.output.body",
        "maxItems": "variables.maxArticles",
      },
      "next": "decideQuality",
    },
    "decideQuality": {
      "task": "threshold.branch",
      "inputMap": {
        "value": "nodes.summarize.output.score",
      },
      "next": {
        "high": "publish",
        "low": "retry",
      },
    },
    "retry": {
      "task": "llm.summarize",
      "inputMap": {
        "text": "nodes.fetch.output.body",
        "maxItems": "variables.maxArticles",
      },
      "next": "decideQuality",
    },
    "publish": {
      "task": "publish",
      "inputMap": {
        "digest": "nodes.summarize.output.summary",
      },
    },
    "handleFetchError": {
      "task": "log.error",
    },
  },
}
```

Notes on the example:

- `specVersion` is the IR format version (integer). Engine uses it to select the right parser/validator.
- `version` is the workflow's content version (string). Author-managed, informational. Engine does not interpret it.
- `buildUrl` is an explicit task node for string composition (no inline expressions).
- `inputMap` is always a flat `{ fieldName: "dataSourcePath" }` dictionary. No nesting, no expressions.
- Data source paths follow the pattern: `input.<field>`, `variables.<name>`, `nodes.<nodeId>.output.<field>`.
- `inputMap` is optional. When omitted, the engine pipes the predecessor's full output as the task input (pipeline mode). At load time, the engine validates that the predecessor's output schema is compatible with the task's input schema.
- Constants live in `variables`; they are never inlined in node specs.
- `onError` points to a node that handles failures. The error node receives engine-constructed input: `{ message: string, data?: unknown, nodeId: string, taskName: string }`. `message` is the error message (from a thrown exception or a task-returned `kind: "fail"`). `data` is optional, task-provided diagnostic payload (opaque, no schema).

### Decisions

- **IR principle (decided: P2 "Bytecode").** The IR has a small, fixed set of primitives. The engine is a simple graph walker. No expressions, no inline conditions. Data transforms are task nodes. Reassess if transform node overhead becomes measurable.
- **Schemas (decided):** JSON Schema at runtime, validated with `ajv`. Task authors may write JSON Schema directly or author TS types and generate JSON Schema at build time (via `actionSchema` or `ts-json-schema-generator`). The engine only consumes JSON Schema.
- **Data wiring (decided: `inputMap`).** Flat dictionary mapping input field names to data source paths. Engine resolves via dictionary lookup + dot-path traversal. No `$ref`, no `$expr`, no recursive bindings. `inputMap` is optional: when omitted, predecessor output pipes directly to task input (pipeline mode), validated at load time via schema compatibility check.
- **Node transitions (decided):** Unified `next` field. String for linear flow (`"next": "nodeId"`), object for decisions (`"next": { "branchLabel": "nodeId", ... }`). Omit `next` for terminal nodes.
- **Decision mechanism (decided):** Decisions are always task-driven. The task returns `kind: "branch"` with a `branch` string; the engine looks up `next[branch]`. Tasks declare their possible branch labels in `branchLabels`; engine validates spec coverage at load time. No spec-level condition expressions.
- **Versioning (deferred):** Tasks referenced by plain name (e.g. `"http.get"`), no version specifier in v1.
- **Loops / fan-out / parallel:** NOT in v1 spec; reserve syntax but reject at validate time.
- **Error handling:** each node may declare `onError: <nodeId>`. The error node receives engine-constructed input: `{ message: string, data?: unknown, nodeId: string, taskName: string }`. If no `onError` is declared, the run fails. If `execute()` throws an exception, the engine catches it and treats it as `kind: "fail"` (same downstream behavior as an explicit fail result). The error handler is a **continuation**: it executes normally and follows its own `next` transitions. If the error handler itself fails, the run fails (no recursive error handling).

## 6. Task Plugin API (sketch)

```ts
interface TaskDefinition<I = unknown, O = unknown> {
  name: string; // e.g. "http.get"
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  branchLabels?: string[]; // declared branch labels for decision tasks
  execute(input: I, ctx: TaskContext): Promise<TaskResult<O>>;
}

type TaskResult<O = unknown> =
  | { kind: "ok"; output: O }
  | { kind: "branch"; branch: string; output?: O } // for decision nodes
  | { kind: "fail"; error: { message: string; data?: unknown } };

interface TaskContext {
  runId: string;
  nodeId: string;
  signal: AbortSignal;
  secrets: SecretProvider; // workflow-scoped shared secrets
  log(level: string, msg: string, data?: unknown): void;
}

// Pluggable structured logger, injected via RunOptions.
// Engine provides a no-op default. Callers can supply a
// console, file, or debug-package-backed implementation.
interface WorkflowLogger {
  log(level: string, msg: string, data?: unknown): void;
}

// Injected by the caller when starting a run; engine does not dictate the backend.
interface SecretProvider {
  get(name: string): Promise<string | undefined>;
}
```

**Secrets (decided):** Each task is self-contained and may manage its own credentials. The engine additionally provides a `SecretProvider` on the `TaskContext` for workflow-scoped shared secrets. The provider is injected by the caller (env-backed, keyring-backed, etc.) so the engine has no opinion on the backend.

Open: how do tasks declare required capabilities (network, fs, llm)? Probably manifest field, enforced by engine policy.

## 7. Execution Semantics (v1)

- Single-threaded async runner; one "current node" at a time.
- For each step: resolve `inputMap` (dictionary lookup + dot-path traversal), validate input against task's `inputSchema`, call `execute`, validate output against `outputSchema`, persist run state, pick next node.
- **Runtime schema validation** of task inputs and outputs against their declared JSON Schemas is planned for M3.5 (between M3 and M4). Until then, schemas are validated structurally at load time but not enforced per-step at runtime.
- If `inputMap` is omitted, pipe predecessor's output directly as input (pipeline mode). Load-time validation ensures schema compatibility.
- If `execute()` throws an exception, engine catches it and wraps it as `kind: "fail"` with the thrown message. Same downstream behavior as an explicit fail result.
- Decision tasks return `kind: "branch"`; engine looks up `next[branch]`; unknown branch -> fail.
- At load time, engine validates that every `branchLabel` declared by the task has a corresponding key in `next`, and every key in `next` is a declared `branchLabel`.
- **Unreachable node detection:** the validator checks that every node in the graph is reachable from the entry node (via `next` and `onError` edges). Unreachable nodes are reported as validation errors.
- Cancellation via `AbortSignal` propagated to in-flight task.
- Determinism: given the same inputs and task implementations, execution produces the same trace. `inputMap` re-evaluated from stored history, so a resumed run produces consistent inputs. Note: if parallel task execution is added (M5+), determinism means the engine must define a canonical ordering for parallel results. Task non-determinism (LLM calls, network) is outside the engine's control.
- **Pluggable logging:** a `WorkflowLogger` interface is injected via `RunOptions`. The engine prefixes log messages with the current node id and delegates to the provided logger. Tasks call `ctx.log(level, msg, data?)`. Default is no-op.

### Loops and Iteration

The workflow graph permits cycles (a node's `next` can point to an earlier node). This enables retry and iterative refinement patterns. To prevent runaway loops:

- **`maxIterations`** (optional, on `WorkflowSpec`): maximum total node executions per run. Default: 1000. The engine increments a counter on each node execution and fails the run if the limit is exceeded.
- **Exit path requirement:** the validator checks that every cycle in the graph contains at least one decision node (a node with `next` as an object/decision map). This ensures there is always a conditional path out of the loop. Unconditional cycles (all nodes in the cycle have `next` as a string) are rejected at validation time.
- **Per-node visit limits (future):** `maxIterations` is a global counter. A per-node `maxVisits` field would allow independent limits on different loops. Deferred until real use cases clarify the need.

These safeguards are slotted for M3.5.

#### Node output scoping in loops

The engine keeps the latest output per node in a `nodeOutputs` map. When a node re-executes in a loop, its output overwrites the previous value. `inputMap` paths like `nodes.<id>.output.*` always resolve to the **most recent** execution of that node. Per-iteration history is not retained in memory; outputs are emitted via events for observability but discarded once overwritten.

This simplifies memory management and resume semantics: persisting and restoring the current `nodeOutputs` map is sufficient to resume a run. No per-iteration history replay is needed.

#### Loop and onError interaction

If a node inside a loop fails and has `onError`, execution redirects to the error handler node. The error handler is a normal continuation: it receives the error data as input, executes, and follows its own `next` transitions. This means an error handler can route back into the loop (retry-on-error pattern). If the error handler itself fails, the run terminates. See the error handling section below for full semantics.

#### Convergent loops

Two branches of a decision can both loop back to the same node (diamond-shaped cycles). The exit-path validation must handle overlapping cycles correctly by analyzing each strongly connected component independently, not just simple back-edges.

#### Loop-aware observability

The event stream emits `nodeStarted`/`nodeCompleted` for every iteration. Events include an `iteration` counter so consumers can distinguish loop iterations of the same node. See Section 9.

### Error Handling

Each node may declare `onError: <nodeId>`. When a node fails (returns `kind: "fail"` or throws):

- If `onError` is declared: execution redirects to the error handler node. The engine constructs error input (`{ message, data?, nodeId, taskName }`) and sets it as `lastOutput`. The error node executes normally (its own `inputMap` or pipeline mode), and follows its own `next` transitions. The error was caught; the workflow continues.
- If `onError` is not declared: the run fails immediately.
- If the error handler itself fails: the run fails (no recursive error handling).

### Parallel Nodes (future)

A `parallel` construct would allow spawning multiple tasks concurrently from a single node, with a join/barrier before continuing. Design considerations:

- Spec shape: a `parallel` field on a node listing sub-node ids or inline task refs.
- Join semantics: wait-all, wait-any, or wait-N. Error propagation policy (fail-fast vs. collect).
- Data merge: how parallel outputs combine into a single downstream input.
- Cancellation: aborting sibling tasks when one fails (fail-fast mode).
- `maxIterations` accounting: each parallel task execution counts toward the global limit.

Slotted for M5+ after the core engine stabilizes. The current single-threaded runner is deliberately simple; parallelism requires careful design of the data context and event ordering.

## 8. Persistence & Resume (v1 minimal)

- Run state (history of node executions, inputs, outputs, status) written as JSON under `~/.typeagent/workflows/runs/<runId>.json` after each node.
- Resume = load file, find first non-completed node, continue.
- No transactionality guarantees in v1; document the limitations.

## 9. Observability

- Engine emits a typed event stream:
  `runStarted`, `nodeStarted`, `nodeCompleted`, `nodeFailed`, `runCompleted`, `runFailed`, `runCancelled`.
- `nodeStarted` and `nodeCompleted` events include an `iteration` counter (1-based) tracking how many times that node has been visited in the current run. This allows monitoring tools to distinguish loop iterations.
- Subscribers: file logger, CLI pretty-printer, (later) viewer.
- Use the `debug` package (`typeagent:workflow:*`) consistent with the rest of the repo.

## 10. CLI (v1)

- `workflow validate <file>` - schema-check a spec.
- `workflow run <file> [--input k=v ...]` - run and stream events.
- `workflow runs ls` - list past runs.
- `workflow runs show <runId>` - dump history.
- `workflow tasks ls` - list registered tasks.

## 11. Testing Strategy

- Unit tests under each package's `test/*.spec.ts` (per repo convention), running against compiled `dist/test/`.
- Engine tests use in-memory fake tasks; no live LLM / network.
- Golden-file tests for serialization round-trip.
- Live tests (`*.test.ts`) reserved for tasks that hit external services.

## 12. Milestones

| #    | Milestone             | Contents                                                                                                                                                                                                                |
| ---- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------------ | ------------------------------------------------------------- |
| M0   | Scaffolding           | Plan (this doc), package layout, types stubs, CI green.                                                                                                                                                                 |
| M1   | Spec + validation     | `model` package: types, JSON Schema, parse + validate, round-trip tests.                                                                                                                                                |
| M2   | Engine MVP            | Linear runs (no branches), in-memory registry, 2-3 trivial built-in tasks (e.g. `passthrough`, `string.template`), event emission. `inputMap` resolves `input.*` and `variables.*` paths only (no cross-node refs yet). |
| M3   | Decisions + data flow | Decision nodes (`branchLabels` validation), full `inputMap` path resolution including `nodes.<id>.output.*` refs, error-edge (`onError`) handling.                                                                      |
| M3.5 | Hardening             | Runtime schema validation of task inputs/outputs per step. Loop safeguards: `maxIterations` limit, exit-path validation (every cycle must contain a decision node). Unreachable node detection (done).                  |
| M4   | Persistence + resume  | Run state on disk, resume, CLI `runs` commands.                                                                                                                                                                         |
| M5   | Built-in task library | http, transform/jq-like, llm-call (via aiclient), sub-workflow.                                                                                                                                                         |     | M5+ | Parallel execution | Parallel node construct: spawn concurrent tasks, join semantics, cancellation propagation. Requires data context and event ordering redesign. |     | M6  | Monitor (headless) | Stable event schema + a tail/inspect CLI; ready for a viewer. |
| M7+  | Viewer / editor       | Out-of-scope for this plan; separate doc.                                                                                                                                                                               |

Each milestone ends with: passing tests, a runnable demo, and an updated section in this doc.

## 13. Resolved Decisions

| #   | Question                    | Decision                                                                                                                                     |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- | --- | --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Schema source of truth      | JSON Schema at runtime; TS authoring optional via build-time generation.                                                                     |
| Q2  | Expression/binding language | **Superseded by Q11.** Replaced by `inputMap` (flat path dictionary). No expressions in the IR.                                              |
| Q3  | Concurrency model           | Deferred to v2.                                                                                                                              |
| Q4  | Agent integration model     | Hybrid: engine is standalone (no agentSdk dep); separate adapter package for dispatcher integration.                                         |
| Q5  | Task versioning             | Deferred. No version specifier in v1; design with packaging/delivery model later.                                                            |
| Q6  | Secrets/credentials         | `SecretProvider` interface on TaskContext for shared secrets; injected by caller. Tasks may also manage their own credentials independently. |
| Q7  | Authoring strategy          | Hybrid: spec is the execution IR (no sugar). M1-M3 author spec directly. Future authoring DSL compiles to spec.                              |
| Q8  | Decision mechanism          | Task-driven only in the spec. Task returns `kind: "branch"` + label; engine does lookup. Condition sugar in future authoring layer.          |
| Q9  | Binding depth               | **Superseded by Q11.** `inputMap` is flat by design. No recursive bindings.                                                                  |
| Q10 | Node transition syntax      | Unified `next` field: string (linear) or object (decision map). Omit for terminal nodes.                                                     |
| Q11 | IR design principle         | P2 "Bytecode": flat `inputMap`, no expressions, simple graph walker engine. Reassess if transform node overhead becomes measurable.          |
| Q12 | Branch label ownership      | Tasks declare `branchLabels`; engine validates spec coverage at load time. Unknown branch at runtime -> fail.                                |
| Q13 | Intercept/analysis hooks    | Deferred. Design avoids decisions that would make hooks hard to add later.                                                                   | \n  | Q14 | Task logging | `WorkflowLogger` interface on `RunOptions`. Engine prefixes with node id and delegates. Default is no-op. Tasks call `ctx.log()`. | \n  | Q15 | Loops | Allowed. Bounded by `maxIterations` (spec-level, default 1000). Every cycle must contain a decision node (validated at load time). |

## 14. Remaining Open Questions

1. Task capability and side-effect declarations. Tasks may declare capabilities they require (network, fs, llm) and side effects they produce (writes to external state, non-idempotent operations). Capability declarations enable engine policy enforcement (e.g., "this workflow may not use network tasks"). Side-effect declarations strengthen the design principles: P2 (data flow traceability) covers spec-visible data flow, but tasks with undeclared side effects create hidden channels. If tasks declare their side effects, static analysis can detect potential conflicts (e.g., two tasks writing to the same external resource) and provide stronger guarantees about workflow behavior. Design: manifest field on `TaskDefinition`? Separate capability schema? TBD.
2. ~~Concurrency model in v2 - parallel branches, fan-out, join semantics.~~ Addressed: parallel nodes slotted for M5+. Detailed design (join semantics, data merge, cancellation) TBD.
3. Task packaging and delivery mechanism (npm packages? local directories? manifests?).
4. How do workflows compose? Can a workflow be a task in another workflow (sub-workflows)?
5. Authoring DSL design (post-M3) - syntax, tooling, error reporting.
6. ~~Pipeline mode semantics~~ Resolved: optional `inputMap`; predecessor output pipes through; load-time schema compatibility check.
7. Loop iteration tracking per cycle vs. global counter. Global counter (M3.5) is simpler but coarser; per-node `maxVisits` would allow independent limits on different loops.
8. Parallel node join semantics: wait-all vs. wait-any vs. wait-N. Error propagation policy (fail-fast vs. collect-all).
9. Parallel node data merge: how do outputs from concurrent tasks combine into a single downstream input?

## 15. Risks

- Scope creep into a general workflow platform. Mitigation: hold the line on v1 scope; parallel slotted for M5+ with separate design.
- Loops enabled but bounded by `maxIterations` and exit-path validation. Risk: authors hit false-positive validation errors on complex graphs. Mitigation: start strict, relax validation if real use cases demand it.
- Overlap with existing dispatcher / cache / activity mechanisms. Mitigation: explicitly map relationships before M2.
- Expression language becomes a tar pit. Mitigation: P2 has no expression language. If transform node overhead triggers a reassessment, migration to P3 is straightforward.

## 16. Next Steps

- [x] Resolve open questions (Q1-Q6).
- [x] Lock IR design principle (P2 Bytecode).
- [x] Review and refine this plan.
- [x] Resolve blocking items (missing variable, pipeline mode, onError, version, exception handling).
- [x] Lock M1 scope (spec shape + validation surface).
- [x] Scaffold `examples/workflow/{model,engine}` packages.
- [x] Write M1 type definitions in `examples/workflow/model/src/`.
- [x] M1: validation, round-trip tests, unreachable node detection.
- [x] M2: engine MVP with passthrough, string.template, log.error, threshold.branch tasks.
- [x] M3: decisions, full inputMap resolution, onError handling, pluggable logging.
- [x] M3.5: runtime schema validation, loop safeguards (maxIterations, exit-path validation).
- [ ] Scaffold `examples/workflow/cli` package.
- [ ] M4: persistence + resume.

## 17. Speculative: IR as a compilation target (post-v1)

> **Status: speculative.** These are not requirements. They may or may not become goals.
> They are recorded here so that if a v1 design decision would conflict with
> them, it can be flagged during decision-making.

Two potential directions for the workflow IR:

1. **Compilers from existing workflow formats to the IR.**
   Other workflow systems (e.g. GitHub Actions YAML, Temporal DSL, Airflow DAGs,
   BPMN XML) could be compiled into our IR and executed by the engine. This
   would prove capability coverage (does our IR express everything these formats
   can?) and provide an adoption path (run existing workflows without rewriting).

2. **Transpilers from our authoring DSL to other formats.**
   Once the authoring DSL exists, a transpiler could emit other workflow formats
   (e.g. GitHub Actions YAML, Argo Workflows) from the same source. This
   expands the ecosystem in the other direction: authors write once and deploy
   to multiple runtimes.

### Design implications to watch for

- The IR must be **semantically rich enough** to represent constructs from
  common workflow systems. If we encounter a widely-used pattern that the IR
  cannot express, that is a signal to revisit the IR, not a reason to add
  sugar to the authoring layer.
- The IR should remain **format-agnostic** in its semantics. Avoid baking in
  assumptions tied to a single serialization format (e.g., JSON-specific
  escape conventions in data paths).
- **Task abstraction boundaries** must be clean enough that a compiler can map
  foreign task types to our `TaskDefinition` interface. The current design
  (schematized input/output, opaque execute) supports this well.
- **Spec versioning (`specVersion`)** becomes more important if third-party
  compilers target the IR. Backward compatibility and migration tooling
  would need to be taken seriously.
