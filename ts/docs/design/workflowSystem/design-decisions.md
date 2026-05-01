# Workflow Spec Design Decisions

Status: Draft (iterating)

This document records design decisions driven by the [design principles](design-principles.md). Each decision references the principle(s) that motivate it. The principles define _what properties the design must have_; this document records _how specific mechanism questions are resolved_ under those principles.

For the principles themselves (definitions, scenarios, boundary analysis), see [design-principles.md](design-principles.md).

---

## Existing design consistency check

The existing [plan.md](plan.md) decisions are mostly consistent with the principles:

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

---

## Resolved: IR shape (flat inputMap, no expressions, simple graph walker)

_Driven by: P1 + P2 + P3 + P5_

[plan.md](plan.md) states an IR principle (P2 "Bytecode"): flat `inputMap`, no expressions, simple graph walker. Each component is a consequence of the design principles, not an independent constraint:

| IR property             | Derived from                                         | Reasoning                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flat `inputMap`**     | P2 (traceability) + P1 (static provability)          | Every reference is a simple path (`nodes.X.output.foo`). Traceable by reading the spec (P2). Statically analyzable for dominator and type checks (P1).                                               |
| **No expressions**      | P2 + P5 + P1                                         | Expressions create computation in the wiring layer that is harder to trace (P2), requires knowing an expression language to predict (P5), and complicates static type/resolution checking (P1).      |
| **Simple graph walker** | P3 (structural correspondence) + P5 (predictability) | Structure is self-describing (`kind` discriminants, LoopNode, sentinels), so the walker doesn't need to infer patterns (P3). Execution follows declared structure with no interpretation rules (P5). |

The IR principle is a design decision, not a foundational principle. If the principles changed, the IR shape would change with them.

---

## Resolved: Error handler dominator scope

_Driven by: P1 (static provability)_

**Decision: (a) - Error handlers share the normal dominator scope.**

`onError` edges are excluded from the dominator computation (they represent exceptional flow, not guaranteed execution). An error handler node's dominator set is determined by its position in the `next`-edge graph. If H is reachable via `onError` from multiple trigger nodes, H can only reference nodes that dominate ALL of those trigger points (intersection of dominator sets).

This is conservative: if it's too restrictive, the author can use separate handler nodes per trigger. It keeps the dominator model simple (one computation, one scope) and avoids path-sensitive analysis.

---

## How principles drive mechanism decisions

Each principle constrains the design space for specific mechanism questions. These tables show what each principle says and doesn't say about open mechanism choices.

### P1 mechanism implications

P1 does not have a standalone mechanism table - its mechanism implications are captured in the resolved error handler scope decision above and the open questions below.

### P2 mechanism implications

| Question                                 | What P2 says                                                                                                                                  | What it doesn't say                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Do we need loopVars?                     | Cross-iteration data must be traceable. Without declared state, the overwrite is invisible.                                                   | Whether they're called "loopVars" or something else, or how they're declared. |
| outputMap on body nodes vs. setVar task? | Both are traceable - the mutation is visible in the spec either way.                                                                          | Choose based on other principles (P5 predictability, IR simplicity).          |
| Deep writes vs. top-level writes?        | Both are traceable - you can follow either path.                                                                                              | Choose based on complexity tradeoff and IR simplicity (plan.md P2 Bytecode).  |
| Pipeline mode?                           | Pipeline mode hides data mapping. At a branch merge, which predecessor's output flows? Not traceable without running the graph. **Violates.** | N/A - clearly excluded.                                                       |
| Cross-scope node references?             | A body node reading `nodes.outerFetch.output.body` directly IS traceable (you can follow the path). But the scope boundary becomes invisible. | Whether to allow it depends on P4 (composability), not P2.                    |

### P3 mechanism implications

| Question                                           | What P3 says                                                                                                                                                                              | What it doesn't say                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Flat cycles vs. LoopNode?                          | LoopNode: the spec structure mirrors the computational pattern. Flat cycles require graph analysis to discover the pattern.                                                               | The exact shape of LoopNode (fields, nesting rules). |
| Should `kind` be required?                         | Yes: the node type is part of the computational structure. Inferring it from field presence means the structure isn't self-describing.                                                    | N/A - clearly required.                              |
| Decision nodes: `next` map vs. separate construct? | A `next` map on a task node is fine: the decision structure (branch labels -> targets) is visible in the spec. A separate `DecisionNode` type would add structure without adding clarity. | N/A.                                                 |

