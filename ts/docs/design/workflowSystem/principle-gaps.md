# Principle Gap Analysis

Status: Exploring

This document examines whether the five design principles (P1-P5) produce good outcomes in areas adjacent to spec design. Each area lists concrete scenarios where a spec satisfying all five principles still produces a bad outcome.

See [design-principles.md](design-principles.md) for the principles themselves.

---

## Runtime Performance

### Parallel iteration is invisible

P3 requires loops to be explicit loop constructs. But a loop with independent iterations (map/forEach over a list) looks structurally identical to a loop with cross-iteration dependencies (iterative refinement). Both are LoopNodes.

The engine must analyze loopVar usage to determine if iterations can run in parallel. The spec structure doesn't distinguish "parallel-safe" from "sequential" - which arguably violates the spirit of P3 (the computational pattern isn't visible in the structure). A "map" pattern is fundamentally different from a "reduce" pattern, but the spec doesn't reveal which one it is.

**Question:** Should this be a structural distinction (e.g., a MapNode vs. LoopNode), or is it sufficient for the engine to infer parallelizability from the absence of cross-iteration state?

- If inferred: the engine analyzes loopVars. No cross-iteration state = parallel-safe. This is analyzable from the spec, but requires inference rather than declaration. Tension with P3 and P5.
- If structural: the author declares intent ("this is a map"). The engine trusts the declaration and validates it (no cross-iteration state in a MapNode). Consistent with P3 (structure reveals pattern) and P5 (no inference needed).
- Counterargument: inference from loopVars is simple and deterministic. A reader can also do it. Is this actually surprising (P5) or just unstated?

### Deferred data consumption

P1 requires dominator-based ordering: if B references A's output, A must complete before B starts. But what if B could start independent work immediately and only needs A's output later?

Example: B does 5 minutes of independent computation, then merges with A's result at the end. The principles force B to wait for A before starting.

**Question:** Is this a spec-level concern or an engine optimization?

- Engine-level: the engine could analyze B's task to determine which inputs are needed immediately vs. deferred. But task internals are opaque (boundary framing).
- Spec-level: B could be decomposed into B1 (independent work) and B2 (merge with A). This satisfies the principles and enables parallelism. But it forces decomposition for performance reasons, not structural ones.
- Assessment: probably engine-level. The principles don't prevent efficient execution; they just don't actively enable this specific optimization. The decomposition workaround is always available.

### Decomposition overhead

The principles reward decomposition (more nodes = more engine visibility). Nothing prevents an author from creating hundreds of trivial nodes. Each node crossing means scheduling overhead, data marshaling, schema validation.

**Question:** Is this a principle concern?

- Probably not. The principles don't say "decompose more." They say the decomposition must be sound. The choice of granularity is the author's. Performance consequences of over-decomposition are engine-level (can the engine batch trivial nodes?) and authoring-level (DSL patterns that prevent excessive decomposition).

---

## Debugging and Observability

### No intermediate state visibility

A task is a black box (by design). If a task runs for 10 minutes, the spec provides no way to observe progress. You get "nodeStarted" and "nodeCompleted" but nothing between. For long-running LLM tasks, this is a real debugging gap.

The principles explicitly exclude task internals, so there's no pressure to support progress reporting.

**Question:** Should the boundary contract include progress/streaming capabilities?

- This connects to the boundary expansion discussion in design-principles.md ("the boundary is not fixed"). A progress declaration would extend what tasks expose without changing the principles.
- Not a principle gap - it's a boundary expansion opportunity.

### No replay/checkpoint semantics

P2+P3 give the engine enough structural and data-flow information to potentially support replay from a checkpoint. But nothing in the principles requires the spec to preserve enough information for deterministic replay.

If a task has side effects (database writes), replaying from a checkpoint could produce different results. The principles don't address idempotency, so a structurally perfect spec could be impossible to safely resume.

**Question:** Is this a spec concern or a runtime concern?

- Idempotency is a task-level property (can this task be safely re-executed?). The boundary expansion path (side-effect annotations, idempotency markers) would surface this.
- Checkpoint semantics depend on what the engine persists between nodes. The spec structure (P3) enables this, but the mechanism is engine-level.
- Assessment: boundary expansion, not a principle gap.

### Loop iteration identity

The spec has cross-iteration state (loopVars) but no concept of iteration index. When debugging "the loop failed on the 7th iteration," the spec has no structural way to identify which iteration.

**Question:** Is this a spec concern?

- The engine tracks iteration count for maxIterations enforcement. Exposing it to the spec (as a built-in variable or context property) is a mechanism choice.
- Not a principle gap - it's a mechanism addition that's consistent with P2 (the iteration index becomes a declared data origin).

### Error diagnostic data is constrained

P1 restricts error handler references to dominator scope. Scenario 6's resolution (wire diagnostic data through C's input) adds fields that exist only for debugging, not computation. The principles treat diagnostic data the same as computational data.

**Question:** Should error handlers have a richer data scope?

- Relaxing P1 for error handlers (allowing references to non-dominator siblings) would mean error handlers can access data that may not exist at runtime. The handler would need to handle absence - similar to optional references.
- This connects to the optional references design question. If optional references exist, error handlers could use them to access sibling data that may or may not have been produced.
- Assessment: resolved by optional references mechanism, not a principle gap.

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

| Area                          | Gap?         | Resolution path                                                                                        |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| Parallel iteration visibility | **Possible** | Structural distinction (MapNode vs. LoopNode) or validate that inference from loopVars satisfies P3+P5 |
| Deferred data consumption     | No           | Engine optimization or author decomposition                                                            |
| Decomposition overhead        | No           | Author responsibility, engine optimization                                                             |
| Intermediate state visibility | No           | Boundary expansion (progress declarations)                                                             |
| Replay/checkpoint             | No           | Boundary expansion (idempotency markers)                                                               |
| Loop iteration identity       | No           | Mechanism addition, consistent with existing principles                                                |
| Error diagnostic constraints  | No           | Resolved by optional references mechanism                                                              |
| Incremental migration         | **Deferred** | Becomes relevant with sub-workflow composition                                                         |
| Safe-change analysis          | No           | Principles enable analysis; decision framework is operational                                          |
| Spec identity across versions | No           | Migration tooling, not spec design                                                                     |
| Composability for deployment  | **Deferred** | Sub-workflow composition extends P4                                                                    |

### Open questions for further exploration

1. **Parallel iteration:** Should the spec structurally distinguish map from reduce? Or is absence-of-loopVars sufficient? Does inference violate P3/P5, or is it simple enough to be unsurprising?
2. **Sub-workflow evolution:** When sub-workflows are added, does P4's boundary contract need strengthening for versioning? Or does the existing input/output boundary suffice?
3. **Boundary expansion priorities:** Side-effect annotations, idempotency markers, progress declarations - which boundary expansions are most valuable, and do any of them need to be principles rather than mechanism additions?
