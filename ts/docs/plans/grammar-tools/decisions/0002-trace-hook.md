# ADR 0002 - Match trace hook strategy

Status: **Accepted** (2026-04-28). Option A.
Blocks: 02, and transitively 01 / 03 / 05.

## Context

The rule-level stepper in `grammar-tools-core` needs to observe the
matcher's progress through a grammar: which rule is entered, which part
is attempted, success / fail, slot environment after each step. The
existing matcher in
[`grammarMatcher.ts`](../../../../packages/actionGrammar/src/grammarMatcher.ts)
does not currently emit such events.

Background on the matcher (forward / backward direction, range
candidates, the four completion categories, and the direction
asymmetry around Category 3b) lives in
[`docs/architecture/actionGrammar.md`](../../../architecture/actionGrammar.md)
under "Matching backend". That doc is the canonical reference for any
complexity an instrumentation strategy has to respect.

## Options

### A. Add an opt-in `trace` hook to the matcher _(recommended)_

- Add `trace?: (event: TraceEvent) => void` to the matcher options.
- Pros: minimal surface change, zero cost when unused, matches what the
  matcher actually does.
- Cons: small upstream change that has to be maintained alongside the
  matcher.

### B. Re-walk the rule AST in `grammar-tools-core`

- Pros: no upstream change.
- Cons: duplicates matcher logic, drifts over time, easy to be subtly
  wrong - especially around backtracking, wildcard self-loops, and the
  forward / backward asymmetries documented in
  [`actionGrammar.md`](../../../architecture/actionGrammar.md)
  ("Forward/backward equivalence analysis" and "Direction asymmetry:
  why only Category 3b needs shadow candidates").

## Decision

**Option A.** Add an opt-in `trace?: (event: TraceEvent) => void`
option to the matcher.

### Conditions

1. **Zero overhead when unused.** The trace path must be a single
   `if (trace !== undefined)` guard on the hot path. No allocation, no
   indirection, no branch when the option is absent.
2. **Performance validation required before merge.** Re-run the
   existing benchmarks under
   [`packages/actionGrammar/src/bench/`](../../../../packages/actionGrammar/src/bench/)
   (`pnpm run bench:synthetic` and `pnpm run bench:real` from the
   package directory) with and without the change applied. Document
   the delta in the chunk 02 PR description. Reject the PR if the
   no-trace path regresses by more than ~1% on either bench.
3. **`TraceEvent` typedef lives in `actionGrammar`.** Chunk 02 owns
   the contract; `grammar-tools-core` re-exports it. See chunk 02 for
   the placeholder shape.

## Consequences

Chunk 02 owns the `TraceEvent` contract and chunk 01 just consumes it.
The matcher gains one optional parameter and a small set of trace call
sites; benchmarks gate that this stays free in the common path.
