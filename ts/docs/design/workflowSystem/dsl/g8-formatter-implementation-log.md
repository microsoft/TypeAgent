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
After changes: **248 passed** (25 new, 0 regressions).

`pnpm -C examples/workflow/dsl run prettier` (the project's own
formatter check) clean.

Smoke test: both `examples/d1-standup-prep.wf` and
`examples/d8-summarize-url.wf` round-trip stably with their leading
comments preserved.

## Commit stages

1. Lexer + parser: comments collected and attached.
2. Formatter implementation and exports; compiler/visualize wired
   through.
3. Tests for comments and formatter.
4. Documentation updates (gap doc, decisions, this log).
