# Decision 0010 deferred review findings

Companion to [0010-finish-workflow-scope-unification.md](0010-finish-workflow-scope-unification.md)
and [0010-implementation-plan.md](0010-implementation-plan.md).

This file accumulates **review findings - from code-review or
test-gap subagent rounds - that were *not* acted upon** during the
phase in which they surfaced. Every finding from every review round
that is not fixed in-place must land here. Nothing silently dropped.

Deferral reasons are typically one of:

- **Out of scope for 0010.** The finding is real but addresses a
  pre-existing issue or a separate concern; track it elsewhere.
- **Speculative.** The finding's premise is not solidly supported
  by 0010's principles; revisit if pressure mounts.
- **Cost vs value.** Real finding, but the fix cost is high relative
  to the risk and other work is more valuable.
- **Future-dependent.** Fix depends on a decision or change that has
  not landed yet.

Each entry names the source review round so the deferral chain stays
auditable.

## Entry template

```
### YYYY-MM-DD - <short title>

Source: phase <N> code review round <K> | phase <N> test-gap review round <K>
Phase: 1 | 2 | 3
Finding: <one or two sentences summarising what the reviewer flagged>
Files / sections: <pointers>
Severity (reviewer's assessment): low | medium | high
Deferral reason: out of scope | speculative | cost vs value | future-dependent
Reasoning: <why we are not fixing now>
Follow-up pointer: <issue / proposal / "none" - where this lives next, if anywhere>
```

## Entries

### 2026-05-20 - Task inputs are not deeply immutable

Source: phase 2 code review round 1; phase 2 test-gap review round 2
Phase: 2
Finding: `resolveTemplate` returns live references into
`scope.bindings` / `scope.state` for object and array values. Any
task that mutates a property of its input (e.g.
`input.results.push(x)`) silently mutates the engine's internal
scope, affecting all later nodes that read the same name. This
applies to all `$from:scope` and `$from:state` references, not
just loop state. The shallow-copy applied in `executeLoop` /
`executeBranch` prevents top-level reassignment leaking between
iterations/arms but does not address deep mutation.
Files / sections: `ts/examples/workflow/engine/src/runner.ts`
(`resolveTemplate`, `executeTask`, `executeLoop`, `executeBranch`).
Severity (reviewer's assessment): medium
Deferral reason: cost vs value
Reasoning: All current standard-library tasks are non-mutating
(they return new values via `bind`). A full deep-copy hand-off
(`structuredClone`) has measurable cost on large inputs; the
tradeoffs are not yet benchmarked. The implicit "tasks must not
mutate their inputs" contract is sufficient for the current
stdlib.
Follow-up pointer: design options (document-only, deep-copy,
freeze-in-debug, registry opt-in) are tracked in
[`../future/task-input-immutability.md`](../future/task-input-immutability.md).
Re-open on a silent mutation bug in user code, addition of a
mutating stdlib task, or a benchmarking pass on `structuredClone`.
