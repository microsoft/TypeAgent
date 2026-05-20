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

(none yet - to be populated during review rounds)
