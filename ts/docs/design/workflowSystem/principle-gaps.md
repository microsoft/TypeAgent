# Principle Gap Analysis

Status: Exploring

This document examines whether the five design principles (P1-P5) produce good outcomes in areas adjacent to spec design. For each area, the question is: does a spec satisfying P1-P5 produce a bad outcome here, and if so, is it a spec design concern or does it belong to a different design?

See [design-principles.md](design-principles.md) for the principles themselves.

---

## What P1-P5 govern and what they don't

P1-P5 govern how nodes relate to each other through the spec: data flow, structural correspondence, composability, predictability. They do not govern:

- **Engine execution policy** - how the engine runs a valid spec (batching, validation strictness, scheduling). This is engine configuration, completely outside the spec.
- **Task boundary metadata** - optional declarations about what a task does beyond "typed input in, typed output out" (side-effect annotations, progress reporting, idempotency markers). These are additive fields on task declarations that don't affect how nodes connect.

Both categories are additive: the spec schema should be open for extension, but no spec design principle is needed. If task boundary metadata grows complex enough, it may warrant its own design doc ("task contract extensions"), but that's a mechanism design with different concerns than P1-P5.

### Items that are not spec design concerns

| Area                          | Category                             | Resolution                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decomposition overhead        | Engine execution policy              | The principles say decomposition must be sound, not "decompose more." Engine flags to skip validation or batch trivial nodes are execution policy.                                                                                                              |
| Intermediate state visibility | Task boundary metadata               | Tasks can emit progress/events that the engine captures for observability, but this data isn't routed through workflow data flow. Same category as observability data (design-principles.md scenario 18). Optional capability declaration on the task boundary. |
| Replay/checkpoint             | Task boundary metadata + engine      | Side-effect and idempotency declarations are optional task metadata. Checkpoint persistence is engine-level. P2+P3 provide the typed, serializable structure that makes both feasible. The spec schema just needs to allow adding these fields later.           |
| Loop iteration identity       | Engine mechanism                     | Engine already tracks iteration count for maxIterations. Exposing it to the spec is a mechanism addition consistent with P2.                                                                                                                                    |
| Error diagnostic constraints  | Spec mechanism (optional references) | Resolved by the optional references mechanism already tracked in [design-decisions.md](design-decisions.md). Not a principle gap.                                                                                                                               |

---

## Spec design concerns

### Parallel iteration is invisible

P3 requires loops to be explicit loop constructs. But a loop with independent iterations (map/forEach over a list) looks structurally identical to a loop with cross-iteration dependencies (iterative refinement). Both are LoopNodes.

The engine must analyze loopVar usage to determine if iterations can run in parallel. The spec structure doesn't distinguish "parallel-safe" from "sequential" - which arguably violates the spirit of P3 (the computational pattern isn't visible in the structure). A "map" pattern is fundamentally different from a "reduce" pattern, but the spec doesn't reveal which one it is.

**Question:** Should this be a structural distinction (e.g., a MapNode vs. LoopNode), or is it sufficient for the engine to infer parallelizability from the absence of cross-iteration state?

- If inferred: the engine analyzes loopVars. No cross-iteration state = parallel-safe. This is analyzable from the spec, but requires inference rather than declaration. Tension with P3 and P5.
- If structural: the author declares intent ("this is a map"). The engine trusts the declaration and validates it (no cross-iteration state in a MapNode). Consistent with P3 (structure reveals pattern) and P5 (no inference needed).
- Counterargument: inference from loopVars is simple and deterministic. A reader can also do it. Is this actually surprising (P5) or just unstated?

**Deferred from v1.** If added later, P1-P5 are sufficient to drive the design:

| Principle | Applies to MapNode? | How                                                              |
| --------- | ------------------- | ---------------------------------------------------------------- |
| P1        | Yes                 | Each iteration's data references validated the same as loop body |
| P2        | Yes                 | No cross-iteration state = no hidden data flow                   |
| P3        | **Driver**          | MapNode vs. LoopNode is the structural distinction P3 demands    |
| P4        | Yes                 | Each iteration independently testable                            |
| P5        | Yes                 | Reader sees "MapNode" and knows iterations are independent       |

