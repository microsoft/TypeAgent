# G8 + Formatter implementation log

Working tree: `agents-can-you-address-g8-in-the-dsl-v0-f3fc165d`

Scope: address gap item **G8** ("Comments not preserved in AST") in
`dsl-v0.1-gap.md` and implement a formatter (AST → source / "prettier")
that completes the source ↔ AST round trip. The work was carried out
in two rounds; the second round extended the originally-incomplete spec
to cover trailing and inner comments. This log describes the final
state and surfaces only the differences that matter for review.

## What ships

The workflow DSL lexer now keeps comments. The parser attaches them to
three buckets on the AST:

- **`leadingComments`** on any node — comments that appear immediately
  before the node.
- **`trailingComments`** on every `Statement` — comments that appear
  after a statement. A comment is _inline trailing_ if its source line
  equals the statement's `endLine` (`return x; // why`) and _block-end
  trailing_ otherwise (a comment that appears between the last
  statement of a block and the block's closing `}`, `case`, or
  `default`). The two share the same array; the formatter decides
  rendering at print time by comparing `comment.pos.line` against the
  statement's `endLine`.
- **`innerComments`** on `WorkflowDecl` — comments inside an otherwise
  empty workflow body that have no statement to attach to.

The formatter (`format(decl, options?) -> string`) re-emits a parsed
workflow as canonical DSL source with comments preserved in their
attached positions. It is deterministic, configurable only on `indent`
and `eol`, and stable: `format(parse(format(parse(s))))` always equals
`format(parse(s))` for all supported comment shapes (including
multi-line block comments).

## Code changes

### `src/lexer.ts`

- Added `LexComment` interface (`text`, `line`, `col`, `offset`,
  `block`). The `text` field stores the **full lexeme including
  delimiters** (`// foo`, `/* foo */`) so the serializer can emit
  verbatim with no reconstruction step.
- `lex()` now returns `{ tokens, errors, comments }`. The `//` and
  `/* */` branches collect the lexeme instead of discarding it.
  Unterminated block comments still record the captured text up to EOF.

### `src/ast.ts`

- `WorkflowDecl` gained optional `leadingComments?: Comment[]` and
  `innerComments?: Comment[]`.
- Every `Statement` subtype (`ConstStatement`, `DestructuringConst`,
  `IfStatement`, `SwitchStatement`, `ThrowStatement`, `ReturnStatement`,
  `BreakStatement`) gained optional `leadingComments?`,
  `trailingComments?`, and `endLine?: number`.
- `ConstStatement` gained `isSynthetic?: boolean` (set by the parser
  when wrapping a bare expression statement; replaces the original
  regex-on-name heuristic — see decision §3).
- `SwitchStatement` gained `defaultIndex?: number` (records where the
  `default:` arm appeared in source order so the formatter can
  reconstruct fallthrough faithfully).

### `src/parser.ts`

- `Parser` constructor now accepts an optional `comments: LexComment[]`
  (defaults to `[]` so existing callers compile unchanged).
- Added a cursor (`commentIdx`) into the lexer's comment list and
  these helpers:
  - `takeLeadingComments()` — drains comments whose offset precedes
    the next token's offset.
  - `takeInlineTrailingComments(line)` — variant that only consumes
    comments whose line equals the just-parsed statement's `endLine`.
    The same-line guard is what keeps leading-vs-trailing semantics
    distinct (see decision §9).
  - `finalizeBlock(stmts)` — drains remaining comments before the next
    block-closing token (`}`, `case`, `default`, EOF), appends them to
    the last statement's `trailingComments`, or returns them if the
    block is empty.
- Added `lastToken` tracking in `advance()` so the wrapper that calls
  `parseStatementInner()` can record each statement's `endLine`.
- `parseStatement` was split: the outer wrapper attaches
  `leadingComments`, sets `endLine`, and takes `trailingComments`;
  the inner `parseStatementInner` retains the original switch.
