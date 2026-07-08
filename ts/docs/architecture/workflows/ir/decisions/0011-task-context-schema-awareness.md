# TaskContext schema awareness (decision 0011)

Status: **Adopted (v1).** Engine API extension; **not** an IR change.
Adds `outputSchema` to the `TaskContext` value the engine passes to
`task.execute`. The schema is populated from the dispatching node's
IR-declared `outputSchema` — i.e. existing IR data, made visible to
the task implementer.

Related:

- [../../principles/design-principles.md](../../principles/design-principles.md) — P4 ("each part can be understood / validated / tested without the whole, given only its declared boundary contract").
- [0003-task-schema-source.md](./0003-task-schema-source.md) — establishes that the IR node's `inputSchema`/`outputSchema` are authoritative (Option 1').
- [0010-copilot-task-family.md](./0010-copilot-task-family.md) — the first consumer; `copilot.invoke` reads `ctx.outputSchema` to drive its schema-guided turn loop.

## 1. Problem

Decision 0003 establishes that for every task node the IR's declared
`inputSchema`/`outputSchema` is authoritative — it either restates the
registered task's contract verbatim or narrows it. The engine already
validates a task's return value against the IR-declared `outputSchema`
at runtime (`ir-v1.md` §5.2).

But today, the task implementation cannot **read** its own node's
declared `outputSchema`. `TaskContext` carries `runId`, `nodeId`,
`scopePath`, `signal`, `constraints` — but not the output schema. So
a task that wants to _use_ the schema as part of its computation (for
example, instructing an LLM agent to produce a value of a specific
shape, or driving a schema-aware transform) has no first-class access
to it.

## 2. Decision

Add one field to `TaskContext`:

```typescript
export interface TaskContext {
  runId: string;
  nodeId: string;
  scopePath: string[];
  signal: AbortSignal;
  constraints?: TaskConstraints;
  /**
   * The dispatching node's declared output schema, per IR §3.5.
   * Authoritative for this call: equal to or a narrowing of the
   * registered task's outputSchema (decision 0003 Option 1').
   * The engine validates the task's return value against this
   * schema after execution (IR §5.2); tasks may also use it to
   * shape their computation (e.g. schema-guided LLM responses).
   */
  outputSchema: JSONSchema;
}
```

The engine's runner populates this field from the dispatching
`WorkflowNode`'s `outputSchema` before invoking `task.execute`.

`outputSchema` is declared as required (not optional) on `TaskContext`:
`TaskNode.outputSchema` is required by the IR contract
(`model/src/ir.ts`) and the static validator rejects task nodes that
omit it, so the runner can — and does — pass it unconditionally.

## 3. Why this earns its place

This is a near-zero-cost extension that exposes existing IR data to
the task implementer. It satisfies:

- **P4 (boundary contract).** The IR-declared output schema _is_ half
  of the task's boundary contract for this call (the other half — the
  input — is already supplied as the `execute` argument). P4's
  one-line test — _"Can I validate/test this part using only what its
  boundary declares?"_ — is more directly satisfied when the task
  itself can see its declared output shape, not merely have it
  enforced from outside.
- **Decision 0003 alignment.** 0003 made the IR's output schema
  authoritative. Making it visible to the task is the natural
  consequence: if the IR is the source of truth, the task should be
  able to consult that source.
- **Generality.** The change is not Copilot-specific. Any future
  schema-aware task benefits without re-litigating: a structured-
  response variant of `llm.generate`, a `json.transform` task that
  reshapes input to the declared output, an MCP bridge that maps
  the node's schema onto the upstream protocol, etc.

## 4. Why this is NOT an IR change

No IR field is added or removed. `outputSchema` already exists on
every task node (`ir-v1.md` §3.5). This decision changes only:

- `workflow-model/src/taskDefinition.ts` — the `TaskContext` interface.
- `workflow-engine/src/runner.ts` — the runner populates the new
  field when constructing the per-call `TaskContext`.

`ir-v1.md` does not need editing. No validator rule changes. No
existing IR document semantics change.

## 5. Alternatives considered

### A. Pass the schema in via a side-channel (e.g., a per-runId map)

Reject. Hides the contract from the task's documented interface;
implementers have to know the side-channel exists. The whole point of
`TaskContext` is to be the documented per-call contract handed to
tasks.

### B. Have schema-aware tasks accept a `responseSchema` field on input

Reject. Creates duplicate declarations of the same shape (the IR
node's `outputSchema` and the task's input `responseSchema`) which
must agree by convention but the engine can't enforce in a way that's
visible at one read site. P5 ("would a reader be surprised?") — yes,
because they'd have to know the redundancy is required.

### C. Defer until the next schema-aware task earns the change

Reject. The cost of the change is essentially zero (one field on a
context object, one population site in the runner). Doing it now
means decision 0010 (Copilot task family) lands cleanly and any
future schema-aware task gets the same affordance for free. Doing
it later means doing the migration of test fixtures and the runner
twice.

## 6. Implementation notes

- **No test-fixture cascade.** A scan of `engine/test/` and
  `model/test/` confirms no test directly constructs a `TaskContext`;
  all task execution flows through `WorkflowEngine.run`. The runner
  populates the new field from the node it is dispatching, so
  existing tests continue to work without per-fixture changes.
- **Schema is a JSON value, not an Ajv validator.** The runner does
  NOT pre-compile a per-task `submit_response` validator or otherwise
  cache schemas keyed by node — each task that wants to validate
  against the schema brings its own validator (e.g. Ajv instance).
  Keeping `TaskContext.outputSchema` as a plain `JSONSchema` mirrors
  how `TaskDefinition.outputSchema` is typed today.

## 7. Cross-references

- [../../principles/design-principles.md](../../principles/design-principles.md) — P4.
- [0003-task-schema-source.md](./0003-task-schema-source.md) — what made the IR's schemas the authoritative source this decision exposes.
- [0010-copilot-task-family.md](./0010-copilot-task-family.md) — first consumer.
- [../ir-v1.md](../../../../design/workflowSystem/ir/ir-v1.md) §3.5 (task node `outputSchema`), §5.2 (engine-side runtime output schema validation that this decision does **not** change).
