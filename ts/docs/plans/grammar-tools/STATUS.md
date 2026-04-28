# Grammar Tools - Plan Status & Backlog

Working tracker for the plan-refinement pass kicked off by the
2026-04-28 review of [PLAN.md](./PLAN.md) and the eight chunk / four
ADR documents in this folder.

This file is the **single source of truth for queued plan-refinement
work**. Update it whenever an action is started, completed, or a new
follow-up surfaces. Keep entries terse - one line per item where
possible.

## Conventions

- **Status**: `queued` / `in-progress` / `done` / `dropped`.
- Each item links to the relevant chunk(s) / ADR(s) it touches.
- New follow-ups discovered mid-action go under "Discovered follow-ups"
  with a back-reference to the action that surfaced them.

## In progress

_(none)_

## Queued actions (from 2026-04-28 review)

Ordered as in the review's "Recommended next actions" list. Action 1
is already done; items below are next.

| #   | Action                                                                                                                                                           | Touches                                                                                      | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| 2   | Sketch `LoadedGrammar` and `TraceEvent` types (placeholders)                                                                                                     | [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) | queued |
| 3   | Pick CLI location (recommend `examples/grammarStudio`); update PLAN + chunk 07                                                                                   | [PLAN.md](./PLAN.md), [07-cli.md](./07-cli.md)                                               | queued |
| 4   | Define error-handling contract (Diagnostics vs exceptions) in chunk 01                                                                                           | [01-core.md](./01-core.md)                                                                   | queued |
| 5   | Add Phase-2 decision-gate exit criteria to PLAN                                                                                                                  | [PLAN.md](./PLAN.md)                                                                         | queued |
| 6   | Lock diff granularity (rule-level v1) and coverage shape (source-coordinated) in chunk 08                                                                        | [08-coverage-and-diff.md](./08-coverage-and-diff.md)                                         | queued |
| 7   | Delete now-redundant `/memories/repo/grammar-matching-architecture.md` (content folded into [actionGrammar.md](../../architecture/actionGrammar.md) in action 1) | repo memory                                                                                  | queued |
| 8   | Add a "Motivation" section to PLAN.md (1-2 paragraphs on users / problems)                                                                                       | [PLAN.md](./PLAN.md)                                                                         | queued |

## Done

| Date       | Action                                                                                                                                                                                                                                                                                                                       | Touches                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-04-28 | Resolve ADRs 0001 & 0002, sequence 0003 / 0004 into the plan as phase-gated decisions. Move canonical NFA/DFA backend overview into [actionGrammar.md](../../architecture/actionGrammar.md). 0002 Accepted (option A, with bench-validation gate); 0001 / 0003 / 0004 still Open with phase-relative resolve-before markers. | All four ADRs, [PLAN.md](./PLAN.md), architecture doc |

## Discovered follow-ups

Items raised mid-action that aren't on the original numbered list.
Promote into "Queued actions" when scheduling.

_(none yet)_

## Out of scope for this pass

_(none yet)_
