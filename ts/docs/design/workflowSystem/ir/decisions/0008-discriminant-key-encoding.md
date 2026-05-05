# Discriminant key encoding (decision 0008)

Status: **Adopted (v1).** Branch selectors must resolve to strings.
`selectorSchema` must be string-typed (plain `{ "type": "string" }`
or `{ "enum": ["a", "b", ...] }` with string members). Non-string
values require an explicit conversion task. Folded into
[../ir-v1.md](../ir-v1.md) §3.6 and §5.3. This document is the
rationale.

## Purpose

A future reviewer should read this document when:

- proposing boolean or integer discriminants in branch selectors;
- asking why `bool.toLabel` exists instead of matching `true`/`false`
  directly;
- evaluating whether the branch model should accept non-string
  discriminants;
- designing DSL lowering of `if (condition)` to a branch node.

Cross-references:

- [../ir-v1.md](../ir-v1.md) §3.6 (branch node), §8.3 (branch model
  alternatives).
- [../../principles/design-principles.md](../../principles/design-principles.md)
  P3 (structural correspondence), P5 (predictability).
- Scenario evidence:
  [../validation/b1-wire-apis.md](../validation/b1-wire-apis.md) S1;
  [../validation/a4-morning-brief.md](../validation/a4-morning-brief.md)
  (uses `bool.toLabel` as the conversion task).

---

## 1. The question

A branch node dispatches on a discriminant value looked up in a
`cases` map. JSON object keys are always strings. What happens when
the upstream task produces a non-string discriminant (e.g., boolean
`true` from `int.lessThan`)?

B1's retry loop hits this directly: `int.lt` returns
`{ result: boolean }`, and the branch needs to dispatch on it.
The IR draft used `selectorSchema: { "enum": [true, false] }` with
case keys `"true"` and `"false"` - a boolean value matched against
string keys via implicit coercion.

---

## 2. The alternatives

### Alternative A: discriminants must be strings

The `selector` reference must resolve to a string value.
`selectorSchema` must be `{ "type": "string" }` or
`{ "enum": [...] }` where every enum member is a string. Non-string
values require an explicit conversion task (e.g., `bool.toLabel`).

### Alternative B: implicit JSON-stringification

The engine stringifies the discriminant value before case lookup:
`true` becomes `"true"`, `42` becomes `"42"`, etc. `cases` keys
are always strings (JSON object keys), and the coercion is a
defined engine rule.

### Alternative C: cases as value-target pairs

Replace the `cases` object with an array of `{ value, target }`
pairs, where `value` can be any JSON literal:

```jsonc
"cases": [
  { "value": true, "target": "@iterate" },
  { "value": false, "target": "@exit" }
]
```

This supports non-string discriminants without coercion but changes
the branch schema shape.

---

## 3. Analysis

| Principle                           | Alt A (strings only)                                                                                                | Alt B (implicit coercion)                                                                                                          | Alt C (value-target pairs)                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P5 (predictability)                 | Clean. No coercion rules to learn.                                                                                  | Violates. Reader must know the stringification convention. `true` vs `"true"` is exactly the kind of implicit behavior P5 targets. | Clean. Values compared by structural equality.                                    |
| P3 (representation-surface, §1.3.2) | Clean. One surface form (string key = string value).                                                                | Violates. One surface form (string key) carries two semantic rules (string match and coerced match). Scenario 27b pattern.         | Clean. One surface form (value-target pair).                                      |
| §1.3.1 (minimization)               | Wins. No new concept; reuses existing `cases` object shape. The `bool.toLabel` task already exists (decision 0006). | Wins. No schema change, no new task. But adds a hidden behavioral rule (coercion).                                                 | Loses. New schema shape for `cases`.                                              |
| §1.1 (engine audience)              | Trivial. Engine matches strings.                                                                                    | Engine must implement coercion. Not hard, but a new code path.                                                                     | Engine must iterate an array and do structural comparison. Slightly more complex. |
| DSL impact                          | DSL lowers `if (cond)` to `bool.toLabel` + branch. Mechanical.                                                      | DSL can emit boolean discriminants directly. Simpler lowering.                                                                     | DSL can emit typed discriminants. Moderate lowering change.                       |

**Key observation:** Alternative B is the only one that introduces
implicit behavior. Alternatives A and C are both explicit, but A is
simpler (no schema change). The cost of A is one extra task node per
boolean branch - but A4 already established that `bool.toLabel` is
part of the standard-library task inventory (decision 0006). The
task exists; using it is not a new cost.

---

## 4. Recommendation

**Adopt Alternative A: discriminants must be strings.**

Rationale:

1. **P5 clean.** No implicit coercion. A string value matches a
   string key. The rule is trivially predictable.

2. **P3 clean.** One surface form, one semantic rule. No scenario-27b
   ambiguity.

3. **Consistent with decision 0006.** `bool.toLabel` already exists
   as a standard-library task. Boolean-to-string conversion is the
   same pattern as `int.add` for arithmetic: the IR does not compute;
   tasks compute. Discriminant encoding is no exception.

4. **DSL absorbs the cost.** `if (attempt < maxRetries)` in the DSL
   lowers to `int.lessThan` + `bool.toLabel` + branch. The human
   never writes `bool.toLabel` directly.

5. **No schema change.** `cases` remains a JSON object with string
   keys. The validator checks that `selectorSchema` is string-typed
   and that every `enum` member is a string. Simple.

---

## 5. Spec changes

Two edits to ir-v1.md:

1. **§3.6:** Add after the `selectorSchema` description: "The
   selector must resolve to a string. `selectorSchema` must be
   `{ "type": "string" }` or `{ "enum": [...] }` with all-string
   members. Non-string discriminants require an explicit conversion
   task (e.g., `bool.toLabel` from the standard library)."

2. **§5.3 (pass 3, branch validation):** Add: "Reject branches where
   `selectorSchema` admits non-string values."

---

## 6. Coupling with decision 0006 (no expressions)

This decision is downstream of
[decision 0006](0006-no-expressions-in-ir.md). The reason `bool.toLabel`
exists is that the IR has no expressions: a boolean comparison result
cannot be used directly as a branch predicate, so it must be converted
to a string discriminant via a standard-library task.

If the IR ever gains an expression sublanguage (`$expr`, revisit
trigger row 11), the natural move is to allow boolean-typed expressions
directly in branch selectors - i.e., predicate branches (§8.3 Alt A).
At that point:

- `bool.toLabel` becomes unnecessary (the branch evaluates the
  predicate itself).
- `selectorSchema` would accept `{ "type": "boolean" }` in addition
  to string-typed schemas.
- `cases` could remain a string-keyed object (with `"true"`/`"false"`
  as keys) or switch to value-target pairs (Alternative C from this
  record). The encoding question resurfaces but is simpler when the
  IR already has expression evaluation semantics.

The two decisions share a dam: the IR's commitment to "tasks are the
only computation surface" (P1 boundary). If that commitment is relaxed
for expressions (0006 flips), string-only discriminants (0008) lose
their rationale and should flip together. Revisit trigger row 11
covers both.
