# Anonymous Workflow Values and Closures

**Status:** Future sketch

## Context

The composition design (`dsl/workflow-composition.md` §4.2, §4.5)
deliberately keeps workflows **not first-class values** in v1:

- No lambda surface.
- No workflow-typed bindings (`const f = (n) => ...` is not allowed).
- No workflow type `(I) → O` in the surface type system.
- Higher-order positions (`map`, `filter`, `fork`, `attempts`) take
  block bodies, not values.
- Block bodies may close over outer names exactly as loop bodies and
  fork branches do today (captured by `inputs` / `$from outer`), but
  the block itself is not a value.

This is the minimum-symmetric position with the task model: tasks are
also not first-class values, and both are referenced by name from
inline contexts.

This note records what changes when first-class workflow values come
back, and the conditions under which to promote out of `future/`.

## Why consider this

Three motivations, in priority order:

1. **Reusable higher-order helpers.** Authors who write the same
   `(x) => namedWorkflow(x)` block-wrapper in many places want to
   bind it once and pass it. The v1 restriction forces wrapping at
   every use site.
2. **Strategy / configuration patterns.** Selecting among a small
   set of workflows at runtime (e.g. "use summarizer A or B
   depending on a flag") today requires writing the selection as a
   branch with both calls inline; with workflow values, it becomes a
   single call against a variable.
3. **Symmetry with future task-as-value.** If tasks ever become
   first-class values (e.g. for dynamic dispatch), workflows should
   acquire the same capability at the same time.

## What lambdas would look like at the DSL surface

Two equivalent forms, both lowering to anonymous entries in the IR's
`workflows` table:

```dsl
// Sugar (TypeScript-like). Types inferred from context.
const double = (n) => n * 2

// Explicit. Required when context does not fix the types.
const summarize = workflow (text: string): string => {
  const trimmed = string.trim(text)
  return string.slice({ s: trimmed, n: 200 })
}
```

Type system addition: a workflow type `(I) -> O` becomes a real type
expression in the DSL, parallel to the task / workflow declaration
signature.

## The hard part: closure semantics

A lambda that references outer-scope names is the structurally hard
case. The principle (P1, P4) says workflow contracts must be their
declared inputs and outputs &mdash; no hidden context. So closures
must lower to **explicit inputs** somewhere; the only design question
is where.

### Option A &mdash; Lift captures into the workflow body's `inputSchema`

Anonymous workflow's `inputSchema` grows fields for every free name
it references. The IR sees a workflow body with `inputSchema: { n,
factor }`; the higher-order call (`map`) binds both per-iteration
values and captured outer values via `inputs`.

- **Pros:** Workflow body contract is fully closed; no new IR
  concept. The body's schema honestly reflects what it depends on.
- **Cons:** The same `(n) => n * 2`-shaped lambda has different
  `inputSchema`s at different call sites depending on what was
  captured. The "type" of the lambda no longer matches its declared
  parameter list.

### Option B &mdash; Lift captures into the higher-order call's `inputs`

The body sees only its declared parameters; the engine threads
captured outer values into the body scope as bindings before each
invocation. This is exactly what loop bodies already do via the
existing sub-scope `inputs` mechanism.

- **Pros:** Matches existing IR machinery (loop / fork sub-scope
  rules); workflow body's declared `inputSchema` stays as the
  author wrote it; same lambda body has the same shape everywhere.
- **Cons:** Requires higher-order call nodes to carry per-iteration
  inputs **plus** captured outer-scope inputs. The IR validator
  must distinguish them.

### Option C &mdash; Captures via partial application

A lambda that captures `factor` is structurally
`namedFn.partial({ factor })`. This collapses closure into partial
application: every lambda is a partial application of some named
workflow.

- **Pros:** Unifies two features. Once partial application exists,
  closure is free.
- **Cons:** Partial application is its own large design problem
  (see `ir/future/workflow-default-arguments.md` "parked" note);
  commits to that path. Compiler must synthesize a named callee for
  every lambda.

### Recommendation when promoted

**Option B** is the closest match to existing IR machinery and the
cleanest semantic story. It is also the option that requires the
least new design: loop bodies already prove that capture-by-explicit-
input works.

Option A is workable but produces lambdas whose `inputSchema` varies
by capture set; that complicates tooling and type display.

Option C is intellectually appealing but couples two large features.

## The escape problem

Closures that escape their lexical scope (`const helper = (n) => n *
x` bound at one scope and passed to a fork branch at another) are a
separate sub-problem. Three sub-options when promoted:

1. **Reject escape.** Lambdas may only appear as direct arguments
   to higher-order calls in the same scope they were declared.
   Cross-scope movement requires promoting to a top-level workflow
   with explicit parameters. Smallest surface; matches the "no
   surprises" stance.
2. **Allow escape via captured values traveling with the ref.**
   `helper` is `WorkflowRef + captures: { x: <bound value> }`. This
   is structurally partial application; commits to that feature.
3. **Allow escape by eager substitution at the binding site.**
   `const helper = (n) => n * x` is rewritten to `_helper(n, x)`,
   and every reference to `helper` is rewritten to call `_helper`
   with the current value of `x` from that scope. Works as long as
   `x` is in scope wherever `helper` is referenced (which it must
   be, lexically). Smallest surface change, slight lie in the type
   (the lambda's surface arity is 1 but its IR arity is 2).

The recommended sub-option, when promoted, is (1) for the first cut:
no escape. Promote to (2) only if and when partial application lands
for other reasons.

## Revisit triggers

Promote out of `future/` (and choose B + escape policy 1 as the
default) when any of the following arrives or becomes imminent:

1. **Wrap-fatigue.** Multiple workflows in the active codebase
   contain repeated `(x) => namedWorkflow(x)` blocks at higher-order
   call sites with no other purpose than wrapping. The block syntax
   stops earning its keep.
2. **Strategy pattern.** A real use case appears where the choice
   between workflows must be made at runtime against a variable,
   and the inline branch alternative is visibly worse than a value
   selection.
3. **Task-as-value lands.** If the task model grows first-class
   values for any reason (dynamic dispatch, plug-in tasks),
   workflows should match.
4. **Higher-order combinator demand.** Library-shaped combinators
   (`compose(a, b)`, `pipeline([a, b, c])`) become useful and
   cannot be expressed without workflow values.

At promotion, the recommended bundle is:

- Lambda sugar + explicit `workflow ()` value form.
- A workflow type `(I) -> O` in the surface type system.
- Capture-by-lifting via Option B (higher-order call carries
  captured outer values as `inputs`).
- Escape policy (1): lambdas may not be bound and passed across
  scopes in v1 of the value feature; promote to (2) or (3) only if
  needed.

## What does NOT change at promotion

- `WorkflowCallNode` and `WorkflowBody` shape: unchanged.
- `WorkflowRef`: unchanged (still names a workflow body in the
  registry; anonymous bodies just have synthetic names).
- The sub-scope contract used by loop bodies and fork branches:
  unchanged; lambda bodies adopt the same shape.
- Existing `export` / `import` / private-by-default visibility
  semantics: unchanged.

The IR is **forward-compatible** with this change because §4.2 of
the composition doc explicitly preserves the call-node value shape
even while the DSL withholds the value-binding surface.

## Risks and costs of deferral

- Repeated wrap blocks (`(x) => f(x)`) at higher-order positions
  make code noisier than necessary. Not blocking.
- No way to express "this configuration selects among workflow X
  and workflow Y at runtime." Workaround: an inline branch with
  both calls.
- The DSL has a small inconsistency between "you can name and reuse
  a number, a string, an array" and "you cannot name and reuse a
  workflow." Authors may find this surprising on first encounter.

## Open questions

- **Type inference scope.** How aggressive is parameter-type
  inference for lambdas in higher-order positions? At minimum the
  call-site context fixes the input type and the body's last
  expression fixes the output type. Anything more aggressive needs
  a real spec.
- **Display name for anonymous workflows.** Synthetic entries in
  the `workflows` table need names for diagnostics. `_anon_<loc>`
  or similar; tooling-only concern.
- **Interaction with effect inference (deferred).** If/when
  effects become explicit, do anonymous workflows inherit them
  from their lexical environment, or are they computed
  independently from their body? Probably the latter.
- **Recursion through anonymous workflows.** Can a lambda call
  itself? Almost certainly no (no self-reference without a name);
  document explicitly.

## Non-goals

- Designing partial application.
- Adding a general function type system to the DSL beyond the
  workflow type `(I) -> O`.
- Making tasks first-class values (separate concern; if it
  happens, this work should align).
- Allowing lambdas to access mutable state from outer scope (the
  DSL has no mutable state at this scope level; nothing to design).
