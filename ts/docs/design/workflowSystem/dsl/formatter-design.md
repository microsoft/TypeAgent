# DSL formatter — design and contract

This document records the design choices behind `format(decl, options)`
(in `src/formatter.ts`) and the comment-preservation model in the parser
and AST. It is the durable reference for reviewers and maintainers; for
the language definition itself see `dsl-v0.1.md` (especially §6 on
comments).

## Contract

Given an AST `decl: WorkflowDecl`, `format(decl, options)` returns a
single deterministic textual representation. The contract:

1. **AST is canonical.** Anything not represented in the AST is not
   promised to round-trip. In particular: original whitespace, comment
   columns, and blank lines between statements are not preserved.
2. **Comment content is preserved verbatim.** Every comment in the
   source — line, block, multi-line block, `/**/`, `//`, `/** … */` —
   is preserved with full delimiters and attaches to a stable AST slot
   (see §"Comment model" below).
3. **Token data (identifiers and literals) is preserved verbatim.**
   Every identifier, string/number/boolean/null/template-literal token
   from the source appears in the output. No token-content is invented
   (e.g. `attempts(() => …)` is not rewritten to `attempts((err) => …)`).
4. **The output re-parses to a structurally-equivalent AST.**
   `parse(format(parse(src)))` is AST-equivalent to `parse(src)`
   (modulo source positions and comment-attachment trivia).
5. **Format is idempotent at the AST level.**
   `format(parse(format(parse(src))))` === `format(parse(src))`.

Layer (3) is enforced by the content-fidelity oracle in
`test/contentFidelity.spec.ts`, which checks the multiset of
identifiers, literals, and comment lexemes between input and output.

## Documented canonicalizations

The formatter intentionally performs a small fixed set of rewrites:

- **Expression-body arrows are wrapped in blocks.** `(x) => x + 1`
  becomes `(x) => { return x + 1; }`. The arrow grammar in v0.1 is
  block-body only; the parser accepts the shorthand and the AST
  normalises it.
- **Multi-line parameter lists and object types add a trailing comma**
  on the last element. This gives inline-trailing comments a uniform
  place to live (between the comma and the newline).
- **Bare task-call statements** (`audit.log(x);`) round-trip as bare
  expressions, even though the AST wraps them in a synthetic
  `ConstStatement` (see decision §3 below).
- **`else` placement** follows the original source's line choice
  (`} else` vs. `}\nelse`) when no comment forces otherwise; see
  decision §6.
- **Parameter list and object-type layout** preserves the original
  inline-vs-multi-line choice when no comment forces a break and the
  inline projection fits within `printWidth`; see decision §6.

## FormatOptions

```ts
interface FormatOptions {
    indent?: number;      // non-negative integer, default 4
    eol?: string;         // "\n" | "\r\n" | "\r", default "\n"
    printWidth?: number;  // non-negative integer | Infinity, default 100
}
```

Invalid values throw `RangeError`/`TypeError` eagerly with a
field-named message. `printWidth: 0` forces multi-line wherever an
alternative exists; `printWidth: Infinity` disables width-driven
wrapping entirely. See decision §7.

## Comment model

The parser maintains a cursor (`commentIdx`) into the lexer's comment
list. Before each construct it drains pending leading comments; after
each statement it drains same-line trailing comments; before each
block-closing token it drains whatever remains. Comments land in one
of three slot kinds:

| Slot kind          | Lives on                                | Captures                                                                  |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| `leadingComments`  | any AST node                            | comments immediately before the node                                      |
| `trailingComments` | every `Statement`; `WorkflowDecl`       | inline (same line as statement's `endLine`) or block-end; on workflow: EOF |
| `*InnerComments`   | every block-bearing or list-bearing node | comments inside an otherwise-empty block / list                          |

`Statement.endLine` is set to the source line of the statement's last
token. The formatter uses `comment.pos.line === stmt.endLine` to choose
between inline and own-line rendering.

The complete list of inner-comment slots is in `dsl-v0.1.md` §6.

---

## Design decisions

The numbering is fresh; section titles describe the decision rather
than the round it was introduced in.

### 1. `LexComment.text` stores the full lexeme (delimiters included)

`text` holds `// foo` rather than ` foo`, and `/* foo */` rather than
`foo`. Rationale: a round-trip serializer emits the comment verbatim
with no reconstruction step (no ambiguity about leading/trailing
whitespace, no need to remember which delimiter style was used).
Comment kind is also exposed as `LexComment.block` for consumers that
need to discriminate.

### 2. `ConstStatement.isSynthetic` for bare task calls

Bare statement-position task calls (e.g. `audit.log(x);`) are parsed
as a `ConstStatement` with a synthetic name (`_<line>_<col>`). The
formatter re-emits them as bare expression statements.

The original implementation detected the wrapper by regex-matching
the synthetic-name pattern, which collided with any user variable
matching `^_\d+_\d+$`. Fix: the parser sets `isSynthetic: true`
explicitly; the formatter keys off the flag. The downside is a small
AST-surface bump; the upside is that "formatter reverses what the
parser did" is encoded as data rather than a fragile name convention.
If G9 is ever resolved with a dedicated `ExpressionStatement` node,
this flag can be deleted.

### 3. `SwitchStatement.defaultIndex` preserves arm order

Switch falls through in this DSL, so the position of `default:`
relative to `case` arms is meaningful. `SwitchStatement` carries
`defaultIndex?: number` recording the source position of the
`default` arm, and the formatter weaves it back into the loop at
that index. (The original AST stored `default_` separately and the
formatter always emitted it last, which silently changed program
meaning.)

### 4. Formatter precedence handling

Expression printing uses an explicit precedence table mirroring the
parser. The right operand of a binary operator is printed with
`parentPrec = myPrec + 1` to force parentheses around
same-precedence right-side subexpressions, preserving left
associativity. Without the `+ 1`, `1 - (2 - 3)` would drop its
parens and silently change meaning.

### 5. Single `trailingComments` array + `endLine`, not two arrays

"Inline trailing" (same line as the statement) and "block-end
trailing" (between the last statement and the closing `}`) are
semantically distinct for rendering but identical for the AST
consumer. We store them in one `trailingComments` array per
statement and add `endLine?: number` so the formatter decides
rendering at print time:

```
c.pos.line === stmt.endLine  →  inline (after terminator, before newline)
otherwise                    →  own indented line
```

Alternatives considered: (a) two arrays — rejected because it
forces every AST consumer that walks comments to know the
distinction; (b) a `inline: boolean` flag on each `Comment` —
rejected because the line comparison is trivially derivable from
data we already store.

### 6. Layout preservation for parameter lists, object types, and `else`

When the formatter has a layout choice (inline vs. multi-line) and
no comment forces a break, it respects the **original source's
choice** rather than canonicalising. Three sites carry layout flags:

- `WorkflowDecl.paramListMultiLine`
- `ObjectType.multiLine`
- `IfStatement.elseOnNewLine`

Rule (priority order):

1. If a comment forces a layout (e.g. a `//` line comment cannot be
   inline-trailing across a comma), use that layout.
2. Else if the AST records the source was multi-line, stay
   multi-line.
3. Else if the projected single-line width exceeds `printWidth`,
   break to multi-line.
4. Otherwise, inline.

Parser heuristic for `multiLine` detection: a list is multi-line
only when (a) a newline separates the opening `(`/`{` from the
first element, OR (b) consecutive elements are on different lines.
A nested type that itself spans multiple lines does NOT flip the
outer list to multi-line — which keeps round-trip stable when the
outer list is inline but contains a multi-line inner type.

### 7. `FormatOptions.printWidth` (default 100)

A soft column budget used by the layout heuristic (§6) when neither a
comment nor an AST flag has already decided the layout. The default
of 100 matches Prettier. The formatter measures projected widths via
a `measure(fn)` helper that runs `fn` against a temporary buffer.

Width is consulted only at sites where the formatter has a layout
choice (parameter list, object type, `else` placement). Other
constructs (task-call arg lists, expression trees) do not currently
wrap on width — extending wrapping there is a separate change.

### 8. `elseLeadingComments` renders inline OR forces a line break

Comments between the `}` of the `then` block and the `else` keyword
(e.g. `} /* fallthrough */ else {` or `} // note\nelse {`) attach as
`IfStatement.elseLeadingComments`. Rendering rule:

- All block comments: emit on the same line as `}` / `else`
  (space-separated).
- Any line comment: emit each on its own line and place `else` on a
  fresh line at the current indent.

Rationale: line comments inherently terminate at end-of-line; trying
to keep `else` on the same line as a `//` would either swallow the
comment or generate invalid output.

To avoid stealing the IfStatement's own trailing comments (case:
`if (...) { ... } // note-on-the-if` with no following `else`), the
parser snapshots `commentIdx` before reading ahead for `else` and
rolls back on a no-`else` outcome.