### P4 mechanism implications

| Question                                  | What P4 says                                                                                                                                                                                         | What it doesn't say                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Should loops have explicit boundaries?    | Yes: if the body can be tested in isolation, there must be a declared boundary (inputs in, outputs out).                                                                                             | The exact mechanism (inputMap/outputMap, or something else). |
| Should cross-scope references be allowed? | No: they break isolation. You can't test the body without the outer scope.                                                                                                                           | N/A - clearly excluded.                                      |
| Should mutable state be scoped?           | Yes: if two parts share mutable state, neither can be tested independently.                                                                                                                          | Whether it's per-loop, per-scope, or some other scoping.     |
| Should loop bodies be DAGs?               | **This principle alone doesn't answer this.** A DAG body is easier to test (single-pass). A cyclic body can still be tested in isolation. The preference for DAG comes from the combination with P5. | See "The body cycle question" below.                         |

### P5 mechanism implications

| Question                     | What P5 says                                                                                                                                 | What it doesn't say                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pipeline mode?               | Excluded: unpredictable at merge points.                                                                                                     | N/A.                                                                                   |
| Required `kind`?             | Required: the reader shouldn't infer node type from field presence.                                                                          | N/A.                                                                                   |
| Required `inputMap`?         | Required: the reader should see all data wiring.                                                                                             | N/A.                                                                                   |
| Body node terminal behavior? | Must be explicit (`@exit`, `@iterate`, or `next: "node"`).                                                                                   | Which sentinels to use.                                                                |
| `@iterate` vs. back-edges?   | `@iterate` is more predictable: explicit "re-enter" intent. Back-edges require knowing that pointing to an earlier node causes re-execution. | Whether the DAG model is strictly required (could be a preference, not a requirement). |
| Default `maxIterations`?     | Acceptable: safety limits are unsurprising. But should be documented.                                                                        | N/A.                                                                                   |

---

## Open design question: Optional references

_Driven by: P1 (static provability), with implications for P2-P5. Arises from P1 scenarios 4, 5, and 8._

Optional references would let an `inputMap` entry mark a data source as optional: if the producing node didn't execute on the taken path, the field is absent from the task's input rather than a validation error. The current alternatives (passthrough nodes, duplicate paths) force graph structure that exists only to satisfy the dominator requirement.

**Analysis against each principle:**

| Principle                      | Effect of optional references                                                                                                                                                                                                                                                                                                          | Assessment         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| P1 (static provability)        | The rule evolves from "X dominates Y" to: if X dominates Y, types must match; if X does not dominate Y, the reference must be marked optional and the consumer's schema must accept the field as optional. This is a _richer_ static check, not a weaker one.                                                                          | **Consistent**     |
| P2 (traceability)              | The reference is declared in the spec with its optionality. "This task receives data from cache _when cache runs_" is more directly expressed than a passthrough node that exists only to produce a default.                                                                                                                           | **Consistent**     |
| P3 (structural correspondence) | A passthrough node that exists solely to satisfy a dominator requirement is graph structure that doesn't correspond to computational intent - it's plumbing. An optional reference says what it means: "this data may or may not be available." The conditional handling belongs inside the task because it's the task's domain logic. | **Better aligned** |
| P4 (locality)                  | A node with optional inputs is easier to test in isolation: test it with and without the optional data. A node that requires restructuring the graph to guarantee a predecessor ran is harder to extract.                                                                                                                              | **Better aligned** |
| P5 (predictability)            | Clear rule: "if the referenced node didn't execute, the field is absent." If the task's schema says optional, this is unsurprising. Less surprising than a passthrough node whose purpose requires understanding the dominance constraint it exists to satisfy.                                                                        | **Better aligned** |

**The boundary framing:** Optional references let the author say "the task handles the absent case" instead of forcing that logic into graph structure. This respects the principle that tasks are the right place for domain logic (what to do when data is missing), while the spec is the right place for wiring (where data comes from when present).

