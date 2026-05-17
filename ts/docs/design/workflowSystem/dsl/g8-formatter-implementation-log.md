# G8 + Formatter implementation log

Working tree: `agents-can-you-address-g8-in-the-dsl-v0-f3fc165d`
Scope: address gap item **G8** ("Comments not preserved in AST") in
`ts/docs/design/workflowSystem/dsl/dsl-v0.1-gap.md` and implement a
formatter (AST -> source / "prettier") that completes the source <->
AST round trip.

## Changes

### `ts/examples/workflow/dsl/src/lexer.ts`

- Added `LexComment` interface (`text`, `line`, `col`, `offset`, `block`).
- `lex()` now returns `{ tokens, errors, comments }`.
- `//` and `/* */` branches collect the comment lexeme (including
  delimiters) instead of discarding it. Unterminated block comments
  still record the captured text up to EOF.

### `ts/examples/workflow/dsl/src/parser.ts`

- `Parser` constructor now accepts an optional `comments: LexComment[]`
  (defaults to `[]` so existing callers compile unchanged).
- Added `takeLeadingComments()` cursor-walker.
- `parseWorkflow()` and `parseStatement()` call it and attach the
  result to the produced node's `leadingComments` (omitted when empty).
- `parseStatement` was split: outer wrapper attaches comments, inner
  `parseStatementInner` retains the original switch.

### `ts/examples/workflow/dsl/src/formatter.ts` (new)

- `format(decl, options?) -> string`.
- Configurable indent and EOL only.
- Handles all statement and expression kinds, including all built-in
  nodes (`attempts`, `map`, `filter`, `parallel`, `parallelMap`),
  template literals, destructuring `const`, switch with default arm,
  else-if chains, and ternary/binary precedence with parenthesization.
- Detects synthetic `ConstStatement` names (`_<line>_<col>`) produced
  for bare-call statements and re-emits them as expression statements.
- Emits `leadingComments` for any node that has them, preserving block
  comments with embedded newlines.

### `ts/examples/workflow/dsl/src/index.ts`

- Re-exports `format`, `FormatOptions`, `LexComment`, and `Comment`.

### `ts/examples/workflow/dsl/src/compiler.ts`, `src/visualize.ts`

- Threaded `comments` from `lex()` into `new Parser(tokens, comments)`
  so the public APIs preserve comments without further user action.

### `ts/examples/workflow/dsl/test/formatter.spec.ts` (new)

- 25 tests covering: lexer comment collection, parser attachment to
  workflow and statements (line + block), comment survival across
  round-trip, format stability (`format(parse(format(parse(s))))` ==
  `format(parse(s))`), all statement kinds, all expression kinds,
  operator precedence preservation, synthetic-const rewriting,
  destructuring, switch, attempts (with and without fallback),
  parallel, map/filter, template literals, string escaping, and the
  `indent`/`eol` options.

### Docs

- `ts/docs/design/workflowSystem/dsl/dsl-v0.1-gap.md`: G8 marked
  Resolved with a summary of the fix.
- `ts/docs/design/workflowSystem/dsl/implementation-decision.md`
  (and duplicate at `decisions/0002-comments-and-formatter.md`):
  records design choices (full-lexeme comment text, leading-only
  attachment, synthetic-name detection in formatter, precedence
  parenthesization, no width/quote-style options, no whitespace
  preservation).

## Test results

Baseline: **223 passed**.
After all changes (G8 + formatter + review fixes + 2 test-gap passes):
**286 passed** (63 new, 0 regressions, 0 skipped).

`pnpm -C examples/workflow/dsl run prettier` (the project's own
formatter check) clean.

Smoke test: both `examples/d1-standup-prep.wf` and
`examples/d8-summarize-url.wf` round-trip stably with their leading
comments preserved.

## Commit stages

1. `a931f891` Lexer + parser: comments collected and attached.
2. `976e2419` Formatter implementation and exports; compiler/visualize
   wired through.