- `parseStatements` calls `finalizeBlock` before returning.
- `parseSwitchArmBody` also calls `finalizeBlock` — without this, a
  comment at the tail of a `case` body would migrate onto the next
  `case`'s leading comments (a subtle semantic shift the round-1
  reviewers flagged; see decision §8).
- `parseWorkflow` uses `parseStatementsCapturingInner()` to recover
  the leftover from an empty body and attach it as
  `decl.innerComments`.

### `src/formatter.ts` (new)

- `format(decl, options?) -> string`. Options: `indent` (default 4)
  and `eol` (default `\n`).
- Handles every statement and expression kind, including all built-in
  nodes (`attempts`, `map`, `filter`, `parallel`, `parallelMap`),
  template literals, destructuring `const`, switch with default arm
  preserved at its original position via `defaultIndex`, else-if
  chains, and ternary/binary precedence with parenthesization.
- Emits bare expression statements (parser-wrapped synthetic consts)
  as expressions when `s.isSynthetic` is set, keeping `format`
  → `parse` → `format` stable.
- Comment rendering:
  - `printLeadingComments` emits leading comments on their own
    indented line.
  - `endStmt(stmt, terminator)` writes the terminator, then for each
    trailing comment splits into inline (same line as `stmt.endLine`,
    rendered with a leading space before the newline) vs. own-line
    (rendered on its own indented line after the newline). All
    statement printers use it instead of `this.line(…)`.
  - `printOwnLineComments` emits a list of comments at the current
    indent (used for `WorkflowDecl.innerComments`).
  - `writeMultilineCommentText` writes the first line through `write()`
    (so the current indent applies) and pushes continuation lines
    verbatim via `parts.push()` (so the comment's own internal
    alignment is preserved). Without this helper, a block comment
    spanning multiple lines accumulated `depth * indent` extra spaces
    on every reformat — this was the only real bug found across all
    review and test-gap passes.

### `src/index.ts`, `src/compiler.ts`, `src/visualize.ts`

- `index.ts` re-exports `format`, `FormatOptions`, `LexComment`, and
  `Comment`.
- `compile()` and `visualize()` thread `comments` from `lex()` into
  `new Parser(tokens, comments)` so the public APIs preserve comments
  with no further user action. Neither pipeline copies comments into
  IR or graph output.

## Spec changes

`dsl-v0.1.md` §6 "Comments" was rewritten to describe the three
buckets (`leadingComments`, `trailingComments` with inline-vs-block
semantics via `endLine`, `innerComments`), supported comment forms
(`//`, `/* */`), and rendering rules. The pre-existing one-sentence
description of `leadingComments` did not say where trailing or inner
comments live; closing that ambiguity was the explicit goal of round 2.

## Test changes

Two spec files contain the new coverage:

- `test/formatter.spec.ts` — round-1 tests (lexer collection, parser
  attachment, all statement/expression kinds, precedence preservation,
  synthetic-const rewriting, switch, attempts with and without
  fallback, parallel, map/filter, template literals, string escaping,
  `indent`/`eol` options).
- `test/trailingComments.spec.ts` — round-2 tests (inline trailing on
  every Statement kind, block-end trailing inside workflow body and
  switch arm, multiple trailings, leading-vs-trailing boundary, inner
  comments on empty body, parser/formatter/stability triples for each
  shape, multi-line statements, mixed `//` + `/* */` inline trailings,
  multi-line block comment stability, FormatOptions interaction with
  trailing comments, built-in node body trailings, graphExtractor
  transparency, compiler IR non-leakage, degenerate comment lexemes
  (`/**/`, `//`, `// /*`, `/* // */`), column preservation,
  multi-workflow trailing preservation, pathological 1000-comment
  stress, and a 3-pass property test on the union of all three
  comment kinds).

`test/commentNeutrality.spec.ts:stripTrivia` was updated to strip
`trailingComments`, `innerComments`, and `endLine` alongside the
original `leadingComments`/`loc`/`pos` so the structural-equality
property test (`parse(format(parse(src))) ≡ parse(src)`) continues
to hold.

