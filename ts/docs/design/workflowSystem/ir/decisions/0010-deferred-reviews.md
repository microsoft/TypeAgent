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

### 2026-05-20 - Branch arms can deep-mutate inherited loop state

Source: phase 2 code review round 1
Phase: 2
Finding: Branch arms now receive a *shallow copy* of the parent
scope's `state`, so top-level reassignment cannot leak. Deep
mutation (e.g. an arm-internal task that calls
`state.results.push(...)` rather than returning a new array) would
still mutate the parent's array by reference.
Files / sections: `ts/examples/workflow/engine/src/runner.ts`
(`executeBranch`); `ts/examples/workflow/engine/src/runner.ts`
(`executeLoop` shares the same shape).
Severity (reviewer's assessment): medium
Deferral reason: cost vs value
Reasoning: All current standard-library tasks are non-mutating;
map/filter use `list.append` which returns a new array. The
shallow-copy fix addresses the immediate inconsistency with
`executeLoop`. A full deep-copy hand-off is more expensive and a
non-mutation task contract is the better long-term fix.
Follow-up pointer: re-open when a built-in or user-supplied task
mutates its inputs in place, or when we relax the implicit "tasks
are pure with respect to their inputs" convention. At that point
either deep-copy on hand-off or add a validator pass that flags
`$from:state` references in arms whose nodes touch mutating tasks.


### 2026-05-20 - Loop body state shallow-copy isolation has no runtime test

Source: phase 2 test-gap review round 2
Phase: 2
Finding: `executeLoop` shallow-copies `state` into the body scope
at each iteration (the symmetric counterpart to `executeBranch`'s
shallow copy into each arm). There is no direct runtime test that
asserts a top-level state reassignment made by iteration N is
invisible to iteration N+1.
Files / sections: `ts/examples/workflow/engine/src/runner.ts`
(`executeLoop`); `ts/examples/workflow/engine/test/`.
Severity (reviewer's assessment): low
Deferral reason: cost vs value
Reasoning: All current standard-library tasks are non-mutating
with respect to scope (they bind a fresh value via `bind`, not by
writing into state). Exercising the guarantee requires a custom
mutating task fixture; that fixture has no other caller and would
carry its own maintenance cost. The runner implementation is
small and the guarantee is asserted in the deep-mutation entry
above.
Follow-up pointer: either a new built-in task that exposes a
state-write capability, or a runtime regression that removes the
per-iteration shallow copy. At that point add a fixture task
`state.set(name, value)` and a two-iteration loop that proves
iteration 2 does not observe iteration 1's writes.