P3 is what would drive the decision to add MapNode rather than inferring parallelizability. No new principle needed.

---

## Deployment and Evolution

### No incremental migration

If a task's output schema changes, P1 catches the incompatibility at validation time. But the only resolution is to update all downstream consumers simultaneously. There's no mechanism for expressing schema evolution, adapter nodes, or version negotiation.

You deploy the whole spec atomically or not at all.

**Question:** Is incremental migration a spec concern?

- For single-spec workflows: probably not. The spec is the unit of deployment. Atomic updates are standard.
- For sub-workflow composition (future): becomes critical. If workflow A calls sub-workflow B, and B's interface changes, A needs to handle the version mismatch. The sub-workflow boundary is exactly where versioning matters.
- Assessment: deferred until sub-workflow composition. May need a principle or design constraint at that point.

### No safe-change analysis

Adding a node, changing a branch, modifying a schema: is this change backward-compatible with running instances? The principles say nothing about what changes are safe. P2's impact analysis tells you what's affected, but not whether the change breaks in-flight executions.

**Question:** Is this a spec concern or an operational concern?

- Structural diff (what changed between v1 and v2) is analyzable from the spec. P2 and P3 provide the structure for this.
- Whether a running instance can survive the change depends on runtime state (which node is it currently executing?). This is operational.
- Assessment: the principles enable the analysis. The decision framework is operational.

### No spec identity across versions

If you restructure a workflow (rename nodes, split a task into two), there's no concept of correspondence between v1 and v2. For runtime migration (pause on v1, resume on v2), you'd need a mapping between old and new nodes.

**Question:** Is this a spec concern?

- Migration mapping is inherently external to either spec version. It's a separate artifact.
- The principles ensure each version is internally consistent. Cross-version consistency is a different problem.
- Assessment: not a principle gap. Migration tooling, not spec design.

### P4 composability is validation-only

P4 says parts can be validated and tested independently. But it doesn't say parts can be deployed or versioned independently. Two loops in the same workflow can't be updated separately.

**Question:** Should composability extend to deployment?

- This is the sub-workflow question. Sub-workflows would give deployment boundaries. Within a single workflow, the spec is atomic.
- P4's boundary declarations (inputs, outputs) are the foundation for deployment boundaries. If sub-workflows are added, P4 already provides the interface contract.
- Assessment: P4 is positioned correctly. Sub-workflow composition extends it to deployment.

---

## Summary

| Area                          | Spec design concern?        | Status       | Resolution                                                                   |
| ----------------------------- | --------------------------- | ------------ | ---------------------------------------------------------------------------- |
| Parallel iteration visibility | Yes                         | **Deferred** | P3 drives MapNode distinction. P1-P5 sufficient when added.                  |
| Decomposition overhead        | No (engine policy)          | Resolved     | Author chooses granularity. Engine optimizes execution.                      |
| Intermediate state visibility | No (task metadata)          | Resolved     | Optional task capability declaration. Not workflow data flow.                |
| Replay/checkpoint             | No (task metadata + engine) | Resolved     | Side-effect/idempotency declarations are additive. Engine persists state.    |
| Loop iteration identity       | No (engine mechanism)       | Resolved     | Engine exposes iteration count. Consistent with P2.                          |
| Error diagnostic constraints  | Yes (mechanism)             | Resolved     | Optional references mechanism in [design-decisions.md](design-decisions.md). |
| Incremental migration         | Yes                         | **Deferred** | Becomes relevant with sub-workflow composition.                              |
| Safe-change analysis          | No (operational)            | Resolved     | Principles enable structural diff. Runtime survival is operational.          |
| Spec identity across versions | No (tooling)                | Resolved     | Migration mapping is external tooling.                                       |
| Composability for deployment  | Yes                         | **Deferred** | Sub-workflow composition extends P4.                                         |

### Open questions

1. **Parallel iteration:** Deferred from v1. When added, P3 drives the MapNode decision. Validate that P1-P5 are sufficient (no new principle needed).
2. **Sub-workflow evolution:** When sub-workflows are added, does P4's boundary contract need strengthening for versioning? Or does the existing input/output boundary suffice?
3. **Task contract extensions:** Side-effect annotations, idempotency markers, progress declarations are all additive task boundary metadata. If these grow complex, they may warrant a separate design doc with its own concerns distinct from P1-P5.

