# Loop output source (decision 0009)

Status: **Adopted (v1).** `output` resolves in the full body scope at
`@exit`, including body-scoped `bind` names from the final iteration.
`iterateState` resolves in the full body scope at `@iterate`. Both
sentinels resolve in the same scope; the difference is what happens
_after_ resolution (state is carried forward vs. output is published).
Folded into [../ir-v0.1.md](../ir-v0.1.md) §3.7. This document is the
rationale.

## Purpose

A future reviewer should read this document when:

- asking whether body `bind` names are visible to `output` at `@exit`;
- proposing that `output` should read only from `state`;
- evaluating the retry-pattern cost (threading a value through state
  just to export it);
- asking whether `@iterate` and `@exit` have the same scope rules.

Cross-references:

- [../ir-v0.1.md](../ir-v0.1.md) §3.7 (loop node), §3.7.1 (iterate
  state), §5.4 step 4 (execution semantics).
- [../../principles/design-principles.md](../../principles/design-principles.md)
  P2 (traceability), P5 (predictability).
- Scenario evidence: summarize-url workflow (S2: loop body's final
  `bind` name needed in `output` at `@exit`).

---

## 1. The question

When a loop body reaches `@exit`, what names can `output` reference?

- **Only `state`:** body-scoped `bind` names are torn down before
  `output` is resolved. To export a body-computed value, the author
  must thread it through a state variable (declare in `state`, write
  in `iterateState`, read in `output`).
- **Full body scope:** body-scoped `bind` names from the final
  iteration are still visible. `output` can reference them directly.

B1's retry loop hits this: the happy path binds `summary` in the
body and exits. Under the state-only rule, exporting `summary`
requires declaring a `lastSummary` state variable initialized to
null, copying `summary` into it at `@iterate`, and reading it from
`output`. Under the full-scope rule, `output` simply references
`summary`.

---

## 2. What the spec already says

Two passages in ir-v0.1.md bear on this:

- **§3.7:** "`output` is resolved when the body reaches `@exit`. It
  is a single reference object resolved in the body scope (typically
  against `state`, since per-iteration scope variables do not survive
  across iterations)."
- **§5.4 step 4:** "On `@exit`: resolve `output` against the final
  body scope (state + last-iteration node values)."

§5.4 step 4 is unambiguous: body bindings are visible at `@exit`.
§3.7's parenthetical "typically against `state`" is authoring
guidance, not a prohibition. The spec already takes the full-scope
position; it just does not say so clearly enough.

---

## 3. The full-scope rule is correct

### 3.1 Both sentinels resolve in the same scope

At the moment a sentinel is taken, the body scope contains:

- `state` variables (current iteration's values)
- `input` variables (loop-level, unchanged)
- `scope` variables (body `bind` names from the current iteration)
- `constant` variables (workflow-level)

Both `@iterate` (via `iterateState`) and `@exit` (via `output`)
resolve references in this scope. The scope is identical. What
differs is what happens after resolution:

| Sentinel   | Resolves in                                   | Then...                                                                                         |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@iterate` | body scope (state + scope + input + constant) | New state frame created from `iterateState` values. Body scope torn down. New iteration begins. |
| `@exit`    | body scope (state + scope + input + constant) | `output` value published to outer scope via `bind`. Body scope torn down. Loop node completes.  |

The symmetry is: both sentinels resolve in the full body scope, then
tear it down. There is no asymmetry in scope visibility - only in
what the resolved values are used for.

### 3.2 Why "typically against state" is guidance

The §3.7 parenthetical is correct as guidance: most loop outputs
_are_ accumulated in state (e.g., A4's `sections` list). But the
guidance should not be mistaken for a rule. The retry pattern (B1)
is the counterexample: the loop runs until success, and the
successful value is bound in the body, not accumulated in state.
Forcing it through state adds a null-initialized variable, an
`iterateState` entry, and a state read - three lines of ceremony
for no behavioral benefit.

### 3.3 Principle analysis

| Principle             | Full scope                                                       | State only                                                                               |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P2 (traceability)     | The `output` reference names the body binding directly. One hop. | The value flows through state: body bind -> iterateState -> state -> output. Three hops. |
| P5 (predictability)   | Consistent with `iterateState`, which also reads body bindings.  | Inconsistent: `iterateState` can read body bindings but `output` cannot.                 |
| §1.3.1 (minimization) | No extra state variable needed for retry-pattern loops.          | Extra state variable, initial value, and iterateState entry.                             |

The full-scope rule wins on all three principles.

---

## 4. Spec changes

One edit to ir-v0.1.md §3.7: replace the ambiguous parenthetical with
explicit language:

> `output` is resolved when the body reaches `@exit`. It is a single
> reference resolved in the full body scope (state, scope, input, and
> constant namespaces - the same scope available to `iterateState`
> at `@iterate`). For accumulator-pattern loops the output typically
> reads from `state`; for retry-pattern loops it may read directly
> from a body-scoped binding.

No change to §5.4 step 4 (already correct).

---

## Related: decision 0010 (loop `continueWhen`)

[Decision 0010](0010-finish-workflow-scope-unification.md) reframes
where the loop's output value comes from without changing the
guidance in this decision. Under 0010 the loop body is a plain
[`WorkflowScope`](../workflow-scope-proposal.md), and the loop's
output value **is** `body.output` resolved at body completion of the
terminating iteration (the iteration where `continueWhen` resolves
to `false`). The two patterns this decision describes still apply:

- **Accumulator pattern:** `body.output` reads from `state` (the
  accumulator carried across iterations). The terminating iteration's
  state, by construction of `iterateState`, holds the final value.
- **Retry pattern:** `body.output` reads from a body-scoped binding
  produced this iteration (typically the successful task's bound
  output). The terminating iteration is the one in which that
  binding was produced; `continueWhen` reads `false` on that path.

The §3.3 phi rules and the dominator coverage required by §4.1 pass 6
apply to `body.output` exactly as the v0.1 spec required for the
loop-level `output` reference. The footnote in [§8.5][^iterate-boundary]
of ir-v0.1.md records the iteration-boundary retiming.

[^iterate-boundary]: See ir-v0.1.md §8.5 footnote on the
    `@iterate` -> "body completion gated by `continueWhen`" retiming.
