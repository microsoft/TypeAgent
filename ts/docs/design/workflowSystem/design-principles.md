# Workflow Spec Design Principles

Status: Draft (iterating)

This document establishes design principles for the workflow spec and engine. These principles apply to the entire spec design: data flow, control flow, node types, validation, loops, error handling, and any future extensions. Each principle states a property the design must have, without prescribing a specific mechanism. Concrete scenarios illustrate what each principle enables and excludes.

A good principle should:

- **Drive decisions**: given two design options, the principle tells you which to pick.
- **Be testable**: you can look at a design choice and say "this satisfies/violates principle X."
- **Not prescribe mechanism**: it says what property the design must have, not how to achieve it.
- **Not overlap**: each principle covers a distinct concern.

Note: [plan.md](plan.md) establishes an IR principle (P2 "Bytecode": flat `inputMap`, no expressions, simple graph walker). That principle covers the IR shape. The principles here cover data flow, structure, composability, and predictability.

### Relationship to other design docs

- [plan.md](plan.md) - overall plan, IR principle, milestones. Decisions there should be consistent with these principles.
- [loops-dataflow-controlflow.md](loops-dataflow-controlflow.md) - loop/data-flow/control-flow design. Driven by these principles.

### Existing design consistency check

The existing plan.md decisions are mostly consistent with these principles:

| plan.md decision                   | Principle check                  | Status                                 |
| ---------------------------------- | -------------------------------- | -------------------------------------- |
| `inputMap` flat dictionary         | P2 (traceability)                | Consistent                             |
| `variables` as read-only constants | P2 (traceability)                | Consistent                             |
| Decision via `next` map            | P3 (structural correspondence)   | Consistent                             |
| Error handler is a continuation    | P4 (locality) + P5 (predictable) | Consistent                             |
| `onError` optional, missing = fail | P5 (unsurprising default)        | Consistent                             |
| `maxIterations` with default       | P5 (unsurprising safety limit)   | Consistent                             |
| JSON Schema for validation         | P1 (static provability)          | Consistent                             |
| Pipeline mode allowed              | P2 + P5                          | **Violates** - removing                |
| Flat-graph cycles allowed          | P3 (structural correspondence)   | **Violates** - replacing with LoopNode |
| No `kind` discriminant             | P3 + P5                          | **Violates** - adding `kind`           |

## Principles

| #   | Principle                                                                                                                      | One-line test                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| P1  | Every data reference must be statically provable to resolve to a compatible value at runtime, on every possible execution path | "Does X dominate Y, and are the types compatible?"                                |
| P2  | All data flow is traceable through the spec alone                                                                              | "For any task input, can I trace it back to its origin by reading the spec?"      |
| P3  | Spec structure corresponds to computational structure                                                                          | "Does the spec reveal the pattern, or must you analyze the graph to discover it?" |
| P4  | Each part of the workflow can be understood, validated, and tested without the whole                                           | "Can I validate/test this part without setting up the rest?"                      |
| P5  | A reader of the spec can predict engine behavior without knowing engine conventions                                            | "Would a reader be surprised by the behavior?"                                    |

---

## P1: Every data reference must be statically provable to resolve to a compatible value at runtime, on every possible execution path

If node Y's `inputMap` contains `nodes.X.output.foo`, two things must be provable before the workflow runs:

1. **Existence**: X has executed before Y, no matter which branches were taken. Not "X is reachable before Y" (there exists a path), but "X dominates Y" (every path goes through X first).
2. **Compatibility**: the value at `X.output.foo` is compatible with what Y expects in that input field. The data flowing through the reference must make sense at the destination.

### Scenarios it ENABLES

**1. Confident LLM authoring.** An LLM generates a workflow spec. If it passes validation, every `nodes.*` reference will resolve at runtime. Zero "worked in testing, fails in production because a different branch was taken."

**2. Error handler with safe references.** An error handler for `fetch` can reference `nodes.buildUrl.output.url` (to log the URL that failed), because `buildUrl` dominates `fetch`, which dominates the error handler's activation point. The validator confirms this.

