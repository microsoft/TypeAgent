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

### 2026-05-20 - Validator does not flag literal `continueWhen: true`

Source: phase 2 code review round 2
Phase: 2
Finding: The validator confirms `continueWhen` is present and
boolean-typed but does not flag a literal `true`. A loop with
`continueWhen: true` and no body-internal exit will iterate up to
`maxIterations` (default 10,000) before terminating.
Files / sections: `ts/examples/workflow/model/src/validate.ts`
loop validation block.
Severity (reviewer's assessment): low
Deferral reason: cost vs value
Reasoning: `maxIterations` is the documented safety valve;
literal-true is occasionally legitimate (e.g. a polling loop with
`onError` as the exit path). Flagging it would require either an
exception for `onError`-using loops or a separate
"is this loop reachable to a terminal" pass, neither of which is
on the critical path for 0010 landing.
Follow-up pointer: re-open on a second occurrence of an
accidentally-infinite loop in user code, or a redesign of
`maxIterations` semantics. At that point add a validator pass
that flags constant-`true` `continueWhen` unless the body has a
structural exit (throw, onError-terminating arm, etc.).

### 2026-05-20 - `continueWhen` template references not name-resolved

Source: phase 2 test-gap review round 2
Phase: 2
Finding: The validator confirms a loop has `continueWhen` and that
its resolved type is boolean, but it does not walk the Template to
confirm `$from:scope` (or `$from:state`) references resolve to
names actually bound in the body scope. A loop with
`continueWhen: { $from:"scope", name:"doesNotExist" }` currently
passes validation. A skipped test is checked in to track the gap.
Files / sections: `ts/examples/workflow/model/src/validate.ts`
loop block; matching `.skip` test in
`ts/examples/workflow/model/test/validate.spec.ts` ("rejects
continueWhen referencing an unknown scope name").
Severity (reviewer's assessment): medium
Deferral reason: out of scope
Reasoning: `continueWhen` is one of several node-adjacent
templates (alongside `iterateState` values, `output` templates,
branch `selector`, arm `inputs`, etc.) that today are type-checked
via `resolveTemplateType` but not name-resolved against scope. A
focused fix should add name-resolution for all of them in one
pass, not just `continueWhen`. Runtime currently fails on the
first iteration with an unresolved-reference error, which is
loud-but-late.
Follow-up pointer: separate task to add scope-aware name
resolution to the template validator across all template
positions. When that lands, remove `.skip` and add equivalent
coverage for `iterateState`, branch `selector`, and arm `inputs`.

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
