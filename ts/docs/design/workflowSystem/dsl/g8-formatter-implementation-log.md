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

`test/pass2-coverage.spec.ts:stripTrivia` was updated to strip
`trailingComments`, `innerComments`, and `endLine` alongside the
original `leadingComments`/`loc`/`pos` so the structural-equality
property test (`parse(format(parse(src))) ≡ parse(src)`) continues
to hold.

`pnpm -C examples/workflow/dsl run prettier` (the project's own
code-style check) is clean.

## Test count progression

| Stage | Passing |
| --- | --- |
| Baseline (pre-G8) | 223 |
| G8 + formatter + review fixes + 2 test-gap passes (round 1) | 286 |
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
  + 19 + 19 from round 2).

Items deliberately *not* acted upon (with rationale) live in:

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
15. `8baf8599` finalize log (this file's previous revision).