**Risk:** If everything can be marked optional, authors take the easy path and push all conditional logic into tasks, reducing the engine's ability to analyze and validate data flow. Mitigation: the validator still enforces type compatibility on the optional field, and the task schema must explicitly declare the field as optional. This is a conscious choice, not a default.

**Mechanism (TBD):** How are optional references marked in the spec? Prefix/suffix convention, separate field, or per-entry metadata? Deferred until the concept is accepted.

---

## Open design question: Data wiring expressiveness

_Driven by: interaction of P1 (static provability) and P3 (structural correspondence)_

The optional references question is one instance of a broader design question: **is the current `inputMap` mechanism expressive enough?**

The current design is a flat `{ fieldName: "dataSourcePath" }` dictionary. The scenarios in design-principles.md reveal several limitations:

- **Optional/conditional references** (P1 scenarios 4, 5, 8): no way to say "use this data if available"
- **Default values**: no way to provide a fallback when a reference doesn't resolve
- **Shape remapping**: no way to transform data between producer and consumer without an intermediate task node
- **Schema relationship**: no formal connection between `inputMap` entries and the consumer task's `inputSchema` (required vs. optional fields, type compatibility)

These limitations force authors to add structural workarounds (passthrough nodes, duplicate paths) that don't correspond to computational intent.

**Which principles drive this?** No new principle is needed. This is the interaction of P1 and P3:

- P1 requires static provability (every reference resolves to a compatible value on every path)
- P3 requires structure to correspond to computation (no plumbing nodes)
- When the wiring mechanism isn't expressive enough to satisfy P1 directly, authors must add plumbing nodes, which violates P3

P3 detects the symptom (passthrough nodes aren't computational). P1 is the root cause (it forces structural workarounds when wiring can't express the intent). The resolution is a mechanism question: make the data wiring layer expressive enough that P1 and P3 don't conflict.

**Design space (TBD):** The wiring redesign should address optional references, default values, schema relationship, and shape remapping as a unified problem. The current flat path dictionary may evolve to richer per-field metadata. This is a mechanism question for the spec design phase, not a principles question.

---

## The body cycle question

_Driven by: all five principles (P1-P5)_

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

## The branching structure question

_Driven by: P1 (dominator analysis), P3 (structural correspondence), P4 (composability)_

The body-cycle question asks how loops should be represented. An analogous question exists for branching: should the spec use free-form DAG branching (current `next` map), structured control flow constructs (IF/SWITCH), or something in between?

### Option A: Free-form DAG (current design)

A task node's `next` map branches to targets. Branches reconverge wherever `next` edges happen to meet. No explicit scope around branch bodies.

```
classify -> next: { positive: "celebrate", negative: "apologize" }
celebrate -> next: "send"
apologize -> next: "send"
send -> ...
```

- Branch targets are visible in the spec.
- Branch _scope_ is invisible: which nodes are "in" the positive branch? You trace the graph.
- Diamond merge problem: `send` can't reference `nodes.celebrate.output.*` or `nodes.apologize.output.*` because neither dominates it.

### Option B: Structured IF/SWITCH constructs

New node kinds (`kind: "if"`, `kind: "switch"`) with explicit branch bodies and declared outputs, analogous to LoopNode.

```json
{
  "kind": "switch",
  "taskType": "classify",
  "branches": {
    "positive": { "nodes": { "celebrate": { ... } } },
    "negative": { "nodes": { "apologize": { ... } } }
  },
  "outputMap": { "message": "branchOutput.message" }
}
```

- Branch scope is explicit: these nodes are in `positive`, those in `negative`.
- The construct owns the merge. Downstream references the construct's output, not branch-internal nodes.
- Dominator analysis is trivial: the construct itself dominates its successor.
- Compositional validation: validate each branch body independently (P4).

### Option C: Free-form DAG + block scopes

Keep the DAG, but allow grouping nodes into scoped blocks with declared inputs and outputs. Not full structured control flow, but a scoping mechanism that provides data-flow boundaries without requiring the branching logic itself to be structured.