**3. Diamond merge with explicit data flow.** After a branch `{left: A, right: B}` merging at `merge`, `merge` cannot reference `nodes.A.output.*` or `nodes.B.output.*` because neither A nor B dominates `merge` (only one executes). This forces the author to handle both cases - either pass data through loopVars, or route to separate downstream paths.

### Scenarios it EXCLUDES

**4. "Optimistic" references.** You can't write `nodes.cache.output.value` in a node reachable via a path that skips `cache`. Even if you "know" the cache path is always taken in practice, the validator rejects it. You must restructure so that `cache` dominates, or pass the value through the branch explicitly.

**5. Optional enrichment pattern.** A workflow that optionally calls an enrichment step and then references its output in a later node. The later node can't reference the enrichment output because it might not have run. Fix: always run enrichment (with a passthrough for the "skip" case), or use separate downstream paths.

**6. Error handler referencing sibling nodes.** If `onError` on node C points to handler H, and H wants to reference `nodes.B.output.*` where B is a sibling of C (not a dominator of H), this is rejected.

### Resolved: Error handler dominator scope

**Decision: (a) - Error handlers share the normal dominator scope.**

`onError` edges are excluded from the dominator computation (they represent exceptional flow, not guaranteed execution). An error handler node's dominator set is determined by its position in the `next`-edge graph. If H is reachable via `onError` from multiple trigger nodes, H can only reference nodes that dominate ALL of those trigger points (intersection of dominator sets).

This is conservative: if it's too restrictive, the author can use separate handler nodes per trigger. It keeps the dominator model simple (one computation, one scope) and avoids path-sensitive analysis.

---

## P2: All data flow is traceable through the spec alone

For any piece of data consumed by any task, you can trace its origin and every transformation by reading the spec. No hidden channels. No ambient state. No side-effect communication between tasks.

### Corollaries

The following properties fall out of P2 without needing their own principles:

- **Tasks are opaque functions.** Tasks take typed input and return typed output. All inter-task coordination is declared in the spec (via `inputMap`, `outputMap`, `next`). Tasks do not have access to engine state (loopVars, nodeOutputs, other task instances). This is the mechanism that satisfies P2: if tasks can't communicate through hidden channels, all data flow must go through the spec.

