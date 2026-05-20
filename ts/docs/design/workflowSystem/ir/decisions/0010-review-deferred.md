# Decision 0010 - review items deferred for later

Companion to [0010-design-notes.md](0010-design-notes.md) and
[0010-implementation-plan.md](0010-implementation-plan.md).

Per execution policy, each phase runs:
- 2 rounds of design/code review (via subagents)
- 2 rounds of test-gap review (via subagents)

Items raised by those reviews that we **chose not to act on** in this
landing are documented here. Each entry records what was raised, why
it was deferred, and what would re-open it.

## Phase 2 - code review round 2

### Literal `continueWhen: true` not flagged by validator

**Raised by:** code-review subagent (Phase 2 round 2).

**Summary:** The validator confirms `continueWhen` is present and
boolean-typed but does not flag a literal `true`. A loop with
`continueWhen: true` and no body-internal exit will iterate up to
`maxIterations` (default 10,000) before terminating.

**Why deferred:** `maxIterations` is the documented safety valve;
literal-true is occasionally legitimate (e.g. a polling loop with
`onError` as the exit path). Flagging it would require either an
exception for `onError`-using loops or a separate "is this loop
reachable to a terminal" pass, neither of which is on the critical
path for 0010 landing.

**What would re-open this:** A second occurrence of an
accidentally-infinite loop in user code, or a redesign of
`maxIterations` semantics that removes the implicit safety. At that
point add a validator pass that flags constant-`true` `continueWhen`
unless the body has a structural exit (throw, onError-terminating
arm, etc.).

## Phase 2 - test gap review round 2

### `continueWhen` template references not validated

**Raised by:** test-gap subagent (Phase 2 round 2).

**Summary:** The validator confirms that `continueWhen` is present
on a loop node, but it does not walk the Template to confirm that
`$from:scope` (or `$from:state`) references resolve to names that
actually exist in the body scope. A test that constructs a loop
with `continueWhen: { $from:"scope", name:"doesNotExist" }`
currently passes validation. The test is checked in as `.skip` in
`ts/examples/workflow/model/test/validate.spec.ts` (id: "rejects
continueWhen referencing an unknown scope name").

**Why deferred:** `continueWhen` is one of several
node-adjacent templates (alongside `iterateState` values,
`output` templates, branch `selector`, etc.) that today are
type-checked via `resolveTemplateType` but not name-resolved
against scope. A focused fix should add name-resolution for all of
them in one pass, not just `continueWhen`. Doing that is out of
scope for the 0010 landing; runtime will currently fail on the
first iteration with an unresolved-reference error, which is
loud-but-late.

**What would re-open this:** A separate task to add scope-aware
name resolution to the template validator. When that lands, remove
the `.skip` on the test and add equivalent coverage for
`iterateState`, branch `selector`, and arm `inputs`.

### Loop body state shallow-copy isolation runtime test

**Raised by:** test-gap subagent (Phase 2 round 2).

**Summary:** `executeLoop` shallow-copies `state` into the body
scope at each iteration, which is the symmetric counterpart to
`executeBranch`'s shallow copy into each arm. There is no direct
runtime test that asserts a top-level state reassignment made by
iteration N is invisible to iteration N+1.

**Why deferred:** All current standard-library tasks are
non-mutating with respect to scope (they bind a fresh value via
`bind`, not by writing into state). Exercising the guarantee
requires a custom mutating task fixture; that fixture has no other
caller and would carry its own maintenance cost. The runner
implementation is small and the guarantee is asserted in the
code-review-deferred entry above.

**What would re-open this:** Either a new built-in task that
exposes a state-write capability, or a runtime regression that
removes the per-iteration shallow copy. At that point add a
fixture task `state.set(name, value)` and a two-iteration loop
that proves iteration 2 does not observe iteration 1's writes.

## Phase 2 - code review round 1

### Deep-object mutation of inherited loop state

**Raised by:** code-review subagent (Phase 2 round 1).

**Summary:** Branch arms now receive a *shallow copy* of the parent
scope's `state`, which prevents top-level reassignment from leaking
to the parent or to sibling arms. Deep mutation (e.g. an in-arm task
that calls `state.results.push(...)` rather than returning a new
array) would still mutate the parent's array by reference.

**Why deferred:** All current standard-library tasks are
non-mutating; map/filter use `list.append` which returns a new
array. The shallow-copy fix addresses the immediate inconsistency
with `executeLoop` (loop bodies also shallow-copy). A full deep-copy
hand-off is more expensive and a non-mutation task contract is the
better long-term fix.

**What would re-open this:** A new built-in or user-supplied task
that mutates its inputs in place; or a decision to relax the "tasks
are pure with respect to their inputs" convention. If either lands,
revisit and either deep-copy on hand-off or add a validator pass that
flags `$from:state` references in arms whose nodes touch mutating
tasks.