```json
{
  "nodes": {
    "classify": { "kind": "task", ... },
    "handlePositive": {
      "kind": "block",
      "inputMap": { "sentiment": "nodes.classify.output.sentiment" },
      "nodes": { "celebrate": { ... }, "reward": { ... } },
      "entry": "celebrate",
      "outputMap": { "message": "nodes.reward.output.message" }
    },
    "handleNegative": {
      "kind": "block",
      "inputMap": { "sentiment": "nodes.classify.output.sentiment" },
      "nodes": { "apologize": { ... } },
      "entry": "apologize",
      "outputMap": { "message": "nodes.apologize.output.message" }
    },
    "send": { "inputMap": { ... } }
  }
}
```

- Blocks provide P4 scoping (testable in isolation) without coupling it to control flow.
- The `next` map still handles branching (free-form DAG for control flow).
- Data flow gets scoping boundaries, control flow stays flexible.
- Blocks could be used for non-branching purposes too (grouping related nodes, sub-workflow extraction).

### How the principles weigh in

| Principle | A: Free-form DAG                                                                                                                            | B: Structured IF/SWITCH                                                                             | C: DAG + block scopes                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**    | Diamond merge forces optional refs or passthrough nodes. Neither branch node dominates the merge.                                           | Construct owns the merge. Downstream refs the construct's output. Dominator trivial.                | Blocks have declared outputs. If both blocks' outputs feed `send` via optional refs or the `next` map routes to separate paths, dominator is manageable.               |
| **P2**    | Traceable, but merge-point data origin requires following multiple paths.                                                                   | Construct declares outputs: "this branch produces X." Cleaner lineage.                              | Block `outputMap` makes data flow across the boundary explicit.                                                                                                        |
| **P3**    | Simple branches (`next: {a, b}`) are self-evident. Multi-node branch bodies are not: you trace the graph to find where branches reconverge. | Branch scope mirrors computational scope. The spec says "these nodes run conditionally as a group." | Block scope mirrors grouping. But the _reason_ for the grouping (conditional execution) is in the `next` map, not the block. Structure and control flow are decoupled. |
| **P4**    | Can't test "the positive branch" without knowing which nodes belong to it.                                                                  | Branch body is a self-contained scope. Testable independently.                                      | Block body is testable independently. Same P4 benefit as B, without coupling to control flow.                                                                          |
| **P5**    | At a merge point, which predecessor's data flows? Requires graph tracing.                                                                   | Construct's `outputMap` makes it explicit.                                                          | Block's `outputMap` makes it explicit within the block. Merge behavior still depends on the DAG structure outside blocks.                                              |

### The key distinction from loops

For loops, the principles clearly favored structured constructs: flat cycles _hide_ the loop pattern (you must analyze the graph to discover it). For branching, the situation is different:

- **Simple branches are already self-evident.** `next: {yes: "A", no: "B"}` reveals the decision. There's no hidden pattern to discover. Adding `kind: "if"` for a single-target branch adds structure without adding clarity.
- **Multi-node branches create hidden scope.** When a branch body is 5 nodes deep and reconverges with another branch, the scope boundary is invisible. This is where P3 says the structure should be explicit.

This suggests the answer may depend on branch complexity:

- **Simple decision (single target per branch):** `next` map is sufficient. P3 is satisfied.
- **Scoped branch (multiple nodes, data flow within):** Structured construct or block scope adds value. P3 and P4 benefit from the explicit boundary.

### Hybrid approach

The three options are not mutually exclusive. A possible design:

1. **`next` map** for simple branching (always available on any task node).
2. **`kind: "block"`** for scoping any group of nodes with declared boundaries (Option C). Useful for branching, sub-workflow extraction, and organizational grouping. Not tied to control flow.
3. **`kind: "if"` / `kind: "switch"`** (Option B) could be DSL-level constructs that compile to blocks + `next` map in the IR. The IR stays simpler (blocks are general-purpose), while the DSL provides control-flow-specific authoring sugar.

This parallels the loop design: the DSL can offer `if/else` syntax that compiles to structured IR, just as free-form loop syntax compiles to LoopNode. The IR question is whether blocks (general-purpose scoping) are sufficient, or whether control-flow-specific constructs (IF/SWITCH) belong in the IR itself.
