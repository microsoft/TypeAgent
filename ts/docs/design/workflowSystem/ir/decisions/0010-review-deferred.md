# Decision 0010 - review items deferred for later

Companion to [0010-design-notes.md](0010-design-notes.md) and
[0010-implementation-plan.md](0010-implementation-plan.md).

Per execution policy, each phase runs:
- 2 rounds of design/code review (via subagents)
- 2 rounds of test-gap review (via subagents)

Items raised by those reviews that we **chose not to act on** in this
landing are documented here. Each entry records what was raised, why
it was deferred, and what would re-open it.

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
