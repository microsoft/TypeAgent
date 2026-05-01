# Workflow Spec Design Principles

Status: Draft (iterating)

This document establishes design principles for the workflow spec and engine. These principles apply to the entire spec design: data flow, control flow, node types, validation, loops, error handling, and any future extensions. Each principle states a property the design must have, without prescribing a specific mechanism. Concrete scenarios illustrate what each principle enables and excludes.

A good principle should:

- **Drive decisions**: given two design options, the principle tells you which to pick.
- **Be testable**: you can look at a design choice and say "this satisfies/violates principle X."
- **Not prescribe mechanism**: it says what property the design must have, not how to achieve it.
- **Not overlap**: each principle covers a distinct concern.

### Principles govern the boundary, not the interior

A task is a black box: typed input in, typed output out. The workflow author chooses where to draw the task boundary. In the extreme, the entire workflow could be a single task - trivially satisfying all five principles (no references, no data flow, no structure to validate).

| Exposed in spec                    | Engine provides                                |
| ---------------------------------- | ---------------------------------------------- |
| Declared data dependency           | P1: validated existence + type compatibility   |
| Data path from source to consumer  | P2: traceability, lineage, impact analysis     |
| Loop/branch/sequence structure     | P3: observability, event stream per node       |
| Separate nodes with schemas        | P4: independent validation and testing         |
| Explicit transitions + error edges | P5: predictable behavior from reading the spec |

The principles become interesting as the author decomposes work into separate nodes. They guarantee the decomposition is sound. But they don't say "decompose as much as possible." The question for the workflow author is: where do I want the engine's capabilities?

The boundary is not fixed. Today, "typed input in, typed output out" is the full contract. In the future, additional behavioral declarations on tasks (e.g., side-effect annotations, capability requirements, idempotency markers) would extend the boundary: more information crosses from the task into the spec, enabling richer engine analysis without changing the task implementation. The design should remain open to expanding what tasks declare about themselves. See plan.md open question #1 (capability and side-effect declarations).

This framing matters when evaluating design alternatives. A pattern that "pushes logic into a task" isn't violating the principles - it's choosing a different boundary. The principles apply to what's on the spec side of the boundary.

### The spec is an IR, not an authoring format

If a syntactic convenience (pipeline mode, inferred node types, default wiring) hides data flow from the reader, it undermines the principles. Authoring sugar belongs in a DSL that compiles to the explicit spec. This is a cross-cutting consequence of multiple principles:

- **P2 (traceability):** implicit wiring creates data flow the reader can't trace.
- **P3 (structural correspondence):** inferred structure doesn't match what the reader sees.
- **P5 (predictability):** the reader must know desugaring rules to predict behavior.

