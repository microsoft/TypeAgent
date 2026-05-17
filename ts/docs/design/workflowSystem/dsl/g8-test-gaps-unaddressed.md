# Test gaps not acted upon

Two test-gap audit passes were performed by a general-purpose subagent
on the G8/formatter changeset. Most gaps were filled by writing tests;
this document records gaps that were deliberately *not* covered.

## Pass 1 — gaps not filled

- **Comments between parameters** (e.g.,
  `workflow w(a: string, /* note */ b: number)`). Currently re-attached
  to the first body statement during parse, and re-emitted there.
  Rationale: lossy but non-crashing; the spec does not promise
  param-internal trivia preservation. Spec'd by
  `implementation-decision.md` §2.
- **Trailing comment after the last `}` of a workflow.** Silently
  dropped. Same rationale (no `trailingComments` channel; see
  `g8-review-feedback-unaddressed.md`).
- **Long arg lists / deep nesting stress tests.** The formatter is a
  straight recursive visitor with no width-aware wrapping logic, so a
  stress test would only exercise paths already covered by simpler
  tests. No new edge case is revealed.
- **Mixed comment placements (trailing-on-same-line).** The AST type
  only carries `leadingComments`. A test would just document the
  absence of `trailingComments` rather than guard a behavior.

## Pass 2 — gaps not filled

- **Stress with the second example file `d1-standup-prep.wf`.** It
  contains a pre-existing stray trailing `}` unrelated to G8; the
  parser flags it. Including it in round-trip tests would only mask
  that unrelated issue. The other example, `d8-summarize-url.wf`, is
  exercised in the example-file round-trip test (smoke and in the
  parse(format(parse(x))) structural equivalence test).
- **Out-of-contract `FormatOptions` values** (`indent: -1`, fractional
  indents, non-string `eol`). These would be input-validation tests
  for an API contract that isn't currently documented as accepting
  them; `String.prototype.repeat` on negative numbers throws a
  `RangeError`, which is fine for misuse. Adding validation + tests is
  a separate API-hardening task.
- **Cross-workflow comment ordering when there are multiple workflows
  in a file.** The `Parser.parse()` multi-workflow path is exercised
  by existing parser tests, and comment attachment uses a single
  cursor that advances naturally across workflow boundaries. A
  dedicated test would be additive but unlikely to catch a regression
  not already covered by the single-workflow tests.

No gap from either pass revealed a real bug.

## Round 2 (trailing comments) — gaps not filled

- **Comments inside empty nested blocks** (`if (x) { /* TODO */ }`,
  `else { /* TODO */ }`, empty `case` arm body, empty
  `attempts`/`map`/`filter`/`parallel` lambda body). Round 2 surfaces
  `innerComments` only on `WorkflowDecl` (see implementation-decision
  §D7). These nested empty blocks silently drop their inner comments.
  Round 2 adds an explicit test
  (`trailingComments.spec.ts: "documented gap: comment inside empty
  if/else/switch body is dropped"`) demonstrating and pinning this
  behavior. Adding `innerComments` to every block-holding AST node was
  judged too invasive for a rarely-needed case; users with a TODO
  body should write a placeholder statement (`return null;` etc.) or
  put the TODO above the block.

- **Comment between `}` and `else` keyword**
  (`if (x) { ... } /* note */ else { ... }`). Currently this comment
  is captured by `finalizeBlock` of the `then` block (it's
  unconsumed before the `else` keyword, but `else` is not a stop
  token for the inner block parser — the inner block stops at `}`
  and the comment lives after `}`). Specifically, since `then`'s
  closing `}` has already been consumed when we look for `else`,
  the comment becomes a leading comment of the first statement of
  `else`. This is a reasonable but non-ideal attachment;
  systematically modeling "between-brace comments" was out of scope.

## Round 2 (trailing comments) — review feedback acted upon

- Pass 1: no significant bugs.
- Pass 2: documentation gap for empty-block comment loss — addressed
  by adding a pinning test and this section.
