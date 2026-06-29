# CFG / DDG separation (decision 0002)

Status: **Adopted (v1).** Folded into [../ir-v0.1.md](../ir-v0.1.md) (§3.2.2).

The IR encodes **two distinct graphs over the same node set**: a
control-flow graph (CFG) from `next`/`cases`/`default`/`onError`/sentinels,
and a data-dependency graph (DDG) from reference objects (`$from`). For
every DDG edge A -> B, A must dominate B in the CFG of B's scope. The
CFG may carry additional `next` edges that no data dependency requires.

---

## 1. The two-graph model

### 1.1 Why two graphs

- **Side-effecting tasks need sequencing without data flow.** "Run the
  migration, then run the readiness check" requires a `next` edge with
  no data payload. Without independent control flow, you'd need a
  synthetic data dependency.
- **The branch node has no data outputs.** A branch is pure control
  flow. Only works if the two graphs are independent concepts.
- **`onError` is control flow.** The handler depends on the error, not
  on the failed task's output. CFG carries "go here on failure"; DDG
  carries `$from: "error"` separately.
- **The engine gets to optimize.** Parallelism analysis uses data
  dependencies as the minimum ordering constraints; the CFG narrows
  what will run when.

### 1.2 Engine execution

- Engine follows the **CFG** to decide which node runs next.
- At each node, engine consults the **DDG** (the node's `inputs`) to
  gather values.
- A `next` edge with no underlying data dependency is treated as
  load-bearing-by-assumption in v1, because tasks declare no side
  effects. Closing this gap is the explicit purpose of the post-v1
  side-effect / capability declaration work.

## 2. Pros and cons

### Pros

1. Side effects can be sequenced without faking data flow.
2. Branches and handlers stay pure (CFG edges with no DDG counterpart).
3. The engine has room to optimize (DDG = minimum ordering).
4. Authors can express intent precisely ("uses A's output" vs "must
   come after A" are different statements).
5. The validator stays small (each pass operates on one graph).
6. Refactoring is local (adding/removing a `next` edge doesn't change
   any node's input wiring).
7. Matches the principles cleanly (P1 lives primarily in the DDG;
   P3/P4/P5 each have control-side and data-side readings).

### Cons

1. **v1 information loss.** Cannot tell deliberate side-effect ordering
   from accidental over-sequencing.
2. Two graphs to keep in sync mentally (mitigated by visualization).
3. CFG-superset-of-DDG-dominance is a non-obvious invariant.

### Tradeoff summary

The two-graph model trades a small comprehension cost for substantial
expressiveness wins. The con list reveals one honest v1 hole:
**side-effect declarations**. The two-graph model is only fully
principled once they exist (post-v1).

## 3. Alternatives considered (summary)

Three alternatives were evaluated against the full use-case inventory:

**Alt 1 - One graph, edges carry data.** Every edge carries a data
payload map. Strong for linear data pipelines; breaks on diamond
merges (per-edge field merging), non-immediate ancestor references
(explicit forwarding or implicit dominator model returns), and loop
state (self-edges). Best for streaming dataflow systems (LabVIEW,
Max/MSP). P3/P4/P5 weaker.

**Alt 2 - One graph, `next` derived from `inputs`.** No `next` field;
CFG computed from DDG as a topological sort. Smallest IR for pure data
pipelines; but no side-effect ordering, branches and loops must be
re-encoded, P3 and P5 severely weaker. Best for build systems (Bazel,
Make, Dask). Wrong for v1.

**Alt 3 - Two graphs + side-effect annotations.** Today's model plus
`effects: [...]` on tasks. Closes the one real v1 gap (unjustified
`next` edges) without revisiting any v1 commitment. Purely additive.
This is the planned post-v1 evolution.

### Verdict

The TypeAgent workflow vision (orchestrating LLM calls, side-effecting
tools, retries, branches, error recovery, suspend/resume) is firmly in
the two-graph camp. The alternatives' strengths (clean concurrency
without effects, smaller IRs for pure pipelines) are not where
TypeAgent workflow value comes from. The one v1 weakness (A9:
unjustified edge detection) is closed by a planned additive change,
not a redesign.

---

## Related: decision 0010 (branch as `WorkflowScope`, loop `continueWhen`)

[Decision 0010](./0010-finish-workflow-scope-unification.md) keeps the
two-graph separation intact. Branch arms become
[`WorkflowScope`](../workflow-scope-proposal.md)s, which makes a
branch DDG-source-eligible when it declares `bind` (the same uniform
rule §3.2 already applies to task, fork, forkMap, and loop). The CFG
shape of a branch is unchanged: arms are sub-scopes with their own
nested CFG, and the branch node itself dispatches to exactly one arm
per execution. Loop termination via `continueWhen` is a DDG
dependency (the loop reads a body-scope value) layered on the same
CFG body shape; it does not change the CFG/DDG separation either.