- **The spec is an IR, not an authoring format.** If a syntactic convenience (pipeline mode, inferred `kind`, default wiring) hides data flow from the reader, it violates P2. Authoring sugar belongs in a DSL that compiles to the explicit spec. This is also reinforced by P3 (structure must be self-describing) and P5 (reader shouldn't need to know desugaring rules). See plan.md "Authoring strategy" for details.

### Scenarios it ENABLES

**7. Data boundary analysis.** "What data enters this loop from outside? What leaves?" Answerable by reading the boundary declarations. Useful for security review, compliance, understanding blast radius of changes.

**8. Data lineage / provenance.** "This final article came from loopVar `draft`, which was written by the `write` task, which consumed `feedback` and `topic`." Full chain visible in the spec, no runtime tracing needed.

**9. Impact analysis.** "If I change the `evaluate` task's output schema, what downstream consumers are affected?" Follow the data chains through the spec. Static analysis tool can answer this.

**10. Sensitive data tracking.** "Does the user's email address flow into the external API call?" Trace `input.email` through inputMap chains. If every hop is declared in the spec, this is a static analysis problem, not a runtime monitoring problem.

**11. Parallelization analysis (future).** "Can these two nodes run concurrently?" If their data dependencies don't conflict (traceable from the spec), yes. The spec has enough information to determine this without running the workflow.

### Scenarios it EXCLUDES

**12. Tasks communicating via shared external state.** Two tasks that coordinate by writing/reading a database without the spec knowing about it. The engine can't prevent this (tasks are opaque functions), but the principle means the spec-visible data flow is complete. Side channels are the task author's responsibility.

**13. "Magic" data that appears without a declared source.** Every inputMap path must resolve to a declared origin. No `inputMap: { "value": "env.API_KEY" }` unless there's an explicit mechanism for it (like the existing `SecretProvider` on `TaskContext`).

**14. Implicit state via nodeOutputs overwrite.** The current model where re-executing a node silently overwrites its output in `nodeOutputs`, and downstream nodes read the "latest" value. The intent to pass data across iterations is invisible in the spec. Violates traceability.

### How it drives mechanism decisions

| Question                                 | What the principle says                                                                                                                                 | What it doesn't say                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Do we need loopVars?                     | Cross-iteration data must be traceable. Without declared state, the overwrite is invisible.                                                             | Whether they're called "loopVars" or something else, or how they're declared. |
| outputMap on body nodes vs. setVar task? | Both are traceable - the mutation is visible in the spec either way.                                                                                    | Choose based on other principles (P5 predictability, IR simplicity).          |
| Deep writes vs. top-level writes?        | Both are traceable - you can follow either path.                                                                                                        | Choose based on complexity tradeoff and IR simplicity (plan.md P2 Bytecode).  |
| Pipeline mode?                           | Pipeline mode hides data mapping. At a branch merge, which predecessor's output flows? Not traceable without running the graph. **Violates principle.** | N/A - clearly excluded.                                                       |
| Cross-scope node references?             | A body node reading `nodes.outerFetch.output.body` directly IS traceable (you can follow the path). But the scope boundary becomes invisible.           | Whether to allow it depends on P4 (composability), not P2.                    |

### What this principle does NOT resolve alone

- Whether mutable state should be scoped to loops or global (needs P4: composability).
- Whether writes should be schema-validated (needs P1: static provability, but for types not just references).
- The specific mechanism for mutation (outputMap vs. setVar) - both satisfy traceability. Needs P3 (structural correspondence) and P5 (predictability) to break the tie.

---

## P3: Spec structure corresponds to computational structure

The spec's hierarchical structure should mirror the computational patterns. A loop should be represented as a loop construct, not as a pattern you have to recognize in a flat graph. A scope boundary in execution should be a scope boundary in the spec.

Testable: look at the spec structure, then look at the execution trace. Do they correspond? If you have to "discover" a loop by analyzing a flat graph, the structure doesn't correspond to the computation.

### Scenarios it ENABLES

**15. Loop is visible in the spec.** A `LoopNode` wrapping body nodes immediately communicates "iterative refinement." The flat-graph equivalent (a cycle in the node graph) communicates "there are edges." You'd have to run SCC detection to discover the loop.

**16. Visualization without inference.** A tool rendering the workflow can map spec structure directly to visual structure: loop = collapsed box, branch = diamond, linear = arrow. With flat graphs, the tool must infer structure from topology (SCC detection, branch/merge analysis).

**17. LLM generation guardrails.** The `LoopNode` structure is a template: "fill in loopVars, entry, body nodes, exit condition." This constrains generation and reduces errors. With flat graphs, the LLM must correctly construct a cycle with a decision exit, without structural guidance from the IR format.

**18. Refactoring safety.** Extracting a loop body into a sub-workflow, or inlining a sub-workflow, is a structural operation that maps directly to spec structure. With flat graphs, extracting a "loop" means identifying an SCC, cutting edges, creating boundary nodes - a graph surgery that's hard to automate correctly.

### Scenarios it EXCLUDES

**19. Minimal specs.** A simple retry (3 nodes in a cycle) becomes a `LoopNode` with body nodes, loopVars, inputMap, outputMap. More verbose. The principle says: structural clarity justifies verbosity. The DSL handles authoring ergonomics.

**20. Emergent patterns.** If a flat graph happens to contain a cycle, the current engine runs it. With structural correspondence, the author must recognize "this is a loop" and use the loop construct. Accidental cycles are rejected.

### How it drives mechanism decisions

| Question                                           | What the principle says                                                                                                                                                                   | What it doesn't say                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Flat cycles vs. LoopNode?                          | LoopNode: the spec structure mirrors the computational pattern. Flat cycles require graph analysis to discover the pattern.                                                               | The exact shape of LoopNode (fields, nesting rules). |
| Should `kind` be required?                         | Yes: the node type is part of the computational structure. Inferring it from field presence means the structure isn't self-describing.                                                    | N/A - clearly required.                              |
| Decision nodes: `next` map vs. separate construct? | A `next` map on a task node is fine: the decision structure (branch labels -> targets) is visible in the spec. A separate `DecisionNode` type would add structure without adding clarity. | N/A.                                                 |

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs or general graphs (both are structurally explicit; needs P4 to decide).
- The specific fields on LoopNode (needs P2 for data flow, P5 for predictability).
- Whether the spec should encode _why_ a loop exits. Branch labels are structural; intent/purpose is documentation, not computation.

### Relationship to other principles

P3 is the principle most likely to be a **tiebreaker**. When two designs satisfy P1 (reference validity), P2 (traceability), P4 (composability), and P5 (predictability), P3 picks the one whose spec structure better mirrors the computation. For example, flat-graph-with-annotations could satisfy P1/P2/P4/P5, but LoopNode satisfies P3 better.

---

## P4: Each part of the workflow can be understood, validated, and tested without the whole

You should be able to reason about a part of the workflow without understanding the entire workflow. Validation errors should be localizable. Tests should be writable for subsets.

### Scenarios it ENABLES

**21. Isolated loop body testing.** Given mock inputs and initial variable values, run the loop body in isolation. Check variable mutations and exit conditions. No need to set up the entire workflow, register all tasks, or run preceding nodes.

**22. Compositional validation.** Validate the outer graph (treating each loop as an opaque box with declared inputs/outputs), then validate each loop body independently. Errors are localized: "in loop `writeLoop`, node `evaluate` references undefined node `missing`."

**23. Independent reasoning.** A developer reading the loop body can understand its data flow without reading the outer workflow. All external data enters through declared channels. All results leave through declared channels.

**24. Reuse.** A loop body pattern (e.g., "retry with feedback") could be reused across workflows if its boundary contract (inputs, variables, output) is well-defined. The body doesn't depend on the specific outer context.

### Scenarios it EXCLUDES

**25. Cross-scope node references.** A loop body node cannot reach out to `nodes.outerFetch.output.body` directly. It must receive that data through the boundary declaration. More boilerplate, but the part is self-contained.

**26. "Convenient" shared state.** Two loops sharing a global counter by both reading/writing the same mutable variable. Each loop's behavior depends on the other. Violates locality: you can't test one loop without knowing what the other does to the shared state.

**27. Shared error handlers across scopes.** A single error handler node referenced from inside different loop bodies. The handler's behavior depends on which scope triggered it, breaking locality.

### How it drives mechanism decisions

| Question                                  | What the principle says                                                                                                                                                                              | What it doesn't say                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Should loops have explicit boundaries?    | Yes: if the body can be tested in isolation, there must be a declared boundary (inputs in, outputs out).                                                                                             | The exact mechanism (inputMap/outputMap, or something else). |
| Should cross-scope references be allowed? | No: they break isolation. You can't test the body without the outer scope.                                                                                                                           | N/A - clearly excluded.                                      |
| Should mutable state be scoped?           | Yes: if two parts share mutable state, neither can be tested independently.                                                                                                                          | Whether it's per-loop, per-scope, or some other scoping.     |
| Should loop bodies be DAGs?               | **This principle alone doesn't answer this.** A DAG body is easier to test (single-pass). A cyclic body can still be tested in isolation. The preference for DAG comes from the combination with P5. | See "Critical Interaction" section.                          |

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs or general graphs (both can be tested in isolation; DAG is simpler but not required by locality alone).
- Whether variables should be schema-validated (locality says "declared boundary"; validation is about correctness, covered by P1).
- The specific boundary mechanism (inputMap/outputMap vs. parameter passing vs. something else).

---

## P5: A reader of the spec can predict engine behavior without knowing engine conventions

Someone reading the spec should be able to predict what the engine will do, without needing to know engine defaults, conventions, or inference rules. The test isn't "is there implicit behavior?" but "would a reader be surprised?"

### Scenarios it ENABLES

**28. No surprise re-entry.** A reader sees `increment -> write` in a loop body. In the cyclic model, this means "go back to write and re-execute." But is that obvious? Or does the reader need to know that back-edges cause re-execution? With `@iterate`, the reader sees an explicit sentinel: "go back to the loop entry." No knowledge of back-edge semantics needed.

**29. No surprise pipeline wiring.** Pipeline mode (omitting `inputMap`) means "wire the predecessor's output to my input." A reader after a branch merge would need to know the engine's predecessor selection rule. With required `inputMap`, the reader sees exactly which data flows where.

**30. Terminal node behavior is clear.** In the top-level scope, a node without `next` is a terminal - workflow ends. Unsurprising, universal convention. In a loop body, a node without `next` is... what? The reader would need to know the engine's convention (re-enter? exit? error?). This is surprising. Therefore body nodes should have explicit `next`.

**31. Error handling is predictable.** Missing `onError` means "if this node fails, the run fails." This is the unsurprising default - failure propagates. No convention knowledge needed.

### Scenarios it EXCLUDES

**32. Behavior that depends on "knowing the engine."** "Missing `next` in a loop body means implicit re-entry at the loop entry." This requires knowing the engine's convention. Excluded.

**33. Inferred types.** "If the node has a `loopVars` field, it's a loop node." This requires knowing the engine's inference rule. Excluded. `kind: "task"` or `kind: "loop"` is explicit.

### Where predictability does NOT require explicitness

| Case                                     | Predictable without engine knowledge?           | Explicit required?                   |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| Missing `onError` -> run fails           | Yes - failure propagation is universal          | No                                   |
| Missing `next` in top-level -> terminal  | Yes - "no next step" means done                 | No                                   |
| `maxIterations` default of 1000          | Debatable - but safety limits are standard      | No (but documenting it is important) |
| Missing `outputMap` on loop -> no output | Yes - "nothing declared" means nothing produced | No                                   |
| Missing `next` in loop body -> ???       | No - could mean exit, re-enter, or error        | **Yes - must be explicit**           |
| Pipeline mode -> predecessor output      | No - which predecessor?                         | **Yes - must use inputMap**          |

### How it drives mechanism decisions

| Question                     | What the principle says                                                                                                                      | What it doesn't say                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pipeline mode?               | Excluded: unpredictable at merge points.                                                                                                     | N/A.                                                                                   |
| Required `kind`?             | Required: the reader shouldn't infer node type from field presence.                                                                          | N/A.                                                                                   |
| Required `inputMap`?         | Required: the reader should see all data wiring.                                                                                             | N/A.                                                                                   |
| Body node terminal behavior? | Must be explicit (`@exit`, `@iterate`, or `next: "node"`).                                                                                   | Which sentinels to use.                                                                |
| `@iterate` vs. back-edges?   | `@iterate` is more predictable: explicit "re-enter" intent. Back-edges require knowing that pointing to an earlier node causes re-execution. | Whether the DAG model is strictly required (could be a preference, not a requirement). |
| Default `maxIterations`?     | Acceptable: safety limits are unsurprising. But should be documented.                                                                        | N/A.                                                                                   |

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs (both back-edges and `@iterate` can be made predictable with documentation; the preference for `@iterate` is stronger under P5 but not absolute).
- Data flow mechanism choices (outputMap vs. setVar) - both are predictable to a reader.
- Schema validation details - a reader doesn't need to know validation happens to predict behavior.

---

## Critical Interaction: The Body Cycle Question

All five principles converge on one structural decision: should loop bodies be DAGs or general graphs with cycles?

### Current design: body has cycles

```
LoopNode "writeLoop"
  body nodes:
    write -> evaluate -> increment -> write  (cycle)
                      -> @exit               (branch exit)
```

- Iteration happens via explicit back-edges (`increment -> write`).
- `@exit` is the exit sentinel.
- The body scope contains a cycle. Dominator computation works on general graphs.

### Alternative: body is a DAG with `@iterate` sentinel

```
LoopNode "writeLoop"
  body nodes:
    write -> evaluate -> increment -> @iterate  (re-enter)
                      -> @exit                   (exit loop)
```

- Body is a DAG. No cycles. Dominator computation is trivial.
- `@iterate` means "go back to `entry` for another iteration." LoopNode handles re-entry.
- `@exit` means "leave the loop."
- Every body path ends at `@iterate`, `@exit`, or another body node.

### How each principle weighs in

| Principle                      | Cyclic body                                                                                                                                        | DAG + `@iterate`                                                                                                                                           | Verdict                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| P1 (static reference validity) | Dominator computation on general graphs works but is more complex. Cross-iteration `nodes.*` references are possible but require careful analysis. | DAG dominators are trivial. `nodes.*` refs are always within-iteration, always safe. nodeOutputs fresh each iteration.                                     | **DAG is simpler and stronger** |
| P2 (data flow traceability)    | Both are traceable. Cyclic model: loopVars + nodeOutputs overwrite.                                                                                | Both are traceable. DAG model: loopVars carry ALL cross-iteration state. nodeOutputs are iteration-local. Cleaner separation.                              | **DAG is slightly cleaner**     |
| P3 (structural correspondence) | The cycle is structurally visible (back-edge in the graph). But "iteration" is a pattern you discover, not a construct you see.                    | `@iterate` explicitly says "this is an iteration point." The spec structure has two sentinels that correspond to two computational actions (iterate/exit). | **DAG is more explicit**        |
| P4 (locality/composability)    | Both are testable in isolation. But cyclic bodies require multi-iteration test runs.                                                               | DAG bodies can be tested as single-pass functions. Mock inputs + loopVars in, check outputs + loopVar writes + sentinel reached.                           | **DAG is more testable**        |
| P5 (reader predictability)     | A reader seeing `increment -> write` (back-edge) needs to know that pointing to an earlier node causes re-execution.                               | A reader seeing `increment -> @iterate` knows explicitly: "re-enter the loop." No graph analysis needed.                                                   | **DAG is more predictable**     |

### Recommendation

All five principles favor the DAG + `@iterate` model, with varying strength. The cost is one additional sentinel (`@iterate`). The benefit is simpler validation, cleaner data flow separation, better testability, and more predictable behavior.

**This is the key design question to resolve before proceeding.**

---

## Summary

| #   | Principle                                                   | Status       | Remaining questions                                                             |
| --- | ----------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| P1  | Data references statically provable on every path           | **Resolved** | Error handler scope: decided (a)                                                |
| P2  | All data flow traceable through the spec alone              | **Solid**    | Drives loopVars/outputMap necessity but doesn't pick between outputMap variants |
| P3  | Spec structure corresponds to computational structure       | **Solid**    | Tiebreaker role: picks LoopNode over flat cycles                                |
| P4  | Each part understood/validated/tested without the whole     | **Solid**    | Doesn't require DAG alone, but DAG + P5 makes strong case                       |
| P5  | Reader predicts engine behavior without knowing conventions | **Solid**    | Predictability doesn't require explicitness for unsurprising conventions        |

### Principle independence check

| Pair    | Overlap?                                                                                                                                                                                  | Resolution                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1 + P2 | P1 is about reference validity (will it resolve?). P2 is about traceability (can you follow the chain?). A reference could be valid but untraceable (if the data flow channel is hidden). | Independent.                                                                |
| P2 + P5 | P2 covers data flow traceability. P5 covers control flow predictability.                                                                                                                  | Independent domains (data vs. control).                                     |
| P3 + P4 | P3 says structure mirrors computation. P4 says parts are independently understandable. Both push toward LoopNode.                                                                         | Complementary, not redundant. P3 is about the whole; P4 is about the parts. |
| P3 + P5 | P3 says structure is self-describing. P5 says behavior is predictable. A self-describing structure could have surprising behavior (unlikely but possible).                                | Independent.                                                                |
| P1 + P5 | P1 guarantees references resolve. P5 guarantees the reader can predict behavior. P1 is a formal property; P5 is a human-factors property.                                                 | Independent.                                                                |
