# Code-review feedback not acted upon

Review passes were performed by a code-review subagent twice on the
G8/formatter changeset (`agents/can-you-address-g8-in-the-dsl-v0-f3fc165d`).
This document records feedback that was *not* acted upon, with rationale.

## Review pass 1

Both findings were acted upon. No outstanding items.

- Synthetic-name regex collision → fixed via `ConstStatement.isSynthetic`.
- Switch default arm reordering → fixed via `SwitchStatement.defaultIndex`.

## Review pass 2

The reviewer's final verdict was "No significant issues found." Along the
way they observed one minor point worth recording explicitly:

### Trailing/dangling comments at the end of a block

A comment that appears after the last statement of a block but before
the closing `}` (or after the final statement of the whole file) is
either reattached as the leading comment of the next outer statement
or, if there is no next statement, dropped.

Example:

```
workflow w(): string {
    const x = "a";
    return x;
    // trailing comment
}
```

The `// trailing comment` is dropped from the AST (no next statement to
attach it to).

**Not acted upon because:**

1. The dsl-v0.1 spec section 6 explicitly defines comments as
   `leadingComments` attached to the *following* AST node. There is no
   spec'd notion of `trailingComments`.
2. The decision is already documented in
   `implementation-decision.md` section 2.
3. Adding `trailingComments` would require new AST fields on every
   node-with-a-block kind (block bodies, switch arms, attempts/map/
   filter/parallel bodies, workflow body) and matching emitter logic.
   That is a larger change properly scoped to a follow-up gap item.

If a future requirement makes trailing-block comments important (e.g.,
license footers, "// end of switch" annotations), the recommended
follow-up is:

- Add `trailingComments?: Comment[]` to AST node kinds that have
  enclosed bodies (or to a block wrapper).
- Update the parser to take comments accumulated after the last
  statement and before the closing brace.
- Update the formatter to emit them after the last statement.

No other feedback was outstanding from either review pass.
