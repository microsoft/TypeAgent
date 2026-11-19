# Prose experiment 1: the task's prose removed

Date: 2026-11-18. Step 1 of the plan to find how little prose an
implementer needs (`../../tool/elements.md`, "Visibility to the
implementer").

## Setup

- Task 9.2 (`shapeProcessor.ts`, Sonnet), from an empty output, made
  with `node task.ts make 9.2 --tests runnable --prose minimal`.
- Task 9's section in `TASK.md` (kept here) was cut to its Exports,
  Imports and the budget rule's ID: no Approach, Decided behavior,
  Costs text or Left to the implementer. `TASK.md` went from 1,419 to 942
  words; the rest is the job's instructions and the shared rules for
  every implementation.
- As in `../visibility-1/`, the test infrastructure ran but couldn't be
  read, and now `.task/task.ts` couldn't be read either.
- The transcript is kept (`transcript.jsonl`).

## Result

- $1.31, 25 turns, 12.5 minutes. Every test passed on the first run, so
  the agent saw no failure output.
- It read `TASK.md`, `dataModel.ts`, `shapeModel.ts`, `events.ts`,
  `shape.ts`, `geometry.ts`, both vocabularies, `rules.ts` and the
  config files.
- It reported, as choices, draining the local queue first and the
  `newShapeId` format. Neither was made silently.

## What it found

1. **No test depends on the removed prose.** The prose-only items of
   task 9's text ("Decided behavior": the `newShapeId` format, local
   before remote) are not checked by any test. The one test about IDs
   checks that different clients' IDs are disjoint, with client IDs such
   as `a#1` and `#`. So the format was over-specified, not a hidden
   requirement.
2. **The budget, read as written, allows a slow clear.** The formal rule
   `ShapeMessageProcessor.log-amortized` says logarithmic time "on each
   of the processor's workloads", and the only clear workload is one that
   knows nothing. The agent kept that case constant and let a clear that
   knows any acknowledged shape scan every shape present (line 219). It
   said so in its report. Task 9's Costs prose ("whether or not a
   workload measures it") was what ruled this out, and the method's
   principle that a budget names a complexity class with measurement as
   a proxy (`../../method.md`, "The design") isn't in the rule's formal
   statement or in `rules.ts`. A spec gap, found by removing prose.
3. **It also leaves removed shapes in its per-client lists,** skipped
   later, so a clear's walk can grow with the client's past adds, not
   the shapes it removes: the same gap.
4. **Design-file prose was read as permission.** Its note cites the
   "Order of the queues" paragraph in `shapeModel.ts`, a derivation with
   no formal statement, as describing an allowed interleaving.

## Next

- Step 2: make the budget's meaning formal (the class holds for every
  call in every state; workloads only measure it), and decide whether
  the `newShapeId` format and the queue order are open.
- Steps 3 and 4 as planned: strip prose from the design files, and
  distinguish the low-prose runs from run 1.
