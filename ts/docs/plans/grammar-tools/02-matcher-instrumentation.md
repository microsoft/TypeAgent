# 02 - actionGrammar instrumentation

Status: **Partial** - grammarMatcher trace hook landed; PartId assignment pending.
Owner: TBD.
Depends on: ADR [0002 - trace hook strategy](./decisions/0002-trace-hook.md).
Blocks: 01 (A.2 diagnostics, A.5 debug-info emission, B.2 trace, B.3
coverage), 03 (C.6 / C.7), 05, 07.

Maps to PLAN: [Critical path 0b](./PLAN.md#critical-path-track-0). This
chunk is on the critical path - land it first.

## TL;DR

Add the minimum hooks to
[`packages/actionGrammar`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/actionGrammar) needed by
`grammar-tools-core`:

1. Full source spans on parsed nodes (for diagnostics and go-to-def).
2. An opt-in trace callback on the matcher (for the rule-level stepper
   **and** the coverage service - both consume the same event stream).

## Scope

- Audit
  [`grammarRuleParser.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/actionGrammar/src/grammarRuleParser.ts)
  for source spans on every relevant AST node (rule name, parameter
  list, rule reference, string part, wildcard, etc.). Existing nodes
  carry a single `pos?: number` (start offset only); add an `end?: number`
  where missing, and ensure every node tooling cares about has both.
- **`PartId` assignment.** At parse time, assign a unique
  compile-time integer `id` to every source-level `GrammarPart`.
  Thread `id` through every `grammarOptimizer.ts` pass per the
  contract in "PartId stability" below. Optimizer-internal parts
  with no source counterpart leave `id` undefined.
- Add an opt-in `trace?: (event: TraceEvent) => void` parameter to the
  rule-level matcher in
  [`grammarMatcher.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/actionGrammar/src/grammarMatcher.ts).
- Define the `TraceEvent` type (rule entered, part attempted, success /
  fail, slot env after step, position). Event identity must include a
  stable rule + part identifier so coverage can aggregate hits.
- Hook must be **opt-in and zero-cost when unused** (see ADR 0002
  conditions: single `if (trace !== undefined)` guard, no allocation on
  the no-trace path, bench-validated within ~1%).

**Out of this chunk; in Track A.5.** Compiler-side emission of the
`GrammarDebugInfo` sidecar (the `PartId` -> `SourceLocation` map
consumed by chunk 01 / chunk 08). A.5 depends on this chunk's
`PartId` assignment and is what unblocks B.3 / C.7.

## Type sketches (placeholders)

Not frozen; refine when the matcher work lands.

### Identifier shape

```ts
/** Rule definition identifier. Canonical: source-level rule name. */
export type RuleId = string;

/** Stable identifier for a part within a rule. Compile-time integer
 *  assigned on the source AST at parse time and propagated through
 *  every optimizer pass. See "PartId stability" below. */
export type PartId = number;
```

### PartId stability (decided 2026-04-28)

`PartId` is a **compile-time integer assigned on the source AST at
parse time** and threaded through every `grammarOptimizer.ts` pass.
Each `GrammarPart` carries an `id?: number` field; the lookup table
lives in `GrammarDebugInfo.parts: Map<PartId, SourceLocation>`
(see chunk 01; rule locations live in the sibling `rules` map).

**Why not AST paths or rule-local indices.** The optimizer reshapes
the compiled AST significantly (`dispatchifyAlternations` introduces
dispatch tables, the inliner promotes captures into `StringPart` /
`PhraseSetPart`, the factorer introduces `tailCall` `RulesPart`s,
prefix factoring rearranges parts). After optimization, compiled
parts have no stable path or rule-local index back to source. A
source-assigned id is the only encoding that survives.

**Optimizer contract.** Every optimizer pass that produces a derived
part must either (a) copy the source part's `id`, (b) pick one of
the source parts when merging, or (c) leave `id` undefined when the
resulting part is purely matcher-internal (e.g. dispatch wrappers).
Parts with `id === undefined` are invisible to coverage and
debug-info; this is acceptable because they have no source
counterpart to navigate to.

**Why integer.** Smallest possible `TraceEvent` payload (no string
allocation on the matcher hot path), cheap equality. Aligns with the
`.pdb` / source-map analogy already used by `GrammarDebugInfo` in
chunk 01. ADR 0002's ~1% no-trace bench guard plus a trace-on bench
guard the cost.

Whether `id` lives directly on `GrammarPart` or in a side table is
an implementation detail of chunk 02; the public `PartId` contract
is the integer.

### `TraceEvent`

Discriminated union covering everything the rule-level stepper and
coverage need:

```ts
export type TraceEvent =
  | RuleEnteredEvent
  | RuleExitedEvent
  | PartAttemptedEvent
  | PartMatchedEvent
  | PartFailedEvent
  | BacktrackEvent;

interface BaseEvent {
  /** Monotonic counter within a single match call. */
  readonly seq: number;
  /** Input character offset at the time of the event. */
  readonly inputPos: number;
}

export interface RuleEnteredEvent extends BaseEvent {
  readonly kind: "ruleEntered";
  readonly rule: RuleId;
  /** Depth in the rule call stack (0 = top-level). */
  readonly depth: number;
}

export interface RuleExitedEvent extends BaseEvent {
  readonly kind: "ruleExited";
  readonly rule: RuleId;
  readonly result: "matched" | "failed";
}

export interface PartAttemptedEvent extends BaseEvent {
  readonly kind: "partAttempted";
  readonly rule: RuleId;
  readonly part: PartId;
  /** Discriminator on the AST node kind: "string" | "wildcard" |
   *  "ruleReference" | "variable" | "rules". */
  readonly partKind: string;
}

export interface PartMatchedEvent extends BaseEvent {
  readonly kind: "partMatched";
  readonly rule: RuleId;
  readonly part: PartId;
  /** End offset of the matched span in the input. */
  readonly endPos: number;
  /** Slot environment snapshot. Shape TBD; placeholder is the captured
   *  variable name -> string map at this point. Empty when no slots
   *  changed. */
  readonly slots?: Readonly<Record<string, string>>;
}

export interface PartFailedEvent extends BaseEvent {
  readonly kind: "partFailed";
  readonly rule: RuleId;
  readonly part: PartId;
  readonly reason: string; // human-readable, not for programmatic use
}

export interface BacktrackEvent extends BaseEvent {
  readonly kind: "backtrack";
  /** Mirrors `BacktrackOrigin` already exported from grammarMatcher. */
  readonly origin: "wildcard" | "optional" | "alternation" | "repeat";
}
```

Coverage (chunk 08, B.3) consumes this same stream by counting
`partMatched` events per `(rule, part)` and tracking unmatched inputs
from the absence of a top-level `ruleExited.matched`.

## Non-scope

- NFA / DFA tracing (out of v1).
- Changing matcher semantics.

## Open questions

- ~~Pick option A (in-matcher hook) vs option B (AST re-walk in core).~~
  [ADR 0002](./decisions/0002-trace-hook.md) accepted option A.
- ~~Should `TraceEvent` live in `actionGrammar` or in
  `grammar-tools-core`?~~ Lives in `actionGrammar` (matcher owns the
  contract); `grammar-tools-core` re-exports.
- Do source spans round-trip through the serializer
  ([`grammarSerializer.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/actionGrammar/src/grammarSerializer.ts))?
  If not, snapshot-loaded grammars cannot offer go-to-def to source. May
  be acceptable if snapshots only target the debug panel, not the editor.
- ~~Are AST paths stable across formatter round-trip?~~ Moot: `PartId`
  is a compile-time integer (decided 2026-04-28); see "PartId
  stability" above.
- `slots` field shape on `PartMatchedEvent`: snapshot-of-changed vs
  full-environment vs structural diff. Decide once the stepper UI in
  chunk 04 has concrete needs.

## Verification

- Existing
  [`packages/actionGrammar/test`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/actionGrammar/test)
  suite stays green.
- New tests assert source spans on a representative `.agr` AST.
- New tests assert ordered trace events for a known grammar / input pair.