3. `8ad1fd36` Tests for comments and formatter (25 tests).
4. `b07dd3fb` Documentation updates (gap doc, decisions, this log).
5. `c97b36b6` Address review pass 1 feedback (synthetic-name flag,
   switch defaultIndex).
6. `002a8c56` Test-gap pass 1: +16 tests, record unaddressed review
   feedback.
7. `8815ae3b` Test-gap pass 2: +19 tests (component interaction,
   format options, parser robustness).

## Review / test-gap artifacts

- `g8-review-feedback-unaddressed.md` — code-review items deliberately
  not acted upon, with rationale.
- `g8-test-gaps-unaddressed.md` — test gaps deliberately not filled,
  with rationale.

---

## Round 2: trailing comments (spec extension)

### Motivation

Round 1's spec only described `leadingComments`. Reviewers noted that
inline comments like `return x; // why` and block-tail comments like

```
return x;
// note about return
}
```

would be lost on round-trip because they had no place to attach. The
DSL spec was incomplete; this round extends both the spec and the
implementation.

### Changes

1. **AST** (`src/ast.ts`)
   - Added `trailingComments?: Comment[]` and `endLine?: number` to every
     `Statement` subtype (Const/DestructuringConst/If/Switch/Throw/
     Return/Break).
   - Added `innerComments?: Comment[]` to `WorkflowDecl` for the
     empty-body case.

2. **Parser** (`src/parser.ts`)
   - Added `lastToken` tracking in `advance()` so `parseStatement` can
     record the statement's `endLine`.
   - Added `takeInlineTrailingComments(line)` (variant of
     `takeLeadingComments`) that only consumes comments on the given
     source line.
   - Added `finalizeBlock(stmts)` which is invoked just before each
     block-closing token (`}`, `case`, `default`, EOF): it drains the
     remaining unconsumed comments and either appends them to the last
     statement's `trailingComments` or returns them when the block is
     empty.
   - Added `parseStatementsCapturingInner()` used only by `parseWorkflow`
     so the leftover from an empty workflow body becomes
     `decl.innerComments`.
   - Invoked `finalizeBlock` from `parseStatements` and
     `parseSwitchArmBody` (so case-arm trailing comments don't migrate
     onto the next case).

3. **Formatter** (`src/formatter.ts`)
   - Added `endStmt(stmt, terminator)` helper. It writes the terminator,
     then for each trailing comment splits into inline (same line as
     `stmt.endLine`, rendered with a leading space before the newline)
     vs. own-line (rendered on its own indented line after the newline).
   - All statement printers now use `endStmt` instead of `this.line(…)`.
   - `printWorkflow` emits `decl.innerComments` on their own indented
     lines after the body loop.

4. **Spec** (`docs/.../dsl-v0.1.md` §6 Comments)
   - Rewrote the Comments section to describe the three buckets
     (`leadingComments`, `trailingComments` with inline-vs-block
     semantics, `innerComments`) and the `endLine` field.

5. **Tests** (`test/trailingComments.spec.ts`, new — 24 tests)
   - Parser tests: inline trailing on const/return/throw/break, if's
     trailing-after-brace, block-end trailing on workflow body, multiple
     trailing comments at block end, switch arm trailing doesn't migrate
     to next case, inner comments on empty body, leading-vs-trailing
     boundary.
   - Formatter tests: each parser scenario above renders correctly.
   - Stability tests: assertStable on inline / block-end / inner /
     switch-arm / if-trailing / mixed-leading-and-trailing.
   - Compiler tests: trailing/inner comments don't change IR; IR JSON
     contains none of the comment fields or text.
   - Updated `test/pass2-coverage.spec.ts:stripTrivia` to also strip
     `trailingComments`, `innerComments`, and `endLine` (so the
     structural-equality property test still passes).

### Test count

- Baseline (after round 1): 286 passing.
- After this work: 310 passing (286 + 24 new).