`pnpm -C examples/workflow/dsl run prettier` (the project's own
code-style check) is clean.

## Test count progression

| Stage                                                               | Passing |
| ------------------------------------------------------------------- | ------- |
| Baseline (pre-G8)                                                   | 223     |
| G8 + formatter + review fixes + 2 test-gap passes (round 1)         | 286     |
| Trailing/inner comments + review pass + 2 test-gap passes (round 2) | **351** |

Smoke test: both `examples/d1-standup-prep.wf` and
`examples/d8-summarize-url.wf` round-trip stably with all their
comments preserved.

## Review and test-gap passes

For both rounds the same workflow was followed: implement → commit in
stages → run two code-review subagent passes addressing bugs as found
→ run two general-purpose test-gap subagent passes filling gaps as
found. Net result across all four review passes and all four
test-gap passes:

- 4 real bugs found (3 in round 1, 1 in round 2) and fixed:
  - Round 1, review pass 1: synthetic-name regex collision when a
    user variable matched `_<num>_<num>`. Fixed by storing
    `ConstStatement.isSynthetic` at parse time.
  - Round 1, review pass 1: switch default arm reordering. Fixed by
    storing `SwitchStatement.defaultIndex`.
  - Round 1, review pass 2: none.
  - Round 2, review pass 1 + 2: only one documentation gap (empty
    nested blocks dropping inner comments); pinned by tests, recorded
    in `g8-test-gaps-unaddressed.md`.
  - Round 2, test-gap pass 1: multi-line block comments accumulated
    `depth * indent` extra spaces per reformat. Fixed by
    `writeMultilineCommentText()`.
  - Round 2, test-gap pass 2: none.
- 5 batches of new tests written (16 + 19 from round 1, then 24
  - 19 + 19 from round 2).

Items deliberately _not_ acted upon (with rationale) live in:

- `g8-review-feedback-unaddressed.md` — review feedback.
- `g8-test-gaps-unaddressed.md` — test gaps.

## Commit sequence

Round 1:

1. `a931f891` lexer + parser comment collection and attachment.
2. `976e2419` formatter implementation; compiler/visualize threading.
3. `8ad1fd36` formatter spec (25 tests).
4. `b07dd3fb` docs (gap doc, decisions, this log).
5. `c97b36b6` review pass 1 fixes (`isSynthetic`, `defaultIndex`).
6. `002a8c56` test-gap pass 1 (+16 tests, unaddressed-feedback doc).
7. `8815ae3b` test-gap pass 2 (+19 tests for cross-component
   interaction, format options, parser robustness).
8. `31967f93` test-gap unaddressed doc + log update.

Round 2:

9. `c582f275` ast/parser/formatter/spec — trailing + inner comments.
10. `83cbf929` trailing-comments tests (24).
11. `9f5e6e91` docs: log + decisions (D6–D9).
12. `d608e1ce` review pass 2: pin empty-block comment loss.
13. `944696e3` test-gap pass 1: +19 tests + multi-line indent fix.
14. `0758b69b` test-gap pass 2: +19 additional tests.
15. `8baf8599` finalize log (round-2 revision).

Round 3 (this revision):

16. `cc635e58` ast/parser/formatter — full comment fidelity (params,
    empty nested blocks, `}`/`else` gap).
17. `1868764e` tests: replace 3 pinning tests with positive round-trip
    tests, add new suites for round-3 surfaces. 351 → 364 tests.
18. `09031f04` docs: spec §6, decisions §7 retraction + §13/§14/§15,
    log + unaddressed-* updates.
