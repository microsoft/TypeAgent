# Implementation decisions: G8 (comment preservation) and DSL formatter

This document records design choices that are not obvious from the spec
or the code itself, so reviewers can understand the rationale without
re-deriving it.

## 1. `LexComment.text` stores the full comment lexeme (delimiters included)

`dsl-v0.1.md` section 6 declares only that comments are stored as
`Comment { text, pos }`. It does not say whether `text` is the content
between delimiters or the full source span.

Decision: store the full lexeme — `// foo` rather than ` foo`, and
`/* foo */` rather than ` foo `. Rationale:

- A round-trip serializer can emit the comment verbatim with no
  reconstruction step (no ambiguity about leading/trailing whitespace,
  no need to remember "this was a block comment").
- Distinguishing the comment kind is cheap (also exposed as
  `LexComment.block`).
- Cost is two-character overhead per comment, which is negligible.

If a consumer wants the content only, they can strip the leading two
characters (and trailing two for block comments) trivially.

## 2. Comments are accumulated only as `leadingComments`

The spec describes `leadingComments` as comments "attached to the
following AST node". The parser implements exactly this by maintaining
a cursor into the lexer's comment list and, before parsing each top-level
construct (workflow declaration) or statement, taking every comment
whose offset precedes the next token's offset.

Notable consequences:

- A comment that follows the last statement in a block but before the
  closing `}` will be attached to the next outer construct (or dropped
  if there is none). This matches the spec's strict "leading" semantics
  but means a trailing comment inside a workflow body, after the final
  `return`, would attach to the next workflow (or be discarded for the
  last workflow in a file).
- Inline trailing comments on a statement line (e.g.,
  `const x = a; // note`) are attached as leading comments of the
  *next* statement, not as a trailing comment on the current one.
  This is the simplest interpretation of the spec; introducing a
  `trailingComments` channel is left as future work (tracked under the
  unaddressed-feedback log if reviewers request it).

## 3. Bare task calls are formatted as expression statements

Per gap item G9, the parser wraps bare statement-position task calls
(e.g., `audit.log(x);`) as a `ConstStatement` with a synthetic name of
the form `_<line>_<col>`. The formatter detects that pattern
(`/^_\d+_\d+$/`) and emits the value alone with a trailing semicolon
instead of `const _12_5 = audit.log(x);`. This:

- Keeps `format` -> `parse` -> `format` stable; without this, the
  synthetic name would re-emerge in the source and gradually drift if
  the formatted output were re-parsed at a different column.
- Matches the surface syntax the user originally wrote.

The downside is a small coupling between the formatter and the parser's
naming convention. If G9 is ever resolved by adding a dedicated
`ExpressionStatement` AST node, this heuristic can be deleted.

## 4. Formatter precedence handling

Expression printing uses an explicit precedence table mirroring the
parser's precedence climber. The right operand of a binary operator is
printed with `parentPrec = myPrec + 1` to force parentheses around
same-precedence subexpressions on the right side (preserving left
associativity in the output). Without the `+ 1`, `(1 - 2) - 3` would
re-emit as `1 - 2 - 3` and be re-parsed identically — but
`1 - (2 - 3)` would also drop its parens and silently change meaning.

## 5. Formatter is deterministic and configurable on indentation only

`FormatOptions` exposes only `indent` (default 4 spaces) and `eol`
(default `\n`). No options for line width, brace style, trailing
commas, or quote style. Rationale:

- Keeps the canonical-text contract simple: AST + options yields one
  textual representation.
- Avoids reintroducing the "many ways to format the same DSL" problem
  that motivated calling the output canonical in the first place.

## 6. Formatter is not a full text-to-text pretty-printer

The formatter operates on an AST, not on source text. It does not
preserve original whitespace, comment columns, or blank-line groupings
between statements. It does preserve comment text and attachment
position. This is consistent with the spec's principle that "the AST
is canonical": anything not in the AST is not promised to round-trip.

Blank lines between statements are a known information loss; if needed,
they could be added later by capturing blank-line counts on the lexer
side and storing them on `Statement` as `blankLinesBefore: number`.

---

## Round 2 (trailing comments) — non-obvious decisions

### D6. Single `trailingComments` array + `endLine` field, not two arrays

The "inline trailing" (same line as the statement) and "block-end
trailing" (between last statement of a block and the closing brace)
buckets are semantically distinct for rendering but identical for the
AST consumer. We store them in a single `trailingComments` array on
each statement and add `endLine?: number` so the formatter can decide
rendering at print time:

```
c.pos.line === stmt.endLine  →  render inline (after terminator, before newline)
otherwise                    →  render on own indented line
```

Alternatives considered: (a) two arrays
(`inlineTrailingComments` + `blockEndComments`) — rejected because it
forces every AST consumer that walks comments to know the distinction
and increases AST surface area; (b) annotating each `Comment` with an
`inline: boolean` flag — rejected because the line comparison is
trivially derivable from data we already store, and storing the flag
opens the door to inconsistencies when the AST is mutated.

### D7. `innerComments` belongs only on `WorkflowDecl` (not on every block)

When a block is empty (no statements) any comments inside it have
nowhere to attach. We surface those only on `WorkflowDecl`. Inner
blocks (then/else, switch arms, attempts/map/filter/parallel bodies)
that happen to be empty still drop their orphan comments — documented
as a known gap. Rationale:

- An empty `then`/`else` is a clear smell — users add a placeholder
  statement when they want such structure, and an empty switch arm body
  is unusual.
- An empty top-level workflow body, by contrast, is a common scaffold
  ("I'm describing this workflow but the body is a TODO") and losing
  the TODO comment would surprise users.
- Adding `innerComments` to every block-holding node would touch the
  AST surface of every built-in node (`AttemptsNode`, `MapNode`,
  `ParallelNode`, etc.) for a feature that rarely matters in practice.

### D8. `finalizeBlock` is called from every block parser, not just at EOF

The natural place to attach end-of-block trailing comments is when the
parser sees the block's closing delimiter — which differs by context:
`}` for workflow/if/built-in bodies, but `case`/`default`/`}` for
switch arm bodies. We added a single `finalizeBlock(stmts)` helper and
invoke it from each of `parseStatements()` and `parseSwitchArmBody()`.
If we relied only on the wrapper-level `takeLeadingComments` in the
next iteration, a trailing comment on the last statement of a switch
arm would migrate onto the next `case`'s leading comments — a subtle
semantic shift the round-1 reviewers flagged.

### D9. Inline trailing comments only consume same-line comments

`takeInlineTrailingComments(line)` stops at the first comment whose
line differs from the just-parsed statement's `endLine`. Comments on
subsequent lines (before the next statement begins) fall through to the
next iteration's `takeLeadingComments` and become _leading_ comments of
the next statement — which is the correct attachment for cases like:

```
const x = 1;
// This belongs to the return statement below
return x;
```

Without the same-line guard, that comment would be attached as a
"trailing" of `const x = 1;` and the leading-vs-trailing semantics
would collapse.
