# Principle Gap Analysis

Status: Exploring

This document examines whether the five design principles (P1-P5) produce good outcomes in areas adjacent to IR design. For each area, the question is: does an IR satisfying P1-P5 produce a bad outcome here, and if so, is it an IR design concern or does it belong to a different design?

See [design-principles.md](design-principles.md) for the principles themselves.

---

## What P1-P5 govern and what they don't

P1-P5 govern how nodes relate to each other through the IR: data flow, structural correspondence, composability, predictability. They do not govern:

- **Engine execution policy** - how the engine runs a valid IR (batching, validation strictness, scheduling). This is engine configuration, completely outside the IR.
- **Task boundary metadata** - optional declarations about what a task does beyond "typed input in, typed output out" (side-effect annotations, progress reporting, idempotency markers). These are additive fields on task declarations that don't affect how nodes connect.

Both categories are additive: the IR schema should be open for extension, but no IR design principle is needed. If task boundary metadata grows complex enough, it may warrant its own design doc ("task contract extensions"), but that's a mechanism design with different concerns than P1-P5.

### Items that are not IR design concerns

| Area                          | Category                           | Resolution                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decomposition overhead        | Engine execution policy            | The principles say decomposition must be sound, not "decompose more." Engine flags to skip validation or batch trivial nodes are execution policy.                                                                                                              |
| Intermediate state visibility | Task boundary metadata             | Tasks can emit progress/events that the engine captures for observability, but this data isn't routed through workflow data flow. Same category as observability data (design-principles.md scenario 18). Optional capability declaration on the task boundary. |
| Replay/checkpoint             | Task boundary metadata + engine    | Side-effect and idempotency declarations are optional task metadata. Checkpoint persistence is engine-level. P2+P3 provide the typed, serializable structure that makes both feasible. The IR schema just needs to allow adding these fields later.             |
| Loop iteration identity       | Engine mechanism                   | Engine already tracks iteration count for maxIterations. Exposing it to the IR is a mechanism addition consistent with P2.                                                                                                                                      |
| Error diagnostic constraints  | IR mechanism (optional references) | Resolved by the optional references mechanism (see [IR §3.4](../ir/ir-v0.1.md)). Not a principle gap.                                                                                                                                                           |

---

## IR design concerns

### Parallel iteration is invisible

P3 requires loops to be explicit loop constructs. But a loop with independent iterations (map/forEach over a list) looks structurally identical to a loop with cross-iteration dependencies (iterative refinement). Both are LoopNodes.

The engine must analyze loopVar usage to determine if iterations can run in parallel. The IR structure doesn't distinguish "parallel-safe" from "sequential" - which arguably violates the spirit of P3 (the computational pattern isn't visible in the structure). A "map" pattern is fundamentally different from a "reduce" pattern, but the IR doesn't reveal which one it is.

**Question:** Should this be a structural distinction (e.g., a MapNode vs. LoopNode), or is it sufficient for the engine to infer parallelizability from the absence of cross-iteration state?

- If inferred: the engine analyzes loopVars. No cross-iteration state = parallel-safe. This is analyzable from the IR, but requires inference rather than declaration. Tension with P3 and P5.
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

### Intra-scope name visibility (data hiding within a scope)

**Status:** Resolved. The decision (hide-by-default `bind` switch) was originally reached by analysis and folded into the IR at §3.2.1 / §3.3 / §8.15. The gap that allowed it to be analysis-driven rather than principle-driven has since been closed by sharpening P3, P4, and P5 to be bi-axial (see [design-principles.md](design-principles.md)). Recorded here as the case study that motivated the sharpening.

**The original gap.** Should a node's output be addressable by other nodes by default, or only when the author explicitly publishes it? Walking the principles **as originally written** against this question:

| Principle (original)               | Drove a default? | Notes                                                                                                                                           |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 (static provability)            | No               | Both expose-by-default and hide-by-default are statically checkable. The validator just gets one less name to look up under hide-by-default.    |
| P2 (data flow traceable)           | No               | Both designs trace. Implicit naming is even more trivially traceable; hide-by-default doesn't help here.                                        |
| P3 (structure mirrors computation) | Weakly           | P3's scenarios were framed around control-flow shapes (loop, branch). The data-side analog ("publication is structural") was latent.            |
| P4 (parts without the whole)       | Weakly           | P4 was framed around _cross-scope_ boundaries. The intra-scope analog ("a node declares its contribution to the scope's namespace") was latent. |
| P5 (predict engine behavior)       | Weakly           | P5's scenarios were control-flow surprises. The data-lifetime analog ("reader can predict which values stay live") was latent.                  |

All five permitted both designs. None drove the choice. Hide-by-default was reached by analysis ([cfg-ddg-separation](../ir/decisions/0002-cfg-ddg-separation.md), [bound-outputs](../ir/decisions/0001-bound-outputs.md)) and only afterwards mapped back to weak readings of P3/P4/P5.

**Why this was a principle gap, not just an unstated decision.** The principles, as originally written, were **control-flow-biased**: P3, P4, and P5 each had rich scenario sets for control flow and scope boundaries, but their data-side analogs were latent. The same pattern (a refactor that silently expands a node's contract; a value whose liveness the reader cannot predict; a scope whose namespace grows by accident) would not have surfaced from a P1-P5 walkthrough.

**Sharpening applied.** P3, P4, and P5 have been updated to state both axes explicitly:

- **P3** now states correspondence on three axes: control-flow shape, data publication, and representation-surface (scenario 27a covers implicit publication; scenarios 27b and 27c cover surface-form/rule bijection and reservation-surface collision respectively).
- **P4** now states the boundary contract has both a control side and a data side, including intra-scope namespace contribution (scenario 35a covers refactors that silently expand a scope's contract).
- **P5** now states predictability covers both "what runs when" and "what stays live" (scenario 42a covers implicit value lifetime).

With the sharpening in place, the bound-outputs decision is now driven by the principles directly: P3 (publication is structural), P4 (intra-scope contribution is part of the boundary), P5 (lifetime is locally predictable) all converge on hide-by-default.

**Resolution chosen.** Hide-by-default with explicit `bind` to share, plus SSA-style phi merge for shared bind names on mutually exclusive paths. See IR §8.15 for the design block and [bound-outputs](../ir/decisions/0001-bound-outputs.md) for the K1-K12 analysis.

**Lesson.** When a decision converges from "weak readings" of multiple principles, that's a signal the principles are missing an axis. The fix is to sharpen the principles, not to add a new one.

**Related diagnostic (variance lens, IR §1.3 / §10).** The same shape "a single label whose semantics depend on context = two concepts wearing one name" generalizes the bound-outputs lesson: implicit publication makes the node id carry both CFG identity and DDG name (one label, two rules). The variance lens is the per-decision form of the principle-gap diagnostic.

---

### IR/task contract drift (P1's external-contract axis)

**Status:** Resolved. The decision (registry-gated static drift check between each task node's schemas and the registered task's contract) was reached during the [task-schema-source decision](../ir/decisions/0003-task-schema-source.md) and folded into the IR at §4.1 pass 3, §5.2, and §8.16. The gap that allowed bare Option 1 (IR-authoritative, no static drift check) to sail through the original cleanroom design has since been closed by sharpening P1 to be bi-axial (see [design-principles.md](design-principles.md)). Recorded here as the second case study of the same shape as bound-outputs.

**The original gap.** A task node carries `inputSchema` / `outputSchema` and names a registered task implementation that has its own contract. Should the validator compare the two, and if so when? Walking the principles **as originally written** against this question:

| Principle (original)                | Drove a check? | Notes                                                                                                                                                                                                                          |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 (statically provable references) | No             | P1 was framed around _node-to-node_ references (producer dominates consumer; producer's type is compatible with consumer's). The IR/task seam is not a node-to-node reference, so a literal reading of P1 left it un-governed. |
| P2 (data flow traceable)            | No             | Both schemas already lived in the IR; tracing was unaffected by whether the seam was checked.                                                                                                                                  |
| P3 (structure mirrors computation)  | No             | Drift detection has no structural analog.                                                                                                                                                                                      |
| P4 (parts without the whole)        | Weakly         | A task node is a "part"; if its contract is wrong, the part is wrong. But P4 was about _validation in isolation_ - the check itself was implicit.                                                                              |
| P5 (predict engine behavior)        | No             | A reader of a task node sees the schema; whether the engine separately compares it to the implementation does not change what the reader predicts the engine will do.                                                          |

P1's spirit ("prove what can be proven before runtime") absolutely covered the seam, but P1's letter, framed entirely around intra-IR references, did not. The cleanroom design adopted bare Option 1 (no static drift check) without anyone noticing that a checkable boundary was being deferred to runtime.

**Why this was a principle gap, not just an unstated decision.** The original P1 was **intra-IR-biased**: every scenario was a node-to-node reference. The IR describes other type-mediated boundaries (its own caller's contract, the task implementation's contract, future capability declarations), but the principle did not extend to them. The same pattern (a typed boundary the IR describes that the validator could check but does not) would not have surfaced from a P1-P5 walkthrough as long as the boundary was not a node-to-node reference.

**Sharpening applied.** P1 has been restated to be bi-axial:

- **Intra-IR axis (data references):** the existing dominator + compatibility model, unchanged.
- **External-contract axis (boundary seams):** wherever the IR describes the contract of an external entity (registered task, workflow caller, future external systems), the validator must compare the IR's description against the entity's contract whenever the contract is available, using the same compatibility relation in the appropriate direction. When unavailable, the check defers to the runtime boundary and the gap is documented.

With the sharpening in place, the IR/task drift check is now driven by P1 directly, not by a one-off engineering judgement.

**Resolution chosen.** The registered task's contract is the authoritative envelope; each task node's `inputSchema`/`outputSchema` is either a verbatim restatement of that contract or a narrowing of it, and never a contradiction. The validator enforces the rule via the §4.2 subtype relation in both directions (IR input ⊆ task input; task output ⊆ IR output), gated on registry availability. See [decisions/0003-task-schema-source.md](../ir/decisions/0003-task-schema-source.md) for the K1-K4 option analysis (Option 1 vs. 1' vs. 2 vs. 3) and the principle scorecard.

**Lesson (reinforces the bound-outputs lesson).** Two principle sharpenings now follow the same pattern: a decision converges by analysis without a clean principle drive, and the diagnosis is that a principle's scope was framed too narrowly (control-flow-biased in the bound-outputs case; intra-IR-biased here). The pattern is worth watching for in future decisions: when a principle "almost" applies, that's the signal to re-examine its scope rather than to file the decision under engineering judgement.

**Related diagnostic (variance lens, IR §1.3 / §10).** Same shape: bare Option 1 would have let `inputSchema` mean "authoritative contract" in some IRs and "check elsewhere" in others - one label, context-dependent rule, two concepts wearing one name. The variance lens catches this at decision time; this case study shows how the same shape can also surface as a principle gap.

---

### Representation-surface correspondence (P3's third axis)

**Status:** Resolved. P3 has been sharpened to add a third correspondence axis: **representation-surface correspondence** (scenarios 27b and 27c). The §1.3.2 uniformity / variance clause and the §10 variance lens now derive from this axis of P3 rather than standing as free-floating style choices.

**The original gap.** P3 stated correspondence on two axes: control-flow (loops are loops) and data-publication (shared values are declared). The variance test (count behavioral rules, count surface forms, check they match) was applied as a style choice (IR §1.3) and a reviewer lens (§10), but it was not grounded in a principle. It worked well in practice (it drove the bound-outputs decision, the SSA decision, and the sugar removal), but when decision 0007 asked "should we reserve a `$`-prefix and add `$literal`?", the answer depended on whether the variance clause was weighted as a minimization concern (don't add concepts) or a uniformity concern (keep the bijection). Without a principle grounding, the two halves of §1.3 appeared to be co-equal style preferences, and the decision oscillated.

**Why this was a principle gap.** The variance test is P3 applied to the serialization surface. P3 already says "distinct computational patterns have distinct structural forms." The representation-surface analog is: "distinct behavioral rules have distinct surface forms, and identical rules have identical forms." This is the same structural-correspondence property, just measured at the JSON-key level instead of the node-kind level. Stating it as a style choice rather than as a P3 axis made it appear optional, which made the §1.3.1/§1.3.2 tension look like a preference question rather than a principled trade.

**Sharpening applied.** P3 now states correspondence on three axes:

- Control-flow (unchanged).
- Data-publication (unchanged, from the bound-outputs sharpening).
- Representation-surface: the same JSON surface pattern means the same thing wherever it appears; different patterns mean different things.

With this in place, §1.3.2 (uniformity) is "P3's representation-surface axis applied to the IR's JSON surface." The variance lens (§10) is the per-decision diagnostic for this axis. And the tension with §1.3.1 (minimization) is the familiar P3-vs.-minimization tension the design already knows how to handle: P3 generates pressure to add structure (close the surface ambiguity); minimization says wait until a scenario forces it. Decision 0007 (G-K1.a vs. G-K1.b) is the worked example.

**Lesson (reinforces the previous two).** Three principle sharpenings now follow the same pattern: a principle's scope was framed too narrowly (control-flow only, then intra-IR only, now graph-level only). Each time, a decision that "almost" derived from a principle turned out to derive from an unstated axis of that principle. The pattern is established: when a decision converges by style choice or analysis without a principle drive, check whether a principle's scope needs widening, not whether a new style choice is needed.

---

## Deployment and Evolution

Deferred from v1. Key areas (incremental migration, safe-change analysis, IR identity across versions, deployment-scoped composability, node identity stability, checkpoint/resume) are all either "not an IR concern" (operational/tooling) or "becomes relevant with sub-workflow composition." The v1 design decisions have been verified to not block future solutions: everything needed (version fields, checkpoint persistence, side-effect declarations, MapNode) is additive.

---

## Summary

| Area                          | IR design concern?          | Status       | Resolution                                                                                                                                                             |
| ----------------------------- | --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parallel iteration visibility | Yes                         | **Deferred** | P3 drives MapNode distinction. P1-P5 sufficient when added.                                                                                                            |
| Intra-scope name visibility   | Yes                         | **Resolved** | Hide-by-default `bind` switch (IR §8.15). Originally analysis-driven; principles P3/P4/P5 sharpened to be bi-axial so future data-flow decisions are principle-driven. |
| Decomposition overhead        | No (engine policy)          | Resolved     | Author chooses granularity. Engine optimizes execution.                                                                                                                |
| Intermediate state visibility | No (task metadata)          | Resolved     | Optional task capability declaration. Not workflow data flow.                                                                                                          |
| Replay/checkpoint             | No (task metadata + engine) | Resolved     | Side-effect/idempotency declarations are additive. Engine persists state.                                                                                              |
| Loop iteration identity       | No (engine mechanism)       | Resolved     | Engine exposes iteration count. Consistent with P2.                                                                                                                    |
| Error diagnostic constraints  | Yes (mechanism)             | Resolved     | Optional references mechanism in the [IR](../ir/ir-v0.1.md) (§3.4).                                                                                                    |
| Incremental migration         | Yes                         | **Deferred** | Becomes relevant with sub-workflow composition.                                                                                                                        |
| Safe-change analysis          | No (operational)            | Resolved     | Principles enable structural diff. Runtime survival is operational.                                                                                                    |
| IR identity across versions   | No (tooling)                | Resolved     | Migration mapping is external tooling.                                                                                                                                 |
| Composability for deployment  | Yes                         | **Deferred** | Sub-workflow composition extends P4.                                                                                                                                   |

### Open questions

1. **Parallel iteration:** Deferred from v1. When added, P3 drives the MapNode decision.
2. **Sub-workflow evolution:** When sub-workflows are added, does P4's boundary contract need strengthening for versioning?
3. **Task contract extensions:** Side-effect annotations, idempotency markers, progress declarations are all additive task boundary metadata.
