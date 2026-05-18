# Test gaps not acted upon

Four general-purpose subagent test-gap audits were run across rounds 1
and 2 of the G8 work. Round 3 did not add new audits but closed the
three deliberate gaps documented below, replacing their pinning tests
with positive round-trip tests.

| Round | Pass | New tests added | Bugs found |
| --- | --- | --- | --- |
| 1 | 1 | 16 | 0 |
| 1 | 2 | 19 | 0 |
| 2 | 1 | 19 | 1 (multi-line block comment indent — fixed) |
| 2 | 2 | 19 | 0 |
| 3 | — | 13 | 0 |

This document records gaps that were deliberately *not* covered, with
rationale. Items are grouped by category (not by round) so reviewers
can see the surface area in one pass.

## Comment-attachment edge cases (closed in round 3)

> The three sub-items below were deliberate omissions during rounds 1
> and 2 and were closed in round 3 (full comment fidelity). They are
> kept here for traceability — the pinning tests have been inverted
> into positive round-trip tests in `test/trailingComments.spec.ts`.

### ~~Comments between parameters~~ (closed round 3)

`workflow w(a: string, /* note */ b: number)` now preserves the
comment via `ParamDecl.leadingComments` / `trailingComments` and
`WorkflowDecl.paramInnerComments` for the empty-list case. The
formatter switches to multi-line layout as soon as any param has a
comment. See decision §13, §15.

### ~~Comments inside empty nested blocks~~ (closed round 3)

Every block-bearing AST node now has an `*InnerComments` field
(`thenInnerComments`, `elseInnerComments`, `defaultInnerComments`,
`SwitchArm.innerComments`, `bodyInnerComments` on every built-in
node). The formatter emits these inside the otherwise-empty `{ }`.
See decision §7 (superseded) and the positive round-trip tests under
`"round 3: comments inside empty nested blocks are preserved"` in
`test/trailingComments.spec.ts`.

### ~~Comment between `}` and `else` keyword~~ (closed round 3)

`IfStatement.elseLeadingComments` now captures these. The formatter
emits block comments inline (`} /* note */ else`) and line comments
on their own line with `else` on a fresh line. See decision §14 and
the suite `"round 3: comment between } and else"`.

## Formatter / FormatOptions

### Out-of-contract `FormatOptions` values

`indent: -1`, fractional indents, non-string `eol`, `eol: ""`, etc.
These would be input-validation tests for an API contract that isn't
currently documented as accepting them; `String.prototype.repeat` on
negative numbers throws a `RangeError`, which is fine for misuse.
Adding validation + tests is a separate API-hardening task.

### Long arg lists / deep nesting stress

The formatter is a straight recursive visitor with no width-aware
wrapping logic, so a stress test would only exercise paths already
covered by simpler tests. A pathological 1000-trailing-comments test
was added to cover the comment-emission loop specifically; deeper
expression-tree stress would be additive.

## Examples / smoke

### Stress with `examples/d1-standup-prep.wf`

This file contains a pre-existing stray trailing `}` unrelated to G8
that the parser flags as an error. Including it in round-trip tests
would only mask that unrelated issue. The other example
(`d8-summarize-url.wf`) is exercised in the example-file round-trip
test (smoke + structural-equivalence).

## Visualization

### Visualize API trailing-comment passthrough

`src/visualize.ts` has no API surface that emits comments —
comments are intentionally stripped at the `extractGraph` boundary,
already covered by an existing test. There is no public function
where comments could be carried through.

## Summary

No deliberately-skipped gap revealed a real bug across any of the
three rounds. The only bug found by the test-gap audits (multi-line
block comment indent accumulation, round 2 pass 1) was acted upon —
fixed via `writeMultilineCommentText()` (decision §10) and pinned by
`"multi-line block comment as block-end trailing is round-trip
stable"`.


## Formatter / FormatOptions

### Out-of-contract `FormatOptions` values

`indent: -1`, fractional indents, non-string `eol`, `eol: ""`, etc.
These would be input-validation tests for an API contract that isn't
currently documented as accepting them; `String.prototype.repeat` on
negative numbers throws a `RangeError`, which is fine for misuse.
Adding validation + tests is a separate API-hardening task.

### Long arg lists / deep nesting stress

The formatter is a straight recursive visitor with no width-aware
wrapping logic, so a stress test would only exercise paths already
covered by simpler tests. A pathological 1000-trailing-comments test
was added to cover the comment-emission loop specifically; deeper
expression-tree stress would be additive.

## Examples / smoke

### Stress with `examples/d1-standup-prep.wf`

This file contains a pre-existing stray trailing `}` unrelated to G8
that the parser flags as an error. Including it in round-trip tests
would only mask that unrelated issue. The other example
(`d8-summarize-url.wf`) is exercised in the example-file round-trip
test (smoke + structural-equivalence).

## Visualization

### Visualize API trailing-comment passthrough

`src/visualize.ts` has no API surface that emits comments —
comments are intentionally stripped at the `extractGraph` boundary,
already covered by an existing test. There is no public function
where comments could be carried through.

## Summary

No deliberately-skipped gap revealed a real bug across either round.
The only bug found by the test-gap audits (multi-line block comment
indent accumulation, round 2 pass 1) was acted upon — fixed via
`writeMultilineCommentText()` (decision §10) and pinned by
`"multi-line block comment as block-end trailing is round-trip
stable"`.

## Round 3 test-gap pass 1

Round 3 surfaces audited (`test/round3-gaps.spec.ts`, +20 tests, all
green; no implementation changes). Areas considered but **not** turned
into new tests:

### Nested object-type parameter with comments

`workflow w(x: { /* note */ foo: number }): ...` — the parser
`parseTypeExpr` path has no hook for comments inside an `ObjectType`
field list, and that surface is outside round-3 scope (round 3 was
strictly about block bodies + parameter list + `}` else gap). Adding
a test here would either pass trivially (comment dropped by lexer
position) or document a separate, unrelated gap.

### Inner comments in built-in **expression-position** nesting

E.g. `const x = parallel(() => map(xs, (i) => { /* hi */ }), () => {})`.
The inner `map(...)` body uses the same `printBlockBody` /
`bodyInnerComments` slot already exercised by the top-level
"comment inside empty map body" test. The expression-nesting context
adds no new emitter path — the formatter recurses via `printExpr`
into the inner built-in unchanged.

### `assertStable` × 3-pass for every surface

The new file uses a 3-pass `assertStable` (`format = format =
format`) and also has a dedicated `stripTrivia(parse(format(parse)))`
equivalence describe. Adding a 4th- or 5th-pass test wouldn't catch
any additional class of bug — non-idempotence shows up by pass 2.

### Inline trailing comment on a parameter declared with an inline
object type

Tests would mostly exercise the type-printer and not the round-3
comment slots, since the trailing-after-comma path is already
covered by the array-type variant (`xs: string[], // a list`).

### Single-pass coverage of `endLine` after every type-expression
shape

`endLine` is sourced from `this.lastToken.line` after `parseTypeExpr`
returns, so the only variation is whether the last token was the
type's identifier (NamedType), `]` (ArrayType), or `}` (ObjectType).
The array-type test pins the `]` case; the named-type case is the
common path under every other param test; the object-type case
again belongs to a separate gap (above).
