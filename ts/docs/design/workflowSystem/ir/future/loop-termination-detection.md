# Future: loop termination detection / bounded-loop constraint

Status: **Exploratory.**

## Origin

Decision 0010 replaced `@iterate` / `@exit` loop-termination
sentinels with a boolean `continueWhen` Template resolved at body
completion. During the phase 2 code review a gap was noted: the
validator does not flag `continueWhen: true` (literal). A loop
with a literal-`true` `continueWhen` and no body-internal exit
will iterate until `maxIterations` fires (default 10 000). The
finding was deferred because:

- `maxIterations` is the documented runtime safety valve.
- Literal-`true` is occasionally legitimate (e.g. a polling loop
  whose only exit is `onError`).
- Flagging it requires either an exception for `onError`-using
  loops or a separate "does this loop always reach a terminal?"
  pass, neither of which was on the critical path for 0010.

This note captures the design space for addressing that gap.

## Context

Decision 0010 replaced `@iterate` / `@exit` sentinels with a
boolean `continueWhen` Template resolved at body completion. A
loop whose `continueWhen` is a literal `true` (or a reference that
always resolves to `true`) will iterate until `maxIterations` fires
— the only termination guarantee is the safety cap.

The validator today confirms:

1. `continueWhen` is present.
2. Where type-inferrable, it resolves to a boolean.

It does **not** flag:

- `continueWhen: true` (literal).
- `continueWhen: { $from: "state", name: "flag" }` where `flag` is
  never written to false by `iterateState`.

`maxIterations` (default 10 000) provides a loud-but-late
runtime failure, not a design-time signal.

## Why consider this

- Accidentally unbounded loops are a recurring authoring mistake.
- The existing `foreach` sketch (`foreach.md`) already motivates
  a category of loops that are _structurally_ bounded (element
  count known at entry). Unifying this direction would make
  "always terminates" a property the IR can express and the
  validator can enforce.
- A design-time signal is friendlier than a `maxIterations` cap
  reached at runtime after potentially thousands of external task
  calls.

## Candidate options

### Option A — Validator warning for constant `continueWhen`

Minimal change. The validator emits a diagnostic when
`continueWhen` is a literal `true` or a reference whose only
writer (via `iterateState`) never sets it to `false`.

Scope: validator only; no IR shape change.

Complication: legitimate polling loops (e.g. "run until an
external system is ready") use `onError` as the exit path and a
literal-`true` `continueWhen`. The warning must be suppressible
or must inspect the body for an `onError`-terminating branch.

### Option B — Bounded loop variant

Introduce a second loop kind (or a mode flag on `LoopNode`) that
expresses "this loop has a known upper bound given at entry."
`maxIterations` becomes required, typed to a `Template` that
resolves to an integer in the input scope, and the validator can
prove the loop terminates after at most `N` iterations.

The current general loop retains its unbounded form for genuine
polling patterns; the bounded variant offers a static guarantee.

Aligns with the `foreach` sketch, which is a degenerate
bounded loop whose bound is `list.length`.

### Option C — Structured termination via `untilCondition` + `whileCondition`

Replace `continueWhen` (a single boolean computed at body
completion) with an explicit pair of temporal conditions:

- `whileCondition` — pre-checked before each body execution
  (loop does not execute at all if false on entry).
- `untilCondition` — post-checked after body completion (classic
  do-while inversion of `continueWhen`).

This enables static detection of "will this loop execute at
least once?" and "will this loop always terminate?" as separate
questions, at the cost of a shape change that is not
backward-compatible.

## Risks and costs

- Any IR shape change to `LoopNode` requires a coordinated
  update to validator, engine runner, DSL emitter, and all
  fixtures — similar scope to decision 0010 itself.
- Option A (warning only) is low-cost but has the polling-loop
  false-positive problem.
- Options B and C are higher-confidence but are breaking changes
  that require a compatibility story (shim period or a new node
  kind).

## Open questions

1. How common are intentional `continueWhen: true` polling loops
   in practice? If rare, Option A's warning is sufficient.
2. Is the `foreach` node (see `foreach.md`) the right vehicle for
   Option B's bounded loop, or should `LoopNode` gain a
   `boundedBy` field?
3. Should `maxIterations` become required (not defaulted) once a
   bounded-loop option exists? That would make the distinction
   explicit: you either prove termination or you set a cap.

## Non-goals

- Formal loop invariant verification (would require a theorem
  prover integrated with the validator; well outside scope).
- Removing `maxIterations`. It remains the universal safety valve
  regardless of which option is pursued.
- Addressing `foreach` in this note. That is covered by
  `foreach.md`; this note focuses on the termination-detection
  problem that applies to the general unbounded loop.
