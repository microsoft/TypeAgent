# Implementation decisions: G8 (comment preservation) and DSL formatter

This document records design choices that are not obvious from the spec
or the code itself, so reviewers can understand the rationale without
re-deriving it. It covers three rounds of the G8 work:

- **Round 1** added `leadingComments` and a formatter (`format(decl)`).
- **Round 2** extended the originally-incomplete spec to cover
  `trailingComments` (inline and block-end) and `innerComments` on
  `WorkflowDecl`.
- **Round 3** closed the remaining comment-fidelity gaps: comments
  between parameters, comments inside empty nested blocks, and
  comments between `}` and `else`.

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
`/* foo */` rather than `foo`. Rationale:

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

| Bucket             | Lives on          | Captures                                                                                                                            |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `leadingComments`  | every AST node    | comments immediately before the node                                                                                                |
| `trailingComments` | every `Statement` | comments after the statement, either inline (same line as `endLine`) or block-end (between last statement and `}`/`case`/`default`) |
| `innerComments`    | `WorkflowDecl`    | comments inside an otherwise empty workflow body                                                                                    |

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

## 7. `innerComments` lives on every block-bearing AST node ~~(only `WorkflowDecl`)~~

_Introduced round 2 as "WorkflowDecl-only"; **superseded in round 3**._

When a block is empty (no statements) any comments inside it have
nowhere to attach. Round 2 surfaced those only on `WorkflowDecl` and
documented the loss on inner blocks as an intentional gap. Round 3
retracts that limitation: per-block `*InnerComments` fields now exist on
every block-bearing AST node, and the formatter emits them inside the
otherwise-empty `{ }`:

| Node                                       | Field                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| `IfStatement`                              | `thenInnerComments`, `elseInnerComments`                 |
| `SwitchStatement`                          | `defaultInnerComments`                                   |
| `SwitchArm`                                | `innerComments`                                          |
| `AttemptsNode`                             | `bodyInnerComments` (body), `fallback.bodyInnerComments` |
| `MapNode`, `FilterNode`, `ParallelMapNode` | `bodyInnerComments`                                      |
| `ParallelNode.bodies[i]`                   | `bodyInnerComments`                                      |

Rationale for the retraction:

- "Empty `then` is a smell" turned out to be a wrong reason to drop a
  user's comment — empty bodies frequently appear as `TODO` scaffolds.
- The AST-surface cost was small and uniform once the parser had a
  `parseStatementsCapturingInner()` helper (round 2 already had it).
- Full comment fidelity is a cleaner contract than a per-position
  feature matrix.

The round-2 pinning tests under `"documented gap: comments inside empty
nested blocks are dropped"` were inverted into positive round-trip
tests in round 3.

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

## 13. Parameter comments use multi-line layout only when needed

_Introduced round 3._

`ParamDecl` now carries `leadingComments` and `trailingComments`;
`WorkflowDecl` carries `paramInnerComments` for the empty-list case.
The formatter chooses between two layouts:

- **Inline** (`workflow w(a: number, b: string): T { ... }`): used when
  no param has comments and `paramInnerComments` is empty. Preserves the
  compact look that 99% of workflows use.
- **Multi-line** (one param per line, with trailing comma): used as
  soon as any comment is present anywhere in the parameter list. The
  trailing comma is unconditional in this mode so a `// trailing` on
  the last param has a place to live (between the comma and the
  newline), matching the placement of inline trailing comments on the
  prior params.

Rationale: a single binary switch is easier to predict than a
per-param decision. The cost of formatting one rarely-commented param
on its own line is acceptable; the benefit is that comment placement
is unambiguous.

## 14. `elseLeadingComments` renders inline OR forces a line break

_Introduced round 3._

Comments between the `}` of the then block and the `else` keyword
(e.g. `} /* fallthrough */ else {` or `} // note\nelse {`) are
captured as `IfStatement.elseLeadingComments`. Rendering rule:

