# Test gaps not acted upon

Four general-purpose subagent test-gap audits were run across the two
rounds of G8 work:

| Round | Pass | New tests added | Bugs found |
| --- | --- | --- | --- |
| 1 | 1 | 16 | 0 |
| 1 | 2 | 19 | 0 |
| 2 | 1 | 19 | 1 (multi-line block comment indent — fixed) |
| 2 | 2 | 19 | 0 |

This document records gaps that were deliberately *not* covered, with
rationale. Items are grouped by category (not by round) so reviewers
can see the surface area in one pass.

## Comment-attachment edge cases (intentional limits)

### Comments between parameters

`workflow w(a: string, /* note */ b: number)` parses cleanly but the
`/* note */` is reattached to the first body statement as a leading
comment. The spec does not promise param-internal trivia preservation.
Adding a `paramComments` channel would touch `ParamDecl` for a
rarely-needed case.

### Comments inside empty nested blocks

`if (x) { /* TODO */ }`, empty `else { /* TODO */ }`, empty `case`
arm body, and empty `attempts`/`map`/`filter`/`parallel` lambda
bodies all silently drop their inner comments. `innerComments` only
exists on `WorkflowDecl` (decision §7).

Pinned by three tests under `"documented gap: comments inside empty
nested blocks are dropped"` in `test/trailingComments.spec.ts`. Users
who want a TODO body should write a placeholder statement
(`return null;`) or put the TODO above the block.

### Comment between `}` and `else` keyword

`if (x) { ... } /* note */ else { ... }` currently captures the
comment as the leading comment of the first statement of `else`
(because the `then`'s closing `}` is consumed before we look for
`else`, and the comment lives after `}`). This is a reasonable but
non-ideal attachment; systematically modeling "between-brace
comments" was out of scope.

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
