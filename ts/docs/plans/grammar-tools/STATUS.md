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
| 2   | Sketch `LoadedGrammar` and `TraceEvent` types (placeholders)                                                                                                     | [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) | done   |
| 3   | Pick CLI location (recommend `examples/grammarStudio`); update PLAN + chunk 07                                                                                   | [PLAN.md](./PLAN.md), [07-cli.md](./07-cli.md)                                               | done   |
| 4   | Define error-handling contract (Diagnostics vs exceptions) in chunk 01                                                                                           | [01-core.md](./01-core.md)                                                                   | queued |
| 5   | Add Phase-2 decision-gate exit criteria to PLAN                                                                                                                  | [PLAN.md](./PLAN.md)                                                                         | queued |
| 6   | Lock diff granularity (rule-level v1) and coverage shape (source-coordinated) in chunk 08                                                                        | [08-coverage-and-diff.md](./08-coverage-and-diff.md)                                         | queued |
| 7   | Delete now-redundant `/memories/repo/grammar-matching-architecture.md` (content folded into [actionGrammar.md](../../architecture/actionGrammar.md) in action 1) | repo memory                                                                                  | queued |
| 8   | Add a "Motivation" section to PLAN.md (1-2 paragraphs on users / problems)                                                                                       | [PLAN.md](./PLAN.md)                                                                         | queued |

## Done

| Date       | Action                                                                                                                                                                                                                                                                                                           | Touches                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-04-28 | Sketch `LoadedGrammar` (semi-opaque handle: source / compiled grammar / AST / text / identifier index) and `TraceEvent` discriminated union (rule entered / exited / part attempted / matched / failed / backtrack). Defines `RuleId` / `PartId` placeholders. Coverage (chunk 08, B.3) reuses the trace stream. | [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) |     | 2026-04-28 | Restructure `LoadedGrammar` into a three-layer envelope (`grammar` + optional `debugInfo` + optional `files`) after walking through six host scenarios. Compiler-emitted `GrammarDebugInfo` (sidecar JSON, analogous to `.pdb` / source maps) and lazy `decompile(grammar)` API give graceful degradation for snapshot mode. Per-service requirements matrix added. Decompile API declared in chunk 01; implementation deferred. | [01-core.md](./01-core.md) |     | 2026-04-28 | Resolve ADRs 0001 & 0002, sequence 0003 / 0004 into the plan as phase-gated decisions. Move canonical NFA/DFA backend overview into [actionGrammar.md](../../architecture/actionGrammar.md). 0002 Accepted (option A, with bench-validation gate); 0001 / 0003 / 0004 still Open with phase-relative resolve-before markers. | All four ADRs, [PLAN.md](./PLAN.md), architecture doc |
| 2026-04-28 | Lock CLI location: new package `examples/grammarStudio` (kebab name `grammar-studio`), not an extension of `examples/schemaStudio`. `--json` output mode mandatory from E.0 so each later command is CI-pipeable. Fixture grammars come from `packages/actionGrammar/test-data`; CLI does not ship its own.      | [PLAN.md](./PLAN.md), [07-cli.md](./07-cli.md)                                               |
| 2026-04-28 | Make `grammar` required on `LoadedGrammar` after weighing pros / cons of "grammar optional when source present". Compile failures now flow through a `LoadResult` discriminated union at the loader boundary; LSP-style hosts cache last-known-good. Eliminates a runtime branch from every service.             | [01-core.md](./01-core.md)                                                                   |

## Discovered follow-ups

Items raised mid-action that aren't on the original numbered list.
Promote into "Queued actions" when scheduling.

- **ADR 0003 (snapshot transport): does the snapshot ship `debugInfo`,
  source bytes, both, or neither?** Surfaced by the action-2 deeper
  pass on `LoadedGrammar`. The three-layer model lets snapshot mode
  degrade gracefully whichever choice we make, but ADR 0003 should
  pick a default and call it out.
- **Implement `decompile(grammar)` and `GrammarDebugInfo` emission.**
  API declared in chunk 01; needs an implementation chunk (Track A.5
  candidate) before chunks 06 / 08 can rely on it. Touches
  `actionGrammar` (compiler emits debug info, writer projects
  `Grammar` → `RuleDefinition`) and `grammar-tools-core`.

## Out of scope for this pass

_(none yet)_