19. `975a07d5` review pass 2 fix: parser scoops same-line comments on
    BOTH sides of the param comma; formatter emits inline trailing
    AFTER the comma uniformly (matches // line-comment placement).
20. `a5d3792c` test-gap pass 1: +20 tests (multi-line block-comment
    indent invariant across new slots, else-if chain elseLeading at
    every junction, secondary built-in surfaces, param edge cases,
    stripTrivia structural equivalence). 364 → 384 tests, no bugs.
21. `14aec90f` test-gap pass 2: +17 tests (adversarial angles —
    same-param leading+trailing, empty switch with only inner
    comment, pre-`case` and pre-`workflow` comments, stacked //'s,
    degenerate /**/ and //, template-literal `}` not triggering else,
    3-round convergence, nested built-in attachment level, missing
    endLine fallback). 384 → 401 tests, no bugs.

## Round 3 — closing the comment-fidelity gaps

Round 2 shipped with three known gaps, all flagged in
`g8-test-gaps-unaddressed.md` and pinned with negative tests:

1. Comments between parameters.
2. Comments inside empty nested blocks (then/else/case/default and
   every built-in lambda body).
3. Comments between `}` of the then block and the `else` keyword.

Round 3 closes all three by extending the AST with per-position
`*InnerComments` / `elseLeadingComments` buckets, threading the parser
to capture them, and teaching the formatter to emit them.

What changed:

- **`src/ast.ts`** — added `WorkflowDecl.paramInnerComments`,
  `ParamDecl.leadingComments` / `trailingComments` / `endLine`,
  `IfStatement.thenInnerComments` / `elseInnerComments` /
  `elseLeadingComments`, `SwitchStatement.defaultInnerComments`,
  `SwitchArm.innerComments`, `AttemptsNode.bodyInnerComments` (and on
  `fallback`), `MapNode` / `FilterNode` / `ParallelMapNode`
  `bodyInnerComments`, `ParallelNode.bodies[i].bodyInnerComments`.
- **`src/parser.ts`** — `parseParamList` rewritten to capture leading,
  inline-trailing, and end-of-list comments and report
  `paramInnerComments` separately for empty lists. After the review
  pass it now scoops same-line comments on BOTH sides of the comma so
  `// line trailings` and `/* block */` placements both round-trip
  to the same param. `parseIfStmt`, `parseSwitchStmt`/
  `parseSwitchArmBody`, and every built-in parser route through
  `parseStatementsCapturingInner` and an `extractArrowBodyInner`
  helper. `parseIfStmt` snapshots `commentIdx` before reading ahead
  for `else` and rolls back on a no-`else` outcome so a trailing-`}`
  comment without `else` becomes the IfStatement's own
  `trailingComments` rather than being stolen.
- **`src/formatter.ts`** — `printParamList` switches to multi-line
  layout (with unconditional trailing comma) whenever any parameter
  carries comments or `paramInnerComments` is set. Inline trailing
  comments are emitted AFTER the comma (uniform for // and /* */).
  `writeElseLeading` emits block comments inline (`} /* x */ else`)
  and forces a line break for line comments. `printBlockBody` now
  accepts an optional `innerComments` array and emits it inside an
  empty `{ }`. The IfStatement / SwitchStatement / SwitchArm /
  built-in cases all thread the new buckets through.
- **`test/trailingComments.spec.ts`** — the 3 "documented gap"
  pinning tests are inverted into positive round-trip tests, and 13
  new tests cover the new surfaces (parameter leading/trailing/inner,
  empty-block inner across every block-bearing AST node, and the
  three `}`/`else` shapes).
- **`test/commentFidelity.spec.ts`** (pass 1) and
  **`test/commentEdgeCases.spec.ts`** (pass 2) — 37 additional tests
  across the two test-gap audits.
- **`test/commentNeutrality.spec.ts`** — `stripTrivia` now also strips
  `paramInnerComments`, `thenInnerComments`, `elseInnerComments`,
  `elseLeadingComments`, `defaultInnerComments`, and
  `bodyInnerComments`.
- **`implementation-decision.md`** — §7 (the round-2
  "innerComments lives only on WorkflowDecl" decision) is annotated
  as superseded; new sections D13 (param-comment layout), D14
  (`elseLeadingComments` rendering), and D15 (param-list capture
  rolls over commas) document the round-3 decisions.

Round 3 ran the same review + test-gap workflow as the prior rounds:
two code-review subagent passes (pass 1 clean, pass 2 found the
param-trailing-after-comma migration bug fixed in `975a07d5`) and two
general-purpose test-gap subagent passes (no bugs in either; +20
then +17 tests). Total test count 351 → 401.


## Round 4 — layout fidelity + remaining comment-fidelity slots

Round 3 closed the comment slots that had no AST representation but
deferred (and in some cases pinned with negative tests) four further
items that surfaced during the doc-review work:

1. `SwitchStatement` had no inner-comment slot — a comment inside
   `switch (x) { /* nothing */ }` migrated to the next statement.
2. `SwitchArm` had no pre-`case` slot — a comment immediately before
   `case 2:` was attached as a trailing comment on the previous arm's
   last statement, away from its semantic home.
3. `ObjectType` had no support for field comments or for preserving
   the original multi-line layout (it was always re-emitted inline).
4. `WorkflowDecl` parameter lists and `IfStatement.else` were always
   canonicalised to a single layout regardless of what the source
   used. Per user feedback we now preserve the source's choice
   between inline and multi-line, falling back to width-driven
   wrapping when a single line would exceed `printWidth`.

Implementation:

- **`src/ast.ts`** — added `WorkflowDecl.paramListMultiLine`,
  `IfStatement.elseOnNewLine`, `ObjectType.multiLine`,
  `ObjectType.innerComments`,
  `ObjectTypeField.leadingComments` / `trailingComments` / `endLine`,
  `SwitchStatement.innerComments`,
  `SwitchStatement.defaultLeadingComments`, and
  `SwitchArm.leadingComments`.
- **`src/parser.ts`** —
  - `parseWorkflow` tracks LParen / RParen line and first-param line
    to set `paramListMultiLine` (true only when the list itself uses
    newlines, NOT when a single param's type spans multiple lines).
  - `parseIfStmt` records the `}` and `else` token lines and sets
    `elseOnNewLine` when they differ.
  - `parseSwitchStmt` drains pre-keyword comments into the next arm's
    `leadingComments` (or `defaultLeadingComments`); residual comments
    before `}` go to `SwitchStatement.innerComments`.
  - `parseSwitchArmBody` no longer drains all block-end comments — it
    only captures **inline-trailing** (same-line as last stmt's
    `endLine`); own-line comments fall through to the outer switch
    loop and become the next arm's leading.
  - `parseObjectType` captures field-level leading/trailing/inner
    comments on both sides of the `,` and records `multiLine` based
    on the same first-field-line heuristic.
- **`src/formatter.ts`** —
  - New `FormatOptions.printWidth` (default 100). Pass `Infinity` to
    disable width-driven wrapping; pass `0` to always wrap when an
    alternative multi-line layout exists.
  - New `currentColumn()` and `measure(fn)` helpers. `measure` runs a
    sub-emission against a temporary buffer and returns the max line
    length, used to decide between inline and multi-line.
  - `printParamList`: multi-line iff (any param has comments) OR
    (`paramListMultiLine` is set) OR (projected width > printWidth).
  - `printObjectType`: same decision but on the object type's fields.
    The multi-line layout uses trailing-comma fields with leading /
    inline-trailing / own-line-after-trailing slots, mirroring the
    param-list layout.
  - `writeElseLeading(forceNewLine)`: caller passes `forceNewLine`
    when the AST records `elseOnNewLine` or width would overflow.
  - The IfStatement case computes `forceNewLine` itself; when neither
    the AST nor a `//` line comment forces a break, it measures the
    inline projection `} <leading> else {` and breaks only if that
    overflows `printWidth`.
  - The SwitchStatement emitter prints `innerComments` before the
    first arm, `defaultLeadingComments` before `default:`, and each
    arm's `leadingComments` before `case ...:`.
- **`test/layoutFidelity.spec.ts`** (new, 21 tests) —
  pins all of the above, including the `printWidth` boundary cases.
- **`test/trailingComments.spec.ts`** — the "comment between arms"
  test was retargeted to assert the new (correct) attachment point:
  next arm's `leadingComments`.
- **`test/commentEdgeCases.spec.ts`** — the two pinning tests
  (`"empty switch with only inner comment"` and
  `"comment before a case keyword"`) are inverted into positive
  round-trip tests under `"round 4: ..."` describes.
- **`test/formatter.spec.ts > else-if chain`** — the input source
  was rewritten to use the single-line `} else if` shape (the test
  was previously asserting that the formatter canonicalises a
  multi-line input to single-line; with layout preservation that
  canonicalisation no longer happens).
- **`test/commentNeutrality.spec.ts`** — `stripTrivia` now also strips
  `defaultLeadingComments`, `paramListMultiLine`, `elseOnNewLine`,
  and `multiLine` so AST-equivalence comparisons remain stable.
- **`implementation-decision.md`** — new sections D16 (layout
  preservation), D17 (`printWidth`), and D18 (ObjectType comments)
  document the round-4 decisions; D7 already noted in round 3 as
  superseded.

Test count progression for round 4:
- 401 (round 3 final) → 422 (round 4 final), all green.

## Commit sequence (round 4)

22. `4036c0df` — G8 round 4: doc cleanup (dedupe `g8-test-gaps-unaddressed.md`,
    renumber `implementation-decision.md`, drop the unmaintained
    `decisions/0002-comments-and-formatter.md` mirror, document the
    round-3 review pass-2 bug + fix in `g8-review-feedback-unaddressed.md`).
22. `89da0190` — G8 round 4: layout fidelity + remaining comment-fidelity
    slots (ast/parser/formatter + minimal test updates).
22. `f8b0263d` — G8 round 4: +21 tests in `layoutFidelity.spec.ts`
    + tighter parser heuristic for `paramListMultiLine` /
    `ObjectType.multiLine` to avoid false positives when a nested type
    spans multiple lines.

## Round 4 — addendum: content-fidelity oracle (`contentFidelity.spec.ts`)

Added a dedicated 34-test suite that directly encodes the user's
"complete fidelity for any content (except spacing and line breaks)"
rule, organised in three layers:

1. **Data multiset oracle** — every Identifier / String / Number /
   Boolean / Null / Template literal value and every comment lexeme
   must appear the same number of times in `format(parse(src))` as
   in `src`. This is run over all `examples/*.wf` plus 11 per-feature
   fixtures plus a kitchen-sink doc.
2. **Strict token-stream oracle** — exact ordered (kind, value)
   sequence over the per-feature fixtures that avoid documented
   canonicalization triggers (so they keep block-bodied arrows, stay
   under printWidth, etc.).
3. **Documented canonicalizations** — pinned tests for expression-
   bodied → block-bodied arrow wrapping and multi-line list
   trailing-comma insertion (both intentional, documented in
   implementation-decision.md).

Plus two `test.failing` pins that document gaps the oracle
discovered:
- End-of-file comments after the workflow's closing `}` are
  dropped (parseSingle has no trailing-trivia slot).
- `attempts(...)` fallback callbacks with an empty parameter list
  `() =>` are canonicalised to `(err) =>` (the parser defaults the
  missing param name to `"err"`).

These gaps are tracked in `g8-test-gaps-unaddressed.md` under
"Content-fidelity gaps discovered by `test/contentFidelity.spec.ts`".

Test count: 422 → 456 (+34).

## Commit sequence (round 4, continued)

22. `bbb…` — G8: rename round/pass-numbered test files and describes
    to topic names (commentFidelity / commentEdgeCases /
    layoutFidelity / commentNeutrality).
22. `???` — G8: add `contentFidelity.spec.ts` (data + strict-token +
    pinned-canonicalization layers); document two newly-discovered
    fidelity gaps as `test.failing` pins.
