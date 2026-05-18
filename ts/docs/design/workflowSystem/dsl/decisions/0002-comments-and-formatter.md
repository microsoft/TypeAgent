# Implementation decisions: G8 (comment preservation) and DSL formatter

This document records design choices that are not obvious from the spec
or the code itself, so reviewers can understand the rationale without
re-deriving it. It covers both rounds of the G8 work:

- **Round 1** added `leadingComments` and a formatter (`format(decl)`).
- **Round 2** extended the originally-incomplete spec to cover
  `trailingComments` (inline and block-end) and `innerComments`.

The decisions are presented as a single ordered list. Each section
header notes which round introduced it for traceability, but later
rounds may have refined or invalidated earlier choices — the wording
below reflects the **current** state of the implementation.

## 1. `LexComment.text` stores the full comment lexeme (delimiters included)

_Introduced round 1._

`dsl-v0.1.md` §6 declares only that comments are stored as
`Comment { text, pos }`. It does not say whether `text` is the content
between delimiters or the full source span.

Decision: store the full lexeme — `// foo` rather than ` foo`, and
`/* foo */` rather than ` foo `. Rationale:

- A round-trip serializer can emit the comment verbatim with no
  reconstruction step (no ambiguity about leading/trailing whitespace,
  no need to remember "this was a block comment").
- Distinguishing the comment kind is cheap (also exposed as
  `LexComment.block`).
- Cost is two-character overhead per comment, negligible.

If a consumer wants the content only they can strip the leading two
characters (and trailing two for block comments) trivially.

## 2. Comments live in three buckets keyed off the AST node

_Introduced round 1 (`leadingComments`); extended round 2
(`trailingComments`, `innerComments`)._

The parser maintains a cursor (`commentIdx`) into the lexer's comment
list. Before parsing each construct it drains comments that lie before
the current token; after parsing each statement it drains those that
lie on the same line as the statement's `endLine`; before each
block-closing token it drains whatever is left. The result lands in
one of three buckets:

| Bucket | Lives on | Captures |
| --- | --- | --- |
| `leadingComments` | every AST node | comments immediately before the node |
| `trailingComments` | every `Statement` | comments after the statement, either inline (same line as `endLine`) or block-end (between last statement and `}`/`case`/`default`) |
| `innerComments` | `WorkflowDecl` | comments inside an otherwise empty workflow body |

`Statement.endLine` is set to the source line of the statement's last
token (tracked via `Parser.lastToken`). The formatter uses
`comment.pos.line === stmt.endLine` to choose between inline and
own-line rendering of `trailingComments` (see decision §6).

This three-bucket model replaces the round-1 "leading-only" approach,
which round-2 reviewers (correctly) flagged as silently dropping
inline trailing and block-end comments.

## 3. Bare task calls are formatted as expression statements via `ConstStatement.isSynthetic`

_Introduced round 1, hardened in round 1 review pass 1._

Per gap item G9, the parser wraps bare statement-position task calls
(e.g., `audit.log(x);`) as a `ConstStatement` with a synthetic name of
the form `_<line>_<col>`. The formatter must re-emit them as bare
expressions, otherwise the synthetic name would re-emerge in the
output and gradually drift if reformatted at a different column.

The original implementation used a regex on the name
(`/^_\d+_\d+$/`). The first review-pass reviewer pointed out this
collides with any legitimate user variable that happens to match that
pattern. Fix: the parser explicitly sets `ConstStatement.isSynthetic =
true` on the wrapper it creates, and the formatter keys off the flag
instead of the name.

The downside is a small AST surface bump; the upside is that
"formatter should reverse what the parser did" is now encoded as data
rather than a fragile name convention. If G9 is ever resolved by
adding a dedicated `ExpressionStatement` AST node, this flag can be
deleted.

## 4. `SwitchStatement.defaultIndex` preserves arm order

_Introduced round 1 review pass 1._

The parser originally stored `default_?: Statement[]` separately from
`arms: SwitchArm[]`. The formatter then emitted all `case`s followed
by `default:`. That changed program behavior whenever the source
placed `default:` between cases — switch in this DSL falls through, so
`default → case 2` and `case 1 → default` are not equivalent. Fix:
`SwitchStatement` carries `defaultIndex?: number` recording where the
`default` arm appeared in the source `arms` order. The formatter
weaves it back into the loop at that index.

## 5. Formatter precedence handling

_Introduced round 1._

Expression printing uses an explicit precedence table mirroring the
parser's precedence climber. The right operand of a binary operator
is printed with `parentPrec = myPrec + 1` to force parentheses around
same-precedence subexpressions on the right side (preserving left
associativity in the output). Without the `+ 1`, `(1 - 2) - 3` would
re-emit as `1 - 2 - 3` and be re-parsed identically — but
`1 - (2 - 3)` would also drop its parens and silently change meaning.

## 6. Single `trailingComments` array + `endLine` field, not two arrays

_Introduced round 2._