- If every captured comment is a block comment (`/* ... */`): emit
  them on the same line as the `}`/`else` keyword (space-separated).
- If any captured comment is a line comment (`//`): emit each on its
  own line and place `else` on a fresh line at the current indent.

Rationale: line comments inherently terminate at end-of-line; trying
to keep `else` on the same line as a `//` would either swallow the
comment or generate invalid output. Block comments do not have that
problem, so for them we preserve the conventional `} <cmt> else`
shape.

To avoid stealing the IfStatement's own trailing comments
(`if (...) { ... } // note-on-the-if` — no `else` keyword follows),
the parser snapshots its `commentIdx` before reading ahead for `else`
and rolls back on a no-`else` outcome so the outer `parseStatement`
sees the comments and attaches them as the IfStatement's
`trailingComments`.

## 15. Parameter list rolls inline-trailing across commas

_Introduced round 3._

For multi-line parameter lists, an inline-trailing comment on a param
must be captured _before_ the comma is consumed — otherwise the
comma's `}` (next token) would push the comment forward and it would
attach as the leading comment of the next param. The implementation:

1. `parseParam` records `endLine` for the param (set from
   `lastToken.line` after the type is parsed).
2. The list loop calls `takeInlineTrailingComments(prev.endLine)` for
   the previous param _then_ consumes the `,`.
3. For the last param (no trailing comma), the loop calls
   `takeLeadingComments()` after the param and treats those as the
   param's trailing.

The empty parameter list `workflow w()` has nowhere to hang
intervening comments, so they go on `WorkflowDecl.paramInnerComments`.

## 16. Original layout is preserved for parameter lists, object types, and `else`

_Introduced round 4._

When the formatter has a layout choice (inline vs. multi-line) and no
comment forces a break, it now respects the **original source's
choice** rather than canonicalising to one form. Three sites:

- `WorkflowDecl.paramListMultiLine`: tracks whether the source
  rendered the parameter list across multiple lines.
- `ObjectType.multiLine`: same for object-type literals in type
  position.
- `IfStatement.elseOnNewLine`: tracks whether the source placed
  `else` on a different line from the preceding `}`.

Rule (in priority order):

1. If a comment forces a layout (e.g. a `//` line comment can't be
   inline-trailing across the comma), use that layout.
2. Else if the AST records the source was multi-line, stay
   multi-line.
3. Else if the projected single-line width would exceed
   `printWidth` (decision D17), break to multi-line.
4. Otherwise, inline.

A consequence: a source like

    if (a) { ... }
    else { ... }

now round-trips as-is rather than being canonicalised to
`} else {`. The user's selection ("Both — track original layout
AND wrap if it would exceed printWidth") drove this.

Parser heuristic for `paramListMultiLine`/`multiLine`: a list is
"multi-line" only when (a) a newline separates the opening
`(`/`{` from the first param/field, OR (b) consecutive
params/fields are on different lines. A nested type that itself
spans multiple lines (e.g. a single param whose type is a
multi-line object type) does NOT flip the outer list to
multi-line — which keeps round-trip stable when the formatter
chose to keep the outer list inline but emit the inner type
multi-line.

## 17. `FormatOptions.printWidth` (default 100)

_Introduced round 4._

A soft column budget used by the layout heuristic (D16) when neither
a comment nor the AST flag has already decided the layout. The
default of 100 matches Prettier's default. Two special values:

- `Infinity` disables width-driven wrapping entirely — useful when
  the caller wants byte-stable output regardless of column count.
- `0` always forces multi-line where a multi-line alternative
  exists — useful in tests.

The formatter measures projected widths via a
`measure(fn)` helper that runs `fn` against a temporary buffer and
returns the maximum line length (relative to the column where
`fn` was invoked). The measurement covers the relevant span
(parameter list including `): ReturnType {`; the `} <leading>
else {` projection for IfStatement; the object type body). Cost is
one extra render of the projected span when the AST flag does not
already constrain the layout.