### 9. Switch arm comment routing

Three slots close the "comment migrates to next statement" cases:

- `SwitchStatement.innerComments` — empty switch body; pre-first-arm
  comments.
- `SwitchStatement.defaultLeadingComments` — comments immediately
  before the `default` keyword.
- `SwitchArm.leadingComments` — comments immediately before the
  `case` keyword.

The parser drains pending comments at the top of each switch-arm
loop iteration and routes the result to the appropriate slot based
on the next keyword. The previous `finalizeBlock`-driven behaviour
for switch arm bodies (attaching unattributed comments as block-end
trailings on the last statement) was replaced by an inline-only
scoop. Own-line comments between an arm's last statement and the
next `case` / `default` / `}` therefore fall through and attach as
the next arm's `leadingComments` — matching TypeScript / Prettier
convention.

The empty-arm case still routes comments to that arm's
`innerComments`.

### 10. `WorkflowDecl.trailingComments` for EOF comments

Comments after the workflow's closing `}` (between brace and EOF)
have no statement or expression to attach to. `WorkflowDecl` carries
an explicit `trailingComments?: Comment[]` slot. `parseWorkflow`
drains pending comments immediately after consuming the closing `}`;
the formatter emits them on their own lines after the brace.

Alternative considered: a top-level `ParseResult.trailingComments`
array. Rejected because it would require formatter consumers to
plumb an extra value through, whereas a slot on the declaration
keeps `format(decl, options)` the single entry point.

### 11. `attempts.fallback.param` is `string | undefined`, not `"err"`

`AttemptsNode.fallback.param` is `string | undefined`. When the
source omits the fallback's parameter name (`() => { ... }`), the
parser records absence rather than substituting `"err"`. The
formatter emits `(${param ?? ""}) =>`, which prints `() =>` for the
absent case and `(name) =>` when the source provided one.

Downstream consumers (emitter, typeChecker) treat the absent case
as `"err"` for binding/scope purposes — that's an emit-time choice
and does not leak back through the round-trip.

### 12. FormatOptions validation: explicit, eager, narrow

Resolved `FormatOptions` are validated up front in `format()` before
any printing. Invalid values throw `RangeError`/`TypeError` with a
field-named message rather than letting downstream
`String.prototype.repeat(-1)` produce an opaque error or letting
`eol: ""` silently collapse output onto one line.

The contract is intentionally narrow:
- `indent`: non-negative integer.
- `eol`: exactly one of `"\n"`, `"\r\n"`, `"\r"`.
- `printWidth`: non-negative integer or `Infinity`.

### 13. `parseSingle` errors on trailing tokens past the workflow

Any non-whitespace, non-comment content after the workflow's outer
`}` is a parse error (`"Unexpected token after workflow: <kind>
(<value>)"`). Trailing whitespace and comments are allowed (comments
attach via decision §10; whitespace is insignificant). This prevents
silently dropping stray content like a duplicated closing brace.

### 14. Parser emits multi-line comments via a dedicated helper

`Printer.write()` auto-applies the current indent at line start.
The naïve approach of splitting a multi-line comment on `\n` and
writing each piece through `write()` re-indents every continuation
line — which doubles up because the comment's internal alignment is
already part of the lexeme. Fix:
`writeMultilineCommentText(text)` writes the first line through
`write()` and pushes continuation lines verbatim via `parts.push(...)`,
bypassing auto-indent.

## Known non-fidelity

The following are documented losses, not bugs:

- **Blank lines** between statements are not preserved. The AST has
  no slot for them. Could be added later via a `blankLinesBefore:
  number` field on `Statement` if needed.
- **Comment columns** are recorded on `Comment.pos.col` but not used
  for layout — comments are emitted at the current indent.
- **Original whitespace** is not preserved; the formatter chooses
  whitespace consistent with its layout rules.

## Out of scope for the formatter

- **`ObjectType` `;` field separator.** The parser only accepts `,`
  in v0.1. A `;` variant is a grammar extension, not a formatter
  concern.
- **Visualize-API comment passthrough.** `extractGraph` strips
  comments by design at the boundary — the graph IR has no comment
  slot. Comments are a source-level concern only.