The "inline trailing" (same line as the statement) and "block-end
trailing" (between last statement of a block and the closing brace)
flavors are semantically distinct for rendering but identical for the
AST consumer. We store them in one `trailingComments` array per
statement and add `endLine?: number` so the formatter can decide
rendering at print time:

```
c.pos.line === stmt.endLine  →  render inline (after terminator, before newline)
otherwise                    →  render on own indented line
```

Alternatives considered: (a) two arrays
(`inlineTrailingComments` + `blockEndComments`) — rejected because it
forces every AST consumer that walks comments to know the distinction
and increases AST surface area; (b) a `inline: boolean` flag on each
`Comment` — rejected because the line comparison is trivially derivable
from data we already store, and storing the flag opens the door to
inconsistencies when the AST is mutated.

## 7. `innerComments` lives only on `WorkflowDecl` (not on every block)

_Introduced round 2._

When a block is empty (no statements) any comments inside it have
nowhere to attach. We surface those only on `WorkflowDecl`. Inner
blocks (then/else, switch arms, attempts/map/filter/parallel bodies)
that happen to be empty still drop their orphan comments — documented
in `g8-test-gaps-unaddressed.md` and pinned with three tests under
`"documented gap: comments inside empty nested blocks are dropped"`.
Rationale:

- An empty `then`/`else` is a clear smell — users add a placeholder
  statement when they want such structure, and an empty switch arm
  body is unusual.
- An empty top-level workflow body, by contrast, is a common scaffold
  ("I'm describing this workflow but the body is a TODO") and losing
  the TODO comment would surprise users.
- Adding `innerComments` to every block-holding node would touch the
  AST surface of every built-in node (`AttemptsNode`, `MapNode`,
  `ParallelNode`, etc.) for a feature that rarely matters in practice.

## 8. `finalizeBlock` is called from every block parser, not just at EOF

_Introduced round 2._

The natural place to attach end-of-block trailing comments is when
the parser sees the block's closing delimiter — which differs by
context: `}` for workflow/if/built-in bodies, but
`case`/`default`/`}` for switch arm bodies. We added a single
`finalizeBlock(stmts)` helper and invoke it from each of
`parseStatements()` and `parseSwitchArmBody()`. If we relied only on
the wrapper-level `takeLeadingComments` in the next iteration, a
trailing comment on the last statement of a switch arm would migrate
onto the next `case`'s leading comments — a subtle semantic shift the
round-2 reviewers explicitly probed for.

## 9. Inline trailing comments only consume same-line comments

_Introduced round 2._

`takeInlineTrailingComments(line)` stops at the first comment whose
line differs from the just-parsed statement's `endLine`. Comments on
subsequent lines (before the next statement begins) fall through to
the next iteration's `takeLeadingComments` and become _leading_
comments of the next statement — which is the correct attachment for
cases like:

```
const x = 1;
// This belongs to the return statement below
return x;
```

Without the same-line guard, that comment would attach as a
"trailing" of `const x = 1;` and the leading-vs-trailing semantics
would collapse.

## 10. Multi-line comments are emitted via a dedicated helper

_Introduced round 2 test-gap pass 1 (bug fix)._

`Printer.write()` auto-applies the current indent at line start. The
naïve approach of splitting a multi-line comment on `\n` and writing
each piece through `write()` re-indents every continuation line —
which doubles up because the comment's own internal alignment is
already part of the lexeme. The bug:

```
/* line a
   line b */
```

would gain `depth * indent` extra spaces on every reformat
(`format(parse(format(parse(x)))) !== format(parse(x))`).

Fix: `writeMultilineCommentText(text)` writes the first line through
`write()` (so the current indent is applied) and pushes continuation
lines verbatim via `parts.push(...)`, bypassing the auto-indent.
Used from `printLeadingComments`, `printOwnLineComments`, and the
own-line branch of `endStmt`. The two halves
(`printLeadingComments` / `printOwnLineComments`) intentionally
remain separate APIs even though their bodies now look identical —
their semantic meaning (and likely future divergence around blank
lines / separator handling) is different.

## 11. Formatter is deterministic and configurable on indentation only

_Introduced round 1._

`FormatOptions` exposes only `indent` (default 4) and `eol` (default
`\n`). No options for line width, brace style, trailing commas, or
quote style. Rationale:

- Keeps the canonical-text contract simple: AST + options yields one
  textual representation.
- Avoids reintroducing the "many ways to format the same DSL" problem
  that motivated calling the output canonical in the first place.

## 12. Formatter is not a full text-to-text pretty-printer

_Introduced round 1._

The formatter operates on an AST, not on source text. It does not
preserve original whitespace, comment columns (it does preserve
`Comment.pos.col` in the AST but does not use it for layout), or
blank-line groupings between statements. It does preserve comment
text and attachment position. This is consistent with the spec's
principle that "the AST is canonical": anything not in the AST is
not promised to round-trip.

Blank lines between statements are a known information loss; if
needed, they could be added later by capturing blank-line counts on
the lexer side and storing them on `Statement` as
`blankLinesBefore: number`.