The formatter does not currently use printWidth for other constructs
(task-call arg lists, expression trees, etc.) — extending it there
is a separate change.

## 18. `ObjectType` carries field comments and an inner-comment slot

_Introduced round 4._

`ObjectTypeField` now has `leadingComments`, `trailingComments`,
and `endLine`, mirroring `ParamDecl`. The parser captures comments
on both sides of the field's terminating `,` (matching the
parameter-list logic from D15). `ObjectType` itself has
`innerComments` for the empty case (`{ /* shape: empty */ }`) and
`multiLine` for layout preservation.

The formatter switches to multi-line layout for object types as
soon as any field carries comments OR `innerComments` is set OR
the AST `multiLine` flag is set OR the projected inline width
exceeds `printWidth`. The multi-line layout uses unconditional
trailing commas so a `// trailing` on the last field can live
after the comma (uniform with parameter lists).

## 19. `SwitchStatement.innerComments` and pre-keyword arm comments

_Introduced round 4._

Three new slots close the remaining "comment migrates to next
statement" cases:

- `SwitchStatement.innerComments`: holds comments inside an
  otherwise empty switch body (`switch (x) { /* nothing */ }`)
  AND comments that appear before the first arm.
- `SwitchStatement.defaultLeadingComments`: holds comments
  immediately before the `default` keyword.
- `SwitchArm.leadingComments`: holds comments immediately before
  the `case` keyword.

The parser drains `takeLeadingComments()` at the top of each
iteration of the switch arm loop and routes the result to the
appropriate slot based on the next keyword. The previous
`finalizeBlock`-driven behaviour for switch arm bodies — which
attached all unattributed comments as block-end trailings on the
last statement of the arm — has been replaced by an inline-only
scoop (`takeInlineTrailingComments(last.endLine)`). Own-line
comments between an arm's last statement and the next `case` /
`default` / `}` therefore fall through to the outer loop and
attach as the next arm's `leadingComments`. This matches
TypeScript / Prettier convention and gives the comment a
semantically-stable slot independent of the arm's body length.

The empty-arm case still routes comments to that arm's
`innerComments` (no other slot makes sense when the body is
empty).

## 20. `WorkflowDecl.trailingComments` for EOF comments

Comments that appear AFTER the workflow's closing `}` (between the
brace and EOF) have no statement or expression to attach to. The
obvious "comments live on the nearest AST node" rule has no node to
land on once parsing is done.

We add an explicit `trailingComments?: Comment[]` slot on
`WorkflowDecl`. `parseWorkflow` drains pending comments immediately
after consuming the closing `}` (via the existing
`takeLeadingComments()` helper — name kept for symmetry; the
comments happen to be "leading" with respect to a non-existent next
token). The formatter's `printWorkflow` emits them on their own
lines after the closing brace, preserving the original ordering.

Alternative considered: a top-level `ParseResult.trailingComments`
array. Rejected because it would require formatter consumers to
plumb an extra value through, whereas a slot on the declaration
keeps `format(decl, options)` the single entry point.

## 21. `attempts.fallback.param` is `string | undefined`, not defaulted to `"err"`

The content-fidelity oracle exposed that source code like
`attempts(2, () => svc.go(), () => svc.fb())` round-tripped to
`attempts(2, () => { ... }, (err) => { ... })` — introducing an
Identifier token (`err`) that was never in the source.

We change `AttemptsNode.fallback.param` from `string` to
`string | undefined`. The parser records absence by leaving `param`
unset rather than substituting `"err"`. The formatter emits
`(${param ?? ""}) =>`, which prints `() =>` for the absent case
and `(name) =>` when the source provided one. Downstream consumers
(emitter, typeChecker) treat the absent case as `"err"` for
binding/scope purposes — that's an emit-time choice, not a syntax
one, so it doesn't leak back through the round-trip.

This is the model we'd extend to any other built-in whose
callback's parameter list is optional.