This is not a new principle (it doesn't drive decisions independently), but a design consequence that P2, P3, and P5 converge on. See plan.md "Authoring strategy" for details.

### Relationship to other design docs

- [plan.md](plan.md) - overall plan, IR principle, milestones. Decisions there should be consistent with these principles.
- [loops-dataflow-controlflow.md](loops-dataflow-controlflow.md) - loop/data-flow/control-flow design. Driven by these principles.
- [design-decisions.md](design-decisions.md) - design decisions driven by these principles. Mechanism tables, resolved questions, open questions, and cross-cutting design analyses.

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

If node Y declares a dependency on a value produced by node X, two things must be provable before the workflow runs:

1. **Existence**: X has executed before Y, no matter which branches were taken. Not "X is reachable before Y" (there exists a path), but "X dominates Y" (every path goes through X first).
2. **Compatibility**: the value produced by X is compatible with what Y expects in that input. The data flowing through the reference must make sense at the destination.

### Scenarios it ENABLES

**1. Confident LLM authoring.** An LLM generates a workflow spec. If it passes validation, every data reference will resolve at runtime. This eliminates the class of bugs where a reference resolves during testing but fails in production because a different branch was taken.

**2. Error handler with safe references.** An error handler for `fetch` can reference the output of `buildUrl` (to log the URL that failed), because `buildUrl` dominates `fetch`, which dominates the error handler's activation point. The validator confirms this.

**3. Diamond merge with explicit data flow.** After a branch `{left: A, right: B}` merging at `merge`, `merge` cannot reference the output of A or B because neither dominates `merge` (only one executes). This forces the author to handle both cases - either pass data through declared cross-iteration state, or route to separate downstream paths.

### Patterns requiring alternative expression

These patterns are natural to reach for, but P1 requires them to be expressed differently. Each analysis covers the intent, why P1 rejects the direct expression, and the alternative with tradeoffs.

**4. "Optimistic" references.**

- _Intent:_ Use cached data downstream, where the cache node is behind a branch that usually (but not always) executes.
- _Why rejected:_ A reference to `cache`'s output in a node reachable via a path that skips `cache` violates the "every path" requirement. The validator cannot distinguish "usually taken" from "sometimes skipped."
- _Alternative:_ (a) Restructure so `cache` dominates the consumer (move it before the branch). (b) Pass the value explicitly through both branches via declared data wiring. (c) Mark the reference as optional: the consumer receives the cached value when `cache` runs and handles its absence otherwise.
- _Tradeoff:_ (a) may run `cache` when unnecessary. (b) adds wiring verbosity. (c) moves the conditional logic inside the task, which is a legitimate boundary choice: the task is the right place to decide what to do when cache data is absent. All three make the data flow explicit.

**5. Optional enrichment.**

- _Intent:_ Optionally call an enrichment step, then reference its output in a downstream node regardless of whether enrichment ran.
- _Why rejected:_ The downstream node's reference to `enrich`'s output is invalid on the path that skips enrichment.
- _Alternative:_ (a) Always run the enrichment node, with a passthrough/identity task for the "skip" case (produces a default output). (b) Use separate downstream paths after the branch, each wiring data from its own predecessor. (c) Mark the enrichment reference as optional: the downstream task receives enriched data when available and handles the unenriched case itself.
- _Tradeoff:_ (a) adds a passthrough node that exists solely to satisfy the dominator requirement - graph structure that doesn't correspond to computational intent (tension with P3). (b) duplicates downstream nodes. (c) puts the conditional handling inside the consuming task, which is arguably where it belongs: the task knows what to do with or without enrichment.

**6. Error handler referencing sibling outputs.**

- _Intent:_ An error handler for node C wants context from sibling node B (e.g., to include B's output in a diagnostic message).
- _Why rejected:_ B is a sibling of C, not a dominator of the error handler H. B may not have executed on the path that reached H.
- _Alternative:_ (a) If B dominates C, then B also dominates H transitively, and the reference is actually valid (no change needed). (b) If B does not dominate C, wire B's output through C's input so it's available in the error context. (c) Use a dedicated error handler per trigger node, each with its own dominator scope.
- _Tradeoff:_ (b) adds a field to C's input that exists only for error diagnostics. (c) increases handler count. Both make the data dependency explicit.

### Outside the boundary

P1 governs spec-level data references. What happens inside tasks is outside the principle's scope.

**Task-internal data resolution.** A task that internally resolves data from a cache, database, or computed lookup. P1 does not require these internal references to be statically provable. The spec sees a single task with typed input and output; how the task resolves data internally is the task author's concern. The boundary framing applies: if the author wants the engine to validate a data dependency, they expose it in the spec as a declared reference.

**7. Optional data at merge points.**

- _Intent:_ A single merge node after a branch handles "data present or absent" depending on which branch ran. The merge task internally decides what to do when some inputs are missing.
- _Why rejected (without optional references):_ P1 requires every reference to resolve on every path. The consumer cannot ask "was this produced?" Restructuring to guarantee data on all paths (passthrough nodes, default values) changes the semantics: data is always present, just sometimes a default.
- _Alternative:_ (a) Passthrough/default nodes on every branch path so data is always present. (b) Separate downstream paths per branch, no merge node. (c) Mark branch-specific references as optional: the merge task receives what's available and handles absence internally.
- _Tradeoff:_ (a) changes semantics (data is always present). (b) duplicates downstream logic. (c) is the natural boundary: the merge task's job is to combine data from multiple sources, some of which may not be available. This is the strongest motivation for optional references.

### Patterns ruled out

These patterns cannot be expressed as a single reference in the IR. However, since the spec defines all nodes, the set of possible targets is always finite and known at spec time, so equivalent behavior can always be achieved through explicit enumeration.

**8. Computed indirection.** A reference whose target is determined at runtime (e.g., "read from whichever node's name is stored in variable X"). P1 requires all reference targets to be statically known at validation time. A computed reference whose target depends on runtime data cannot exist in the spec.

_Workaround:_ Use a decision node that branches to the possible targets, with each branch wiring its output to the downstream consumer. For example, a "multi-strategy" pattern (classifier picks one of N summarizers) is expressed as a decision branch where each strategy node has `next: "format"`. If all strategies produce a compatible output schema, `format`'s input is satisfied on every path. The cost is verbosity (N entries in a `next` map instead of one computed reference), not lost capability. The decision-tree workaround always works for any finite spec.

---

## P2: All data flow is traceable through the spec alone

For any piece of data consumed by any task, you can trace its origin and every transformation by reading the spec. No hidden channels. No ambient state. No side-effect communication between tasks.

### Scenarios it ENABLES

**9. Data boundary analysis.** "What data enters this loop from outside? What leaves?" Answerable by reading the boundary declarations. Useful for security review, compliance, understanding blast radius of changes.

**10. Data lineage / provenance.** "This final article came from loop-scoped variable `draft`, which was written by the `write` task, which consumed `feedback` and `topic`." Full chain visible in the spec, no runtime tracing needed.

**11. Impact analysis.** "If I change the `evaluate` task's output schema, what downstream consumers are affected?" Follow the data chains through the spec. Static analysis tool can answer this.

**12. Sensitive data tracking.** "Does the user's email address flow into the external API call?" Trace the flow of `email` through declared data references. If every hop is declared in the spec, this is a static analysis problem, not a runtime monitoring problem.

**13. Parallelization analysis.** "Can these two nodes run concurrently?" If their data dependencies don't conflict (traceable from the spec), yes. The spec has enough information to determine this without running the workflow.

### Patterns requiring alternative expression

**14. External configuration.**

- _Intent:_ A task needs an API key, environment variable, or external config value.
- _Why the direct approach violates P2:_ A reference to an environment variable in the data wiring would mean the engine resolves data from outside the spec. The reader can't trace the value's origin from the spec alone.
- _Alternative:_ (a) Declare the value as a constant in the spec: fully traceable. (b) The task requests secrets through a declared provider interface, injected by the caller. (c) The task manages its own credentials internally (outside the boundary).
- _Tradeoff:_ (a) puts config in the spec (visible but may not belong there for secrets). (b) is traceable at the interface level ("this task uses secrets") but not at the value level (you can't trace the actual key). (c) is fully opaque. The boundary framing applies: secrets accessed inside the task are the task's business, not the spec's.

**15. Cross-iteration state.**

- _Intent:_ A loop body node wants to read the output of a previous iteration's execution (e.g., "what did the `evaluate` task produce last time?").
- _Why the direct approach violates P2:_ If node outputs silently overwrite on re-execution and downstream nodes read the "latest" value, the intent to pass data across iterations is invisible in the spec. You can't tell from the spec that data flows across iterations.
- _Alternative:_ Declare cross-iteration state explicitly as loop-scoped variables. Body nodes write to them via declared output bindings, and read from them via declared input bindings. Every cross-iteration data flow is declared in the spec.
- _Tradeoff:_ More verbose than implicit overwrite. But the overwrite model is exactly the kind of hidden channel P2 exists to prevent. The verbosity is the traceability.

### Outside the boundary

These patterns involve data flow that P2 does not govern because it occurs inside tasks (beyond the spec boundary). P2 guarantees that the spec-visible data flow is complete. What tasks do internally is opaque by design.

**16. Tasks communicating via shared external state.** Two tasks that coordinate by writing/reading a database, file system, or external service without the spec declaring this dependency. The engine can't detect or prevent this. The spec-visible data flow is still complete and traceable; the side channel is invisible to analysis. Future mitigation: task side-effect declarations (see plan.md open question #1) would surface these channels, expanding the boundary.

**17. Task-internal state across invocations.** A task that caches results, maintains counters, or remembers prior inputs across calls. From the spec's perspective, each invocation is independent (input in, output out). The hidden state may affect outputs but is invisible to the spec. Same mitigation path as above: side-effect/statefulness declarations would make this visible.

**18. Observability data.** Tasks emit logs via `ctx.log()`, and the engine emits events (`nodeStarted`, `nodeCompleted`). This is data flow the spec doesn't trace. Acceptable: observability is about monitoring, not computational data flow. The principle covers data that affects workflow outcomes, not diagnostic side channels.

### Patterns ruled out

**19. Undeclared data origins.** Every data reference must resolve to a declared origin: workflow input, declared constants, another node's output, or loop-scoped state. There is no escape hatch for "get this value from somewhere the spec doesn't know about." If data enters the workflow, it enters through a declared channel.

_Why this is genuinely ruled out:_ Unlike P1's "patterns ruled out" (where workarounds always exist for finite specs), P2's exclusion is absolute. If the engine resolves data from an undeclared source, it breaks traceability by definition. The set of valid data origins is fixed by the spec schema.

### What this principle does NOT resolve alone

- Whether mutable state should be scoped to loops or global (needs P4: composability).
- Whether writes should be schema-validated (needs P1: static provability, but for types not just references).
- The specific mechanism for declaring mutations - multiple approaches satisfy traceability. Needs P3 (structural correspondence) and P5 (predictability) to break the tie.

---

## P3: Spec structure corresponds to computational structure

The spec's hierarchical structure should mirror the computational patterns. A loop should be represented as a loop construct, not as a pattern you have to recognize in a flat graph. A scope boundary in execution should be a scope boundary in the spec.

Testable: look at the spec structure, then look at the execution trace. Do they correspond? If you have to "discover" a loop by analyzing a flat graph, the structure doesn't correspond to the computation.

### Scenarios it ENABLES

**20. Loop is visible in the spec.** A loop construct wrapping body nodes immediately communicates "iterative refinement." The flat-graph equivalent (a cycle in the node graph) communicates "there are edges." You'd have to run SCC detection to discover the loop.

**21. Visualization without inference.** A tool rendering the workflow can map spec structure directly to visual structure: loop = collapsed box, branch = diamond, linear = arrow. With flat graphs, the tool must infer structure from topology (SCC detection, branch/merge analysis).

**22. LLM generation guardrails.** The loop construct is a template: "fill in cross-iteration state, entry point, body nodes, exit condition." This constrains generation and reduces errors. With flat graphs, the LLM must correctly construct a cycle with a decision exit, without structural guidance from the IR format.

**23. Refactoring safety.** Extracting a loop body into a sub-workflow, or inlining a sub-workflow, is a structural operation that maps directly to spec structure. With flat graphs, extracting a "loop" means identifying an SCC, cutting edges, creating boundary nodes - a graph surgery that's hard to automate correctly.

**24. Sub-workflow composition (future).** When sub-workflows are added, a sub-workflow call should be structurally visible as a different kind of node (not a regular task that happens to invoke another workflow internally). The reader sees "this is a sub-workflow" from the spec structure, not by knowing which tasks are wrappers.

### Patterns requiring alternative expression

**25. Minimal retry loops.**

- _Intent:_ Express a simple retry pattern (try, check, retry) with minimal syntax - just 3 nodes pointing at each other in a cycle.
- _Why P3 requires a different expression:_ A flat cycle hides the "this is a loop" pattern. You have to analyze the graph to discover it. P3 says the computational pattern should be visible in the spec structure.
- _Alternative:_ Use a loop construct with body nodes, cross-iteration state declarations, and entry/exit sentinels.
- _Tradeoff:_ More verbose for simple cases. But the structure communicates intent (retry loop), enables visualization tools, and constrains LLM generation. The DSL can provide authoring sugar for common patterns (e.g., `retry(3) { ... }` compiling to a loop construct).

**26. Emergent patterns.**

- _Intent:_ Let a flat graph "just work" when it happens to contain a cycle. The engine detects the cycle and runs it as a loop.
- _Why P3 requires a different expression:_ The author must recognize "this is a loop" and use the loop construct. Accidental cycles are rejected at validation time.
- _Alternative:_ Use an explicit loop construct.
- _Tradeoff:_ The author does more work upfront to declare intent. But accidental infinite loops are caught at validation time rather than runtime. The intent is visible to tools and readers. A DSL can accept free-form loop expressions (flat cycles in a higher-level syntax) and compile them to a loop construct, erroring if the cycle can't be transformed into a structured loop. This keeps the IR strict while allowing flexible authoring.

**27. Error-retry via error edges.**

- _Intent:_ An `onError` handler routes back to the failed node to retry it, creating a cycle through the error edge.
- _Why P3 requires a different expression:_ The retry pattern is a loop, but it's hiding inside error-edge topology. The reader has to trace error edges to discover the retry behavior.
- _Alternative:_ Wrap the retry-able section in a loop construct where the body includes the error-prone task and its handler, with the exit condition being success or max retries exceeded.
- _Tradeoff:_ More structure to set up. But the retry loop is now visible as a loop, bounded by a declared iteration limit, and testable as a loop body (P4). The error handler inside the loop body handles the failure case; the loop structure handles the retry.

### Outside the boundary

P3 governs spec-level structure. What happens inside tasks is opaque and outside the principle's scope.

**28. Task-internal control flow.** A task that internally loops, branches, calls sub-functions, or does complex control flow. This is invisible to P3. The spec sees a single task node with input and output. The internal complexity is the task author's concern. The boundary framing applies: if the author wants the engine to observe the internal structure (events, intermediate state, error handling), they decompose the task into multiple nodes. Otherwise, the task is a black box.

### Patterns ruled out

P3 does not rule out any computational capability. Every computation expressible with flat cycles is also expressible with a loop construct + DAG body. The principle constrains the _form of expression_, not the _range of computation_.

The one thing P3 genuinely prevents is **structural ambiguity**: a spec where the reader cannot tell whether a pattern is a loop, a branch, or a linear sequence without analyzing the graph. With node type discriminants and explicit constructs, every node's role is self-describing.

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs or general graphs (both are structurally explicit; needs P4 to decide).
- The specific fields on the loop construct (needs P2 for data flow, P5 for predictability).
- Whether the spec should encode _why_ a loop exits. Branch labels are structural; intent/purpose is documentation, not computation.

### Relationship to other principles

P3 is the principle most likely to be a **tiebreaker**. When two designs satisfy P1 (reference validity), P2 (traceability), P4 (composability), and P5 (predictability), P3 picks the one whose spec structure better mirrors the computation. For example, flat-graph-with-annotations could satisfy P1/P2/P4/P5, but a loop construct satisfies P3 better.

---

## P4: Each part of the workflow can be understood, validated, and tested without the whole

You should be able to reason about a part of the workflow without understanding the entire workflow. Validation errors should be localizable. Tests should be writable for subsets.

### Scenarios it ENABLES

**29. Isolated loop body testing.** Given mock inputs and initial variable values, run the loop body in isolation. Check variable mutations and exit conditions. No need to set up the entire workflow, register all tasks, or run preceding nodes.

**30. Compositional validation.** Validate the outer graph (treating each loop as an opaque box with declared inputs/outputs), then validate each loop body independently. Errors are localized: "in loop `writeLoop`, node `evaluate` references undefined node `missing`."

**31. Independent reasoning.** A developer reading the loop body can understand its data flow without reading the outer workflow. All external data enters through declared channels. All results leave through declared channels.

**32. Reuse.** A loop body pattern (e.g., "retry with feedback") could be reused across workflows if its boundary contract (inputs, variables, output) is well-defined. The body doesn't depend on the specific outer context.

### Patterns requiring alternative expression

**33. Cross-scope node references.**

- _Intent:_ A loop body node directly references the output of a node in the enclosing scope.
- _Why P4 requires a different expression:_ The body can't be tested without providing the outer scope. The reference creates a hidden dependency: the body looks self-contained, but its data flow reaches outside its boundary.
- _Alternative:_ Pass the outer data through the loop construct's boundary declaration (declared inputs on the loop). The body node reads from a declared input, not a cross-scope reference.
- _Tradeoff:_ More boilerplate (declaring the input on the loop boundary). But the body is now genuinely self-contained: you can test it by providing mock inputs without constructing the outer workflow. The boundary declaration also serves as documentation of the body's external dependencies.

**34. "Convenient" shared state.**

- _Intent:_ Two loops share a global counter by both reading/writing the same mutable variable. Simpler than passing state through each loop's boundary.
- _Why P4 requires a different expression:_ Each loop's behavior depends on the other's mutations. You can't test one loop without knowing what the other does to the shared state. The loops are coupled through a hidden channel.
- _Alternative:_ Scope state to each loop. If they need to share a counter, pass it through declared channels: loop A outputs the counter, loop B receives it via declared input wiring. The sequential dependency is visible in the spec.
- _Tradeoff:_ More wiring between loops. But the dependency is explicit: "loop B depends on loop A's counter." Testable independently by mocking the counter input.

**35. Shared error handlers across scopes.**

- _Intent:_ A single error handler node is referenced from inside different loop bodies. Avoids duplicating handler logic.
- _Why P4 requires a different expression:_ The handler's behavior depends on which scope triggered it (different error contexts, different available data). You can't test the handler without knowing all its trigger scopes. The handler has hidden coupling to multiple contexts.
- _Alternative:_ Use per-scope error handlers, each with its own dominator scope and input wiring. If handler logic is shared, factor it into a reusable task type that each per-scope handler invokes.
- _Tradeoff:_ More handler nodes (or a shared task type with per-scope handler wrappers). But each handler is testable in its own scope's context. The reusable task type captures the shared logic without coupling scopes.

### Outside the boundary

P4 governs spec-level decomposition. What happens inside tasks is opaque and outside the principle's scope.

**36. Task-internal complexity.** A task that internally has complex logic, multiple sub-steps, or its own error handling. P4 doesn't require decomposing it into multiple nodes. The author chooses the boundary: if the task is working correctly, its internal complexity is its own concern. P4 only applies to the parts the author has chosen to expose in the spec. This is the same boundary framing as P3: decomposing further gives the engine more visibility, but the choice is the author's.

### Patterns ruled out

P4 does not rule out any computational capability. Every computation expressible with cross-scope references is also expressible with boundary declarations. The principle constrains _how parts relate to each other_, not _what they can compute_.

What P4 genuinely prevents is **undeclared cross-scope dependencies**. Concrete example: a loop body node's input wiring references `nodes.fetchData.output.url`, where `fetchData` is in the enclosing scope, not in the loop body. The validator rejects this: `fetchData` is not a body node, and its output is not declared in the loop's input boundary. The fix is to declare `url` as a loop input, wired from `fetchData.output.url` at the enclosing scope level. The body node then references the loop input, not the outer node directly.

This is not a workaround or alternative expression. The cross-scope reference is structurally invalid. The body cannot name nodes outside its scope, so there is no "direct but discouraged" form to compare against. The boundary declaration is the only way to express the dependency.

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs or general graphs (both can be tested in isolation; DAG is simpler but not required by locality alone).
- Whether variables should be schema-validated (locality says "declared boundary"; validation is about correctness, covered by P1).
- The specific boundary mechanism (input/output declarations vs. parameter passing vs. something else).

---

## P5: A reader of the spec can predict engine behavior without knowing engine conventions

Someone reading the spec should be able to predict what the engine will do, without needing to know engine defaults, conventions, or inference rules. The test isn't "is there implicit behavior?" but "would a reader be surprised?"

### Scenarios it ENABLES

**37. No surprise re-entry.** A reader sees `increment -> write` in a loop body. In the cyclic model, this means "go back to write and re-execute." But is that obvious? Or does the reader need to know that back-edges cause re-execution? With `@iterate`, the reader sees an explicit sentinel: "go back to the loop entry." No knowledge of back-edge semantics needed.

**38. No surprise pipeline wiring.** Pipeline mode (omitting explicit data wiring) means "wire the predecessor's output to my input." A reader after a branch merge would need to know the engine's predecessor selection rule. With explicit data wiring, the reader sees exactly which data flows where.

**39. Terminal node behavior is clear.** In the top-level scope, a node without `next` is a terminal - workflow ends. Unsurprising, universal convention. In a loop body, a node without `next` is... what? The reader would need to know the engine's convention (re-enter? exit? error?). This is surprising. Therefore body nodes should have explicit `next`.

**40. Error handling is predictable.** Missing `onError` means "if this node fails, the run fails." This is the unsurprising default - failure propagates. No convention knowledge needed.

### Patterns requiring alternative expression

**41. Implicit loop body re-entry.**

- _Intent:_ A body node without `next` implicitly re-enters the loop at `entry`. Less syntax for simple loop bodies.
- _Why P5 requires a different expression:_ "Missing `next` in a loop body means implicit re-entry at the loop entry" requires knowing the engine's convention. A reader seeing no `next` could reasonably expect exit, error, or re-entry. The behavior is ambiguous without engine knowledge.
- _Alternative:_ Use explicit `next: "@iterate"` to re-enter, `next: "@exit"` to exit. Every body path terminates at a declared sentinel or another body node.
- _Tradeoff:_ More syntax per body node. But the reader never has to guess: the spec says what happens. The DSL can default missing `next` in loop bodies to `@iterate` (a reasonable authoring convention), compiling to the explicit form.

**42. Inferred node types.**

- _Intent:_ Infer node type from field presence. If the node has loop-scoped variables, it's a loop. If it has branches, it's a switch. Less redundancy.
- _Why P5 requires a different expression:_ The reader must know the inference rules: "field X means type Y." Different engines could have different inference rules. The type is not self-describing.
- _Alternative:_ Require an explicit node type discriminant. The node type is visible without knowing inference rules.
- _Tradeoff:_ One extra field per node. But the spec is self-describing: you see the type, not a set of fields you must interpret. The DSL can infer type from syntax (e.g., `loop { ... }` compiles to a loop node type).

### Outside the boundary

P5 governs what a reader can predict from the spec. Some behaviors are universally predictable without being explicit in the spec.

**43. Universally unsurprising defaults.** Missing error handler means failure propagates. Missing transition in the top-level scope means terminal. Missing output declaration on a loop means no output. These are universally understood conventions that don't require engine-specific knowledge. P5 does not require making them explicit, because no reader would be surprised.

### Patterns ruled out

P5 does not rule out any computational capability. Every computation expressible with implicit conventions is also expressible with explicit declarations. The principle constrains _how behavior is communicated_, not _what behavior is possible_.

What P5 genuinely prevents is **surprise**: a spec where a reader who understands the general concepts (graphs, tasks, loops, branches) but doesn't know this specific engine's conventions would mispredict the behavior. With explicit sentinels, required node type discriminants, and required data wiring, the spec says what it does.

### Where predictability does NOT require explicitness

| Case                                            | Predictable without engine knowledge?           | Explicit required?                      |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| Missing `onError` -> run fails                  | Yes - failure propagation is universal          | No                                      |
| Missing `next` in top-level -> terminal         | Yes - "no next step" means done                 | No                                      |
| `maxIterations` default of 1000                 | Debatable - but safety limits are standard      | No (but documenting it is important)    |
| Missing output declaration on loop -> no output | Yes - "nothing declared" means nothing produced | No                                      |
| Missing `next` in loop body -> ???              | No - could mean exit, re-enter, or error        | **Yes - must be explicit**              |
| Pipeline mode -> predecessor output             | No - which predecessor?                         | **Yes - must use explicit data wiring** |

### What this principle does NOT resolve alone

- Whether loop bodies should be DAGs (both back-edges and `@iterate` can be made predictable with documentation; the preference for `@iterate` is stronger under P5 but not absolute).
- Data flow mechanism choices (e.g., how mutations are declared) - multiple approaches are predictable to a reader.
- Schema validation details - a reader doesn't need to know validation happens to predict behavior.

---

## Summary

| #   | Principle                                                   | Status       | Remaining questions                                                                         |
| --- | ----------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| P1  | Data references statically provable on every path           | **Resolved** | None                                                                                        |
| P2  | All data flow traceable through the spec alone              | **Solid**    | Drives cross-iteration state/output declaration necessity but doesn't pick between variants |
| P3  | Spec structure corresponds to computational structure       | **Solid**    | Tiebreaker role: picks loop construct over flat cycles                                      |
| P4  | Each part understood/validated/tested without the whole     | **Solid**    | Doesn't require DAG alone, but DAG + P5 makes strong case                                   |
| P5  | Reader predicts engine behavior without knowing conventions | **Solid**    | Predictability doesn't require explicitness for unsurprising conventions                    |

### Principle independence check

| Pair    | Overlap?                                                                                                                                                                                  | Resolution                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1 + P2 | P1 is about reference validity (will it resolve?). P2 is about traceability (can you follow the chain?). A reference could be valid but untraceable (if the data flow channel is hidden). | Independent.                                                                |
| P2 + P5 | P2 covers data flow traceability. P5 covers behavioral predictability (both control flow and data wiring). P2 asks "can I trace the origin?"; P5 asks "would a reader be surprised?"          | Independent: traceability vs. surprise.                                     |
| P3 + P4 | P3 says structure mirrors computation. P4 says parts are independently understandable. Both push toward a loop construct.                                                                 | Complementary, not redundant. P3 is about the whole; P4 is about the parts. |
| P3 + P5 | P3 says structure is self-describing. P5 says behavior is predictable. A self-describing structure could have surprising behavior (unlikely but possible).                                | Independent.                                                                |
| P1 + P5 | P1 guarantees references resolve. P5 guarantees the reader can predict behavior. P1 is a formal property; P5 is a human-factors property.                                                 | Independent.                                                                |

### Principle conflicts and resolution

The independence check above shows the principles cover distinct concerns, but independence does not mean they never pull in opposite directions. When a design choice satisfies one principle at the cost of another, the document needs a resolution strategy.

**There is no fixed priority ordering.** The principles are not ranked. Each conflict must be evaluated on its own terms, considering what is at stake in the specific scenario. A blanket hierarchy (e.g., "P1 always beats P3") would obscure the tradeoffs rather than clarify them. Instead, the resolution process is:

1. **Identify which principles are in tension** and what each demands in the specific scenario.
2. **Enumerate candidate designs** and assess each against all five principles, not just the two in conflict.
3. **Prefer designs that resolve the tension** (satisfying both competing principles) over designs that sacrifice one. Most conflicts in this document have a "both" option.
4. **When no design satisfies both**, evaluate the specific cost of each tradeoff. What capability, safety, or clarity is lost? The answer depends on the scenario, not on a universal ranking.
5. **Document the tradeoff explicitly** in the scenario analysis, including what was sacrificed and why.

**Observations about typical conflict patterns:**

- **P1 conflicts are often resolvable.** P1 (static provability) is a correctness property: violating it means workflows can fail at runtime. In practice, this makes it hard to justify sacrificing P1. But the resolution is usually not "P1 wins, accept the cost." It's "find a design that satisfies P1 without violating the other principle." Scenarios 5 and 7 both demonstrate this: alternative (c) satisfies P1 without the P3 cost that alternative (a) incurs.
- **P3 is often the tiebreaker, not the loser.** P3's "Relationship to other principles" section describes it as a tiebreaker when other principles are already satisfied. This is accurate, but it does not mean P3 always yields. A design that badly violates structural correspondence (e.g., requiring graph analysis to understand basic workflow shape) may be worse than one that adds moderate verbosity to satisfy P4 or P5.
- **Convergence is common.** Many scenarios show principles reinforcing each other rather than conflicting. P3 and P5 converge on loop constructs (scenario 25). P2 and P4 converge on boundary declarations. When principles converge, the design choice is clear. The interesting cases are the exceptions.

**Known tensions in this document:**

| Scenario | Principles in tension | Candidates | Resolution |
| -------- | --------------------- | ---------- | ---------- |
| P1 #5 | P1 vs. P3 | (a) Passthrough node: satisfies P1, adds structure without computation (P3 cost). (b) Separate paths: satisfies both, duplicates downstream nodes. (c) Optional references: satisfies both, moves conditional logic into the task. | Prefer (c): resolves the tension. The consuming task handles absence, no structural overhead, no duplication. (a) is acceptable when optional references are not available. |
| P1 #7 | P1 vs. P3 | (a) Passthrough/default nodes: satisfies P1, changes semantics. (b) Separate paths: no merge node. (c) Optional references: merge task handles absence. | Prefer (c): the merge task's job is combining data from sources that may not all be present. (a) is acceptable when the "always present with default" semantics are what you want. |
| P3 #25 | (none) | Loop construct satisfies P3, adds verbosity that P5 independently requires. | Convergence, not conflict. Both principles want the same thing. |
| P4 #33 | P4 vs. P3 | Boundary declarations add boilerplate (P3 cost) to achieve composability (P4 benefit). No alternative achieves composability without the boundary declarations. | The boilerplate is the composability. No design resolves the tension, so the question is whether composability justifies the structural overhead. In this case it does: the boundary declarations serve as documentation of external dependencies, which partially satisfies P3 (the structure communicates something real). DSL sugar can reduce the authoring cost. |