---

## v1 scope: deployment and evolution deferred

Deployment and evolution are deferred from v1. This section records the rationale and verifies that v1 design decisions don't block future solutions.

### User scenarios and v1 impact

| Scenario                  | Description                                                                     | v1 impact  | Rationale                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema change during dev  | Developer changes a task's output schema, fixes downstream consumers, redeploys | None       | Atomic updates are natural during development                                                                                                                                                |
| Long-running interruption | Infrastructure restart mid-execution of a multi-hour workflow                   | Low-Medium | Engine can implement checkpoint/resume independently. P2+P3 provide enough structure (data traceability, node identity). Painful for multi-hour workflows but solvable without spec changes. |
| Bug fix to live workflow  | Fix a task bug while instances are running on the old spec                      | Low        | v1 is single-user/development. No concurrent versions.                                                                                                                                       |
| Composition evolution     | Sub-workflow B's interface changes, caller A needs updating                     | None       | Sub-workflows aren't v1                                                                                                                                                                      |
| Loop state durability     | 50-iteration loop fails on iteration 47, all accumulated loopVar state lost     | Medium     | Core use case pain. But engine can persist loopVars without spec support - all state is JSON Schema-typed and serializable.                                                                  |

### Forward compatibility check

The question: will v1 design decisions block adding deployment/evolution support later?

| v1 decision area                     | Additive later? | Risk   | Notes                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec version field                   | Yes             | None   | Adding a `version` field later is trivially additive                                                                                                                                                                                                                                                        |
| Checkpoint/resume                    | Yes             | None   | Engine can persist node outputs and loopVars without spec changes. Everything is typed and serializable.                                                                                                                                                                                                    |
| Side-effect/idempotency declarations | Yes             | None   | Optional fields on task declarations. No existing spec would break.                                                                                                                                                                                                                                         |
| MapNode                              | Yes             | None   | New node type. Existing LoopNodes remain valid.                                                                                                                                                                                                                                                             |
| Scope boundary mechanism             | **Verify**      | Low    | Loop boundaries must generalize to sub-workflows. Current design (declared inputs + declared outputs + loop-specific extensions) is clean: sub-workflows would be "inputs + outputs" without loopVars/sentinels/maxIterations. Core isolation model (body can't reference outer nodes) applies identically. |
| Node identity                        | **Decide now**  | Medium | See [design-decisions.md open question: node identity](design-decisions.md).                                                                                                                                                                                                                                |

### Node identity risk

Nodes are identified by name (string key in the `nodes` map). If the engine builds on "node name = stable identity" for checkpoint keys, metrics, or log correlation, renaming a node in a future spec version breaks the correspondence. The engine's checkpoint would say "node `fetchData` completed" but the updated spec renamed it to `getData`.

Adding a separate stable `id` field later is technically additive, but if the engine already persists checkpoints keyed by node name, migrating to `id`-based keys is messy.

**v1 decision needed:** Are node names stable identifiers? Even a brief recorded decision ("names are IDs for v1, we'll add stable IDs when we add versioning") prevents accidental assumptions from hardening into unmigrateable conventions. See [design-decisions.md](design-decisions.md).

### Drives vs. permits

The principles' relationship to deployment/evolution is "permits, not drives":

| Capability              | Drives? | Permits?     | Why                                                                    |
| ----------------------- | ------- | ------------ | ---------------------------------------------------------------------- |
| Checkpoint/resume       | No      | Yes          | P2+P3 provide the structure that enables it, but don't require it      |
| Spec versioning         | No      | Yes          | Nothing prevents adding it; nothing pushes toward it                   |
| Durability of loopVars  | No      | Yes          | P2 guarantees traceability, not durability                             |
| Sub-workflow versioning | No      | Yes (future) | P4's boundary contract is the foundation, but doesn't address versions |

A design team following only P1-P5 would produce a correct, traceable, structured, composable, predictable spec - that is also impossible to checkpoint, resume, or evolve. For v1, this is acceptable because: (a) v1 workflows are short-lived and single-user, (b) the engine can add persistence independently, and (c) the v1 design decisions are verified to not block future solutions.
