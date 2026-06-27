# Future Option: Ordered Start Mode for Fork/ForkMap

Status: exploratory note (not current behavior, not yet planned work).

## Context

Current fork/forkMap semantics intentionally allow non-deterministic
scheduling/completion order when concurrency is greater than 1. This is the
right default for throughput, but some workflows may want a stronger guarantee
about the order in which branch/iteration work is started.

## Candidate option

Add an optional execution mode that preserves source/declaration order for
launching branch/iteration work while still allowing concurrent execution
after launch.

Possible shape (illustrative only):

- `startPolicy: "unordered" | "ordered"`
- Default remains `"unordered"` to preserve current semantics.
- `"ordered"` means:
  - launch attempts happen in source/declaration order
  - no guarantee is made about completion order
  - outputs remain keyed by branch name (fork) / index order (forkMap)

## Why consider this

- Better reproducibility for traces and debugging.
- Easier reasoning for side-effectful tasks that still need parallelism.
- Does not require changing the default concurrency contract.

## Risks / costs

- Potential false sense of determinism (start order is not completion order).
- Additional API and documentation surface area.
- More scheduler policy complexity in the engine.

## Open questions

1. Should this apply to both `fork` and `forkMap`?
2. Should this be controlled in IR, DSL options, or engine runtime options?
3. How should cancellation interact with ordered start mode?
4. Do we need event-level signals to expose launch order explicitly?
5. Is this a product requirement or just an engineering convenience?

## Non-goal

This note does not change current behavior.
