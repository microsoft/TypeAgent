# ADR 0002 - Match trace hook strategy

Status: **Open**.
Blocks: 02, and transitively 01 / 03 / 05.

## Context

The rule-level stepper in `grammar-tools-core` needs to observe the
matcher's progress through a grammar: which rule is entered, which part
is attempted, success / fail, slot environment after each step. The
existing matcher in
[`grammarMatcher.ts`](../../../packages/actionGrammar/src/grammarMatcher.ts)
does not currently emit such events.

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
  wrong (especially around backtracking, wildcard self-loops, the
  forward / backward asymmetries documented in
  `/memories/repo/grammar-matching-architecture.md`).

## Decision

_Pending._ Recommendation: **A**.

## Consequences

Choosing A means chunk 02 owns the `TraceEvent` contract and chunk 01
just consumes it. Choosing B keeps `actionGrammar` untouched but pushes
real complexity into core.
