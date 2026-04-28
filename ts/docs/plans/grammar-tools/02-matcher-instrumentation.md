# 02 - actionGrammar instrumentation

Status: **Stub** - design pending.
Owner: TBD.
Depends on: ADR [0002 - trace hook strategy](./decisions/0002-trace-hook.md).
Blocks: 01 (A.2 diagnostics, B.2 trace, B.3 coverage), 03 (C.6 / C.7),
05, 07.

Maps to PLAN: [Critical path 0b](./PLAN.md#critical-path-track-0). This
chunk is on the critical path - land it first.

## TL;DR

Add the minimum hooks to
[`packages/actionGrammar`](../../../packages/actionGrammar) needed by
`grammar-tools-core`:

1. Full source spans on parsed nodes (for diagnostics and go-to-def).
2. An opt-in trace callback on the matcher (for the rule-level stepper
   **and** the coverage service - both consume the same event stream).

## Scope

- Audit
  [`grammarRuleParser.ts`](../../../packages/actionGrammar/src/grammarRuleParser.ts)
  for source spans on every relevant AST node (rule name, parameter
  list, rule reference, string part, wildcard, etc.). Add what is
  missing.
- Add an opt-in `trace?: (event: TraceEvent) => void` parameter to the
  rule-level matcher in
  [`grammarMatcher.ts`](../../../packages/actionGrammar/src/grammarMatcher.ts).
- Define the `TraceEvent` type (rule entered, part attempted, success /
  fail, slot env after step, position). Event identity must include a
  stable rule + part identifier so coverage can aggregate hits.
- Hook must be **opt-in and zero-cost when unused**.

## Non-scope

- NFA / DFA tracing (out of v1).
- Changing matcher semantics.

## Open questions

- Pick option A (in-matcher hook) vs option B (AST re-walk in core). See
  [ADR 0002](./decisions/0002-trace-hook.md).
- Should `TraceEvent` live in `actionGrammar` or in `grammar-tools-core`?
  Probably `actionGrammar` so the matcher itself owns the contract.
- Do source spans round-trip through the serializer
  ([`grammarSerializer.ts`](../../../packages/actionGrammar/src/grammarSerializer.ts))?
  If not, snapshot-loaded grammars cannot offer go-to-def to source. May
  be acceptable if snapshots only target the debug panel, not the editor.

## Verification

- Existing
  [`packages/actionGrammar/test`](../../../packages/actionGrammar/test)
  suite stays green.
- New tests assert source spans on a representative `.agr` AST.
- New tests assert ordered trace events for a known grammar / input pair.
