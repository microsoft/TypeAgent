# Post-v1: `foreach` loop

Status: **Post-v1 sketch.** Listed in [../ir-v1.md](../ir-v1.md) §2.2.
Motivated by the morning-brief validation scenario (A4 G2: verbose
index/step/bounds pattern for list iteration).

## 1. Motivation

v1's `loop` node iterates via an integer index, explicit state, and
sentinel-driven control flow (`@iterate` / `@exit`). Iterating over a
list requires the author (or DSL lowering) to maintain an index counter,
extract each element with `list.elementAt`, step with `int.add`, check
bounds with `list.length` + `int.lessThan`, and convert the boolean to a
discriminant label with `bool.toLabel`. A4's repo loop demonstrates the
cost: 4 standard-library task nodes and 1 branch node exist solely to
iterate a list.

A `foreach` construct would replace that machinery with a single
declaration: "for each element of this list, run this body."

## 2. Why this is not just DSL sugar

The §1.3.1 (minimization) test asks: does the new concept add a
behavioral rule the existing concepts do not cover? A `foreach` does:

- **Termination on list exhaustion, not on a counter predicate.** The
  v1 loop terminates when a branch routes to `@exit`. A foreach
  terminates when the list is exhausted. These are different behavioral
  rules: the engine knows the iteration count up front (it is
  `list.length`), which enables pre-allocation, progress reporting,
  and parallelization that a counter-predicate loop cannot offer
  without whole-body analysis.
- **No user-managed index state.** The loop body receives the current
  element directly. There is no `i` in `state`, no `list.elementAt`
  node, no `int.add` node. The engine manages the iteration variable
  internally.
- **Element type is statically known.** If the input list has schema
  `{ type: "array", items: { type: "string" } }`, the body's element
  input is `{ type: "string" }`. The v1 workaround (`list.elementAt`
  returns `{ element: any }`) loses this type information.

These three rules are genuinely new. A foreach is not sugar for the
existing loop + counter pattern; it is a narrower, more analyzable
construct.

## 3. Sketch

```jsonc
{
  "kind": "foreach",
  "collection": { "$from": "input", "name": "repos" },
  "collectionSchema": {
    "type": "array",
    "items": { "type": "string" },
  },
  "elementName": "repo", // bound in body scope as $from: "element"
  "body": {
    "entry": "fetchRepo",
    "nodes": {
      // ... body nodes reference { "$from": "element", "name": "repo" }
    },
  },
  "accumulator": {
    // optional: how to collect body outputs across iterations
    "name": "sections",
    "schema": { "type": "array", "items": { "$ref": "#/types/Section" } },
    "initial": [],
    "append": { "$from": "scope", "name": "newSection" },
  },
  "output": { "$from": "accumulator", "name": "sections" },
  "outputSchema": { "type": "array", "items": { "$ref": "#/types/Section" } },
  "maxIterations": 1000,
  "next": "compose",
  "bind": "repoSections",
}
```

### 3.1 Open questions

- **`$from: "element"` vs. injecting into `input`.** Should the
  current element be a new namespace (`element`) or folded into the
  body's `input`? A new namespace is cleaner (no collision with
  loop-level inputs) but adds a concept.
- **Accumulator model.** The sketch uses an `append`-style accumulator.
  Alternatives: body returns a value and the engine collects into an
  array (simpler but less flexible); or body writes to `state` as in
  v1 (no new concept but loses the foreach benefit).
- **Parallelizability.** If foreach iterations are independent (no
  accumulator dependency across iterations), the engine could run them
  in parallel. This interacts with the post-v1 parallelism work.
- **Nested foreach.** Does foreach compose with itself? With v1's
  `loop`? The scope contract (§2 of block-scope.md) should extend to
  cover foreach.

## 4. What it would replace in A4

A4's repo loop (lines 230-510 of the IR, ~280 lines) would collapse
to ~40 lines: the foreach node plus the body nodes (`fetchRepo`,
`renderRepo`, `repoUnavailable`, `appendSection`). The 4
standard-library task nodes (`stepIndex`, `computeLength`,
`compareIndex`, `labelDone`) and the `checkDone` branch are
eliminated entirely. The `pickRepo` node is replaced by the foreach's
element binding.

Node count: 10 body nodes -> 4 body nodes. Standard-library tasks
needed: 1 (`list.append` for the accumulator, if not built into the
foreach). Net reduction: 6 nodes, 5 standard-library task
dependencies.
