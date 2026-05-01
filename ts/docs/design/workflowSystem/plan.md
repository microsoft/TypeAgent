# Workflow Execution Engine - Plan

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
- **Error handling:** each node may declare `onError: <nodeId>`. The error node receives engine-constructed input: `{ message: string, data?: unknown, nodeId: string, taskName: string }`. If no `onError` is declared, the run fails. If `execute()` throws an exception, the engine catches it and treats it as `kind: "fail"` (same downstream behavior as an explicit fail result).

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
  emit(event: WorkflowEvent): void; // WorkflowEvent types defined in engine package
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
- If `inputMap` is omitted, pipe predecessor's output directly as input (pipeline mode). Load-time validation ensures schema compatibility.
- If `execute()` throws an exception, engine catches it and wraps it as `kind: "fail"` with the thrown message. Same downstream behavior as an explicit fail result.
- Decision tasks return `kind: "branch"`; engine looks up `next[branch]`; unknown branch -> fail.
- At load time, engine validates that every `branchLabel` declared by the task has a corresponding key in `next`, and every key in `next` is a declared `branchLabel`.
- Cancellation via `AbortSignal` propagated to in-flight task.
- Determinism: `inputMap` re-evaluated from stored history, so a resumed run produces consistent inputs.

## 8. Persistence & Resume (v1 minimal)

- Run state (history of node executions, inputs, outputs, status) written as JSON under `~/.typeagent/workflows/runs/<runId>.json` after each node.
- Resume = load file, find first non-completed node, continue.
- No transactionality guarantees in v1; document the limitations.

## 9. Observability

- Engine emits a typed event stream:
  `runStarted`, `nodeStarted`, `nodeCompleted`, `nodeFailed`, `runCompleted`, `runFailed`, `runCancelled`.
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

| #   | Milestone             | Contents                                                                                                                                                                                                                |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Scaffolding           | Plan (this doc), package layout, types stubs, CI green.                                                                                                                                                                 |
| M1  | Spec + validation     | `model` package: types, JSON Schema, parse + validate, round-trip tests.                                                                                                                                                |
| M2  | Engine MVP            | Linear runs (no branches), in-memory registry, 2-3 trivial built-in tasks (e.g. `passthrough`, `string.template`), event emission. `inputMap` resolves `input.*` and `variables.*` paths only (no cross-node refs yet). |
| M3  | Decisions + data flow | Decision nodes (`branchLabels` validation), full `inputMap` path resolution including `nodes.<id>.output.*` refs, error-edge (`onError`) handling.                                                                      |
| M4  | Persistence + resume  | Run state on disk, resume, CLI `runs` commands.                                                                                                                                                                         |
| M5  | Built-in task library | http, transform/jq-like, llm-call (via aiclient), sub-workflow.                                                                                                                                                         |
| M6  | Monitor (headless)    | Stable event schema + a tail/inspect CLI; ready for a viewer.                                                                                                                                                           |
| M7+ | Viewer / editor       | Out-of-scope for this plan; separate doc.                                                                                                                                                                               |

Each milestone ends with: passing tests, a runnable demo, and an updated section in this doc.

## 13. Resolved Decisions

| #   | Question                    | Decision                                                                                                                                     |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
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
| Q13 | Intercept/analysis hooks    | Deferred. Design avoids decisions that would make hooks hard to add later.                                                                   |

## 14. Remaining Open Questions

1. Task capability declarations (network, fs, llm) - manifest field? Engine policy enforcement?
2. Concurrency model in v2 - parallel branches, fan-out, join semantics.
3. Task packaging and delivery mechanism (npm packages? local directories? manifests?).
4. How do workflows compose? Can a workflow be a task in another workflow (sub-workflows)?
5. Authoring DSL design (post-M3) - syntax, tooling, error reporting.
6. ~~Pipeline mode semantics~~ Resolved: optional `inputMap`; predecessor output pipes through; load-time schema compatibility check.

## 15. Risks

- Scope creep into a general workflow platform. Mitigation: hold the line on v1 scope; defer parallel / loops.
- Overlap with existing dispatcher / cache / activity mechanisms. Mitigation: explicitly map relationships before M2.
- Expression language becomes a tar pit. Mitigation: P2 has no expression language. If transform node overhead triggers a reassessment, migration to P3 is straightforward.

## 16. Next Steps

- [x] Resolve open questions (Q1-Q6).
- [x] Lock IR design principle (P2 Bytecode).
- [x] Review and refine this plan.
- [x] Resolve blocking items (missing variable, pipeline mode, onError, version, exception handling).
- [ ] Lock M1 scope (spec shape + validation surface).
- [ ] Delete `examples/workflowEditor/` stubs.
- [ ] Scaffold `examples/workflow/{model,engine,cli}` packages.
- [ ] Write M1 type definitions in `examples/workflow/model/src/`.
