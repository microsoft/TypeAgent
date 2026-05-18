# Code-review feedback not acted upon

Four code-review subagent passes were performed across the two rounds
of G8 work on `agents/can-you-address-g8-in-the-dsl-v0-f3fc165d`:

| Round | Pass | Result |
| --- | --- | --- |
| 1 | 1 | 2 bugs; both fixed (see "Acted upon" below) |
| 1 | 2 | 1 minor observation about end-of-block comments — see "Acted upon" |
| 2 | 1 | No significant bugs |
| 2 | 2 | 1 documentation gap (empty nested blocks) — fixed by pinning tests + entry in `g8-test-gaps-unaddressed.md` |
| 3 | — | Not run (user request was direct; gaps were enumerated explicitly) |

This document records feedback that was *not* acted upon, with
rationale. The current set is empty — every actionable item was
addressed in either the round that surfaced it or the next round.

## Items addressed (for context)

### Synthetic-name regex collision (round 1 pass 1)

The original formatter detected bare-expression statements by matching
the parser's synthetic name pattern (`/^_\d+_\d+$/`) against the
ConstStatement name. A legitimate user variable named `_12_5` would
have been silently re-emitted as a bare expression. **Fix:**
`ConstStatement.isSynthetic` set explicitly by the parser; formatter
keys off the flag.

### Switch default arm reordering (round 1 pass 1)

The original AST stored `default_` separately from `arms`, and the
formatter always emitted `default:` last. Switch falls through in this
DSL, so reordering changed program meaning. **Fix:**
`SwitchStatement.defaultIndex` records the source position of `default`
and the formatter weaves it back in at the same index.

### End-of-block / trailing comments dropped (round 1 pass 2)

The reviewer observed that a comment after the last statement of a
block (e.g., `return x; // tail` or a comment between the last
statement and `}`) was lost on round-trip because round 1 only
modeled `leadingComments`. Originally **not** acted upon in round 1
on the basis that the dsl-v0.1 spec section 6 only describes leading
comments and a `trailingComments` channel would be a larger,
properly-scoped follow-up.

**Now acted upon** as the entirety of round 2: the spec was extended
to cover trailing and inner comments, the AST grew
`Statement.trailingComments`/`endLine` and
`WorkflowDecl.innerComments`, and the parser/formatter were updated
to round-trip them faithfully. See `g8-formatter-implementation-log.md`
and decisions §2, §6–§9.

### Empty nested blocks drop inner comments (round 2 pass 2)

The reviewer noted that comments inside `if (x) { /* TODO */ }`,
empty `else`, empty `case` arm, or empty built-in lambda bodies are
silently dropped — by design (decision §7), but there was no test
pinning the behavior and no entry in the unaddressed-gaps file.

**Round 2 fix:** Three pinning tests added under
`"documented gap: comments inside empty nested blocks are dropped"`
in `test/trailingComments.spec.ts`, and the limitation is now
documented in `g8-test-gaps-unaddressed.md` along with a related
between-brace attachment quirk (`} /* note */ else { ... }`).

**Round 3 fix:** decision §7 is superseded — every block-bearing AST
node now has an `*InnerComments` field, the `}`/`else` gap is
captured via `IfStatement.elseLeadingComments`, and the three
pinning tests are inverted into positive round-trip tests.

### Code duplication between `printLeadingComments` and `printOwnLineComments` (round 2 pass 2)

Minor refactoring observation; not a functional issue. The two
helpers intentionally remain separate APIs — their semantic meaning
is different and they are likely to diverge around blank-line /
separator handling. Recorded for context in decisions §10.

## Outstanding items

None.
