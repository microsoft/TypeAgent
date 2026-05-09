# No expressions in the IR (decision 0006)

Status: **Adopted (v1).** The IR has no expression sublanguage.
Arithmetic and comparisons are standard-library tasks. The DSL hides
them. Revisit trigger: row 11 of
[../revisit-triggers.md](../revisit-triggers.md).

## Purpose

This is the decision record for the question: should the IR include
an expression sublanguage (arithmetic, string operations, comparisons)
in reference positions, or should all computation go through
registered tasks?

A future reviewer should read this document when:

- proposing `$expr` or any computation form inside template positions;
- asking why simple arithmetic (`i + 1`) requires a task node;
- evaluating the cost of standard-library tasks in loop patterns;
- designing the DSL's lowering of inline expressions;
- considering a restricted expression form for branch predicates.

Cross-references:

- [../ir-v1.md](../ir-v1.md) §1.4 tension table ("engine needs total
  dispatch with no expression evaluator on the hot path"), §3.4
  (template model evaluates but does not compute), §8.3 (branch model
  rejects embedded expression language).
- [0007-value-construction-in-references.md](0007-value-construction-in-references.md)
  K8 (explicit carve-out: templates do not introduce expressions).
- [../../principles/design-principles.md](../../principles/design-principles.md)
  P1 (tasks as boundary), P5 (surprise surface).
- Scenario evidence: morning-brief workflow (S2: verbose
  int-arithmetic nodes for index stepping; G3: no way to express
  parallel fetches); summarize-url workflow (G1: no inline string
  concatenation forces a template task).

---

## 1. The question

The IR's template model (decision 0007) lets reference positions hold
JSON templates: `$from` references resolve to values, bare JSON
literals pass through. But templates do not compute. There is no way
to write `i + 1`, `len(repos)`, `a < b`, or `"repo:" + name` in a
reference position.

The workaround is standard-library tasks: `int.add`, `int.lessThan`,
`list.length`, `list.elementAt`, `list.append`, `bool.toLabel`. Each
is a one-line computation packaged as a registered task
implementation. From the IR's perspective these are ordinary tasks
with typed inputs and outputs; the engine dispatches them the same way
it dispatches `email.fetchUnread`.

The question is whether this workaround is the right long-term answer
or whether the IR should grow an expression sublanguage.

---

## 2. The cost of no expressions

### 2.1 Node-count inflation

A4's repo loop needs to compute `i + 1 < len(repos)` to decide
whether to iterate. Under "no expressions," this requires four task
nodes and one branch node:

```
stepIndex    (int.add: i, 1)
computeLength (list.length: repos)
compareIndex (int.lessThan: stepped, repoCount)
labelDone    (bool.toLabel: hasMore, "more", "done")
checkDone    (branch: doneLabel -> @iterate | @exit)
```

A predicate branch with expressions would collapse this to:

```
checkDone    (branch: i + 1 < len(repos) -> @iterate | @exit)
```

Five nodes become one. This is not a corner case: every loop over a
list hits exactly this pattern. B1's retry loop has the same shape.

### 2.2 Standard-library task inventory

For A4 alone, the IR needs 6 standard-library tasks. Each requires a
registered implementation, an `inputSchema`, an `outputSchema`, and
validation against the task contract. The tasks are trivial (each is
a one-line function body), but the IR machinery around them is not:
each use site is a full task node with schemas, inputs, bind, and
next.

### 2.3 Compound cost with the branch model

The branch model (§8.3) uses discriminant dispatch: the selector
resolves to a string, which is looked up in a `cases` map. There are
no predicate branches. Combined with no expressions, this means a
boolean condition must be: (a) computed by a comparison task, (b)
converted to a string label by `bool.toLabel`, (c) dispatched by the
branch. Three steps for what a predicate branch does in one.

G3 in A4 documents this as the multiplicative cost of two
minimization decisions.

### 2.4 DSL compression ratio

A4's DSL hint shows the same workflow in ~15 lines vs. ~480 lines of
IR (~32x compression). Roughly 100 of those 480 lines are
standard-library task nodes that exist solely because there are no
expressions. The DSL hides them completely: `i + 1 < len(repos)` is
a single inline expression that the DSL lowers to the four-task
pattern.

---

## 3. The alternatives

### Alternative A: no expressions, ever (standard-library tasks)

The IR stays expression-free. All computation is packaged as
registered tasks. The engine dispatches `int.add` the same way it
dispatches `email.fetchUnread`. The DSL hides the verbosity.

**What it buys:**

- **One concept class.** The IR has tasks, references, and templates.
  There is no fourth concept (expression evaluation). A reader who
  understands task dispatch understands everything.
- **No evaluation semantics.** The engine does not need an expression
  evaluator. There is no question of evaluation order, short-circuit
  semantics, error propagation from subexpressions, or type coercion
  rules. Every "computation" is a task with typed input/output and
  the same error model as any other task.
- **P1 clean.** Tasks are the computation boundary (P1). Standard-
  library tasks stay inside that boundary. Expressions would create a
  second computation surface outside the boundary.
- **P5 clean.** No new surprise surface. The reader already knows how
  tasks work; `int.add` is just another task.
- **Validator unchanged.** The validator walks task nodes, resolves
  references, checks schemas. Standard-library tasks are validated
  identically to domain tasks. An expression sublanguage would need
  its own type-checking pass.

**What it costs:**

- Node-count inflation (§2.1): 4 extra nodes per loop-counter check.
- Standard-library task inventory (§2.2): a growing set of trivial
  tasks the engine must ship.
- Compound cost with discriminant branches (§2.3).
- The DSL must lower every inline expression to task nodes - this is
  mechanical but makes the lowering more complex than a direct
  mapping.

### Alternative B: tiny pure-functional expression sublanguage

A new `$expr` form in template positions. Expressions are
pure-functional (no side effects, no state mutation), statically
typed, and limited to a small set of operations: arithmetic,
comparisons, string concatenation, array/object access.

Possible syntax (strawman):

```jsonc
"selector": {
  "$expr": "lessThan",
  "args": [
    { "$expr": "add", "args": [{ "$from": "state", "name": "i" }, 1] },
    { "$expr": "length", "args": [{ "$from": "input", "name": "repos" }] }
  ]
}
```

Or a string-based expression language:

```jsonc
"selector": { "$expr": "state.i + 1 < length(input.repos)" }
```

**What it buys:**

- Eliminates the standard-library task inventory for arithmetic.
- Collapses 4-5 task nodes into one expression per loop.
- Reduces the DSL-to-IR gap: the DSL's inline expressions map
  directly to `$expr` rather than lowering to task nodes.
- The branch model could support predicate expressions directly,
  removing `bool.toLabel`.

**What it costs:**

- **New concept class.** The IR now has four concepts: tasks,
  references, templates, and expressions. A reader must learn
  expression evaluation semantics in addition to task dispatch.
- **Evaluation semantics.** What happens when `$expr` divides by
  zero? What is the type of `"repo:" + name`? Does
  `length(null)` return 0 or error? Every edge case needs an answer.
- **P1 tension.** Computation now happens in two places: inside tasks
  and inside expressions. The boundary between "what the IR computes"
  and "what tasks compute" becomes fuzzy. Where does string formatting
  go? Date arithmetic? JSON path queries?
- **P5 cost.** The expression sublanguage is a new surprise surface.
  Even if small, it has its own syntax, its own type rules, its own
  error semantics. A reader encountering `$expr` for the first time
  must learn a new sublanguage.
- **Validator cost.** The validator needs an expression type-checker
  in addition to the existing schema-based type-checker.
- **Scope creep pressure.** Once `$expr` exists, every "wouldn't it
  be nice if the IR could compute X" request has a natural home.
  String formatting, date manipulation, conditional expressions,
  list comprehensions - all are reasonable additions to an expression
  language. The minimization discipline (§1.3.1) says: do not pay
  this cost until forced.
- **Two syntax designs.** The object form (first strawman) is
  verbose and tree-shaped - not much better than task nodes. The
  string form (second strawman) is a new parser with its own grammar,
  escaping rules, and precedence. Neither is free.

### Alternative C: expression support only in the DSL (DSL-only)

This is Alternative A for the IR, but with an explicit stance that
the DSL is the expression surface. The IR never sees expressions;
the DSL lowers `i + 1` to an `int.add` task node. The difference
from pure Alternative A is that this alternative names the DSL as
the answer rather than leaving it implied.

The distinction matters for one reason: under Alternative C, the
standard-library tasks are a DSL lowering target, not a hand-
authoring surface. Their verbosity is acceptable because no human
writes them. This reframes the §2.1 cost: node-count inflation is a
DSL implementation detail, not a user-facing problem.

---

## 4. Principle analysis

| Principle                      | Alternative A                                                                                                   | Alternative B                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P1 (tasks as boundary)         | Clean. One computation surface.                                                                                 | Tension. Two computation surfaces (tasks and expressions).                |
| P3 (structural correspondence) | Neutral. Standard-library tasks have the same structure as domain tasks.                                        | Neutral. Expressions have their own structural correspondence question.   |
| P5 (surprise surface)          | Clean. No new concepts.                                                                                         | Cost. Expression sublanguage is a new reader burden.                      |
| §1.2 (explicit, no sugar)      | Clean. Tasks are explicit.                                                                                      | Mixed. `$expr` is explicit but could be seen as sugar for task nodes.     |
| §1.3.1 (minimization)          | Wins. Fewest concepts.                                                                                          | Loses. Adds a concept class.                                              |
| §1.3.2 (uniformity / P3)       | Mild tension. `int.add` looks like a domain task but behaves differently (trivial, inlinable, engine-provided). | Wins. Expressions are a distinct surface for a distinct behavioral class. |
| §1.4 (boundary closure)        | Clean. No expression evaluator on the engine hot path.                                                          | Tension. Expression evaluator is on the hot path.                         |

The principles favor Alternative A (no expressions) on P1, P5,
§1.3.1, and §1.4. Alternative B wins only on §1.3.2 (uniformity):
standard-library tasks look like domain tasks but are
computationally trivial, which is a uniformity violation. This is
the same P3-vs-minimization tension seen in decision 0007 (§1.3.2
vs §1.3.1), and the resolution is the same: minimization wins when
the cost is manageable, which it is here because the DSL hides the
verbosity.

---

## 5. Recommendation

**Adopt Alternative A (no expressions) for v1, framed as
Alternative C (DSL-only).**

Rationale:

1. **Minimization.** Expressions add a concept class the IR does not
   need. Every computation expressible with expressions is also
   expressible with standard-library tasks. The concepts are
   equivalent in power; the question is surface cost, which the DSL
   absorbs.

2. **P1 integrity.** The task boundary is the IR's strongest
   structural invariant. Everything that computes goes through
   `executeAction`. Expressions would create a second computation
   channel that bypasses the task contract (no `inputSchema`/
   `outputSchema` validation, no `onError` routing, no tracing
   events). Keeping one channel is worth the verbosity.

3. **Engine simplicity.** The engine dispatches tasks and resolves
   templates. It does not evaluate expressions. This keeps the
   runtime small and the failure modes few.

4. **DSL absorbs the cost.** The standard-library tasks are a
   lowering target. `i + 1` in the DSL lowers to `int.add(state.i,
1)` in the IR. The human never sees the task node. The IR's
   verbosity is a DSL implementation detail.

5. **Reversible.** If a future scenario shows that standard-library
   tasks are inadequate (performance-critical expression evaluation,
   or a case where the DSL cannot hide the cost), `$expr` can be
   introduced as a new template-position key under the `$`-prefix
   reservation (decision 0007, revisit trigger row 10). The
   reservation was designed for exactly this kind of extension.

**Named prediction:** the standard-library task pattern will hold for
v1. The first serious pressure will come from string interpolation
(constructing error messages, display names, or URLs from multiple
sources), which is awkward as a task but expressible. If string
interpolation alone forces `$expr`, that is the minimal viable
expression sublanguage: pure-functional, string-typed, no arithmetic.

---

## 6. Standard-library task contract

For clarity, the standard-library tasks are:

| Task             | Purpose                        | Input                                                 | Output                |
| ---------------- | ------------------------------ | ----------------------------------------------------- | --------------------- |
| `int.add`        | Integer addition               | `{ a: integer, b: integer }`                          | `{ result: integer }` |
| `int.lessThan`   | Integer comparison             | `{ a: integer, b: integer }`                          | `{ result: boolean }` |
| `list.length`    | Array length                   | `{ list: any[] }`                                     | `{ length: integer }` |
| `list.elementAt` | Index into array               | `{ list: any[], index: integer }`                     | `{ element: any }`    |
| `list.append`    | Append to array                | `{ list: any[], item: any }`                          | `{ list: any[] }`     |
| `bool.toLabel`   | Boolean to string discriminant | `{ value: boolean, ifTrue: string, ifFalse: string }` | `{ label: string }`   |

These are engine-provided, registered at load time, and validated
against the same task contract as domain tasks. The engine may
inline their dispatch (skipping the full `executeAction` path) as a
performance optimization; this is invisible to the IR and the
validator.

The inventory is scenario-driven: A4 and B1 together required these
six. Additional standard-library tasks are added when a new scenario
needs a computation that no existing task provides. The DSL may
define convenience tasks (e.g., `string.concat`, `int.multiply`)
that lower to standard-library IR tasks; these are DSL-layer
concerns and do not appear in this record.

---

## 7. What this decision does not cover

- **The DSL's expression language.** The DSL will have inline
  expressions. Their syntax, type system, and lowering rules are DSL
  design questions, not IR questions. This decision says only that
  the lowering target is task nodes, not `$expr`.
- **String interpolation.** Named as the likeliest pressure point
  (§5). If it forces `$expr`, that is a narrow extension, not a
  general expression sublanguage.
- **Branch predicates.** §8.3 of ir-v1.md rejects predicate branches
  for v1. This decision is consistent with that rejection but does
  not depend on it. If predicate branches are later adopted (revisit
  trigger row 2), they could use `$expr` or they could use a
  restricted predicate form that is not a general expression
  language. **Coupling note:**
  [decision 0008](0008-discriminant-key-encoding.md) (discriminants
  must be strings) is downstream of this decision. `bool.toLabel`
  exists because the IR has no expressions. If this decision flips,
  0008 loses its rationale and should flip together: boolean
  predicates in branches become natural, and `bool.toLabel`
  disappears. The two decisions share the P1 boundary commitment
  (tasks are the only computation surface).
- **MapNode / foreach.** A foreach loop construct (post-v1) would
  eliminate much of the standard-library task machinery for list
  iteration. That is a separate concept (a new node kind) and a
  separate decision. This decision assumes the v1 loop model.

---

## 8. Revisit conditions

Register as revisit trigger row 11:

- **Trigger:** a scenario surfaces a computation that (a) cannot be
  expressed as a standard-library task, or (b) the standard-library
  task pattern produces pathological node counts (>10 task nodes for
  a single conceptual computation), or (c) string interpolation is
  needed at >3 sites in a single workflow and the `string.concat`
  task is inadequate.
- **Likeliest path:** string interpolation for error messages or
  display values.
- **Minimal response:** `$expr` as a template-position key,
  string-typed, pure-functional, no arithmetic. Extend only if
  arithmetic is independently forced.
