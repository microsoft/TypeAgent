# Finish WorkflowScope unification: branch arms and loop termination (decision 0010, proposal)

Status: **Accepted** (2026-05-19). Reconsiders the "Branch model" row of
[../ir-v0.1.md](../ir-v0.1.md) §1.1.3 and the loop-sentinel design of
§3.7 / §8.4 in light of the v0.2 IR. Proposes two coupled changes that
together finish the WorkflowScope unification begun by
[../workflow-scope-proposal.md](../workflow-scope-proposal.md):

1. **Branch arms as `WorkflowScope`.** The discriminant `branch` kind
   adopts the `WorkflowScope`-per-arm pattern that `fork` already uses
   for its branches. The §3.6 prohibition on branch outputs and `bind`
   is lifted.
2. **Loop termination as predicate.** The loop node gains a
   `continueWhen` reference resolved in the body scope at body
   completion. The `@iterate` / `@exit` sentinels are retired; the
   loop body becomes a plain `WorkflowScope` matching fork branches
   and forkMap bodies.

The two changes are coupled because change 1 introduces an
expressiveness regression (branch arms can no longer target
`@iterate` / `@exit` directly), and change 2 dissolves that regression
by removing the sentinels entirely. Bundling avoids a transient IR
state in which either the regression stands or a vestigial workaround
field is added.

Together the changes are framed as **finishing an existing pattern**,
not as adding a new mechanism: `WorkflowScope` already exists
([../workflow-scope-proposal.md](../workflow-scope-proposal.md),
Accepted; [../ir-v0.2.md](../ir-v0.2.md) §2.1 implements it for fork);
this proposal extends its use to the one structured kind that opts
out (branch arms) and removes the routing-layer escape hatch
(`@iterate` / `@exit`) that prevented loop body from being a plain
`WorkflowScope`.

Does **not** propose adopting predicate-style branches (see §1.1) and
does **not** propose revoking
[0006-no-expressions-in-ir.md](0006-no-expressions-in-ir.md). Arm
outputs, loop outputs, and the new loop `continueWhen` are all
reference templates resolved at scope completion, never expression
evaluation.

Originating context: DSL gap analysis G5
([../../dsl/dsl-v0.1-gap.md](../../dsl/dsl-v0.1-gap.md)), which surfaced
that the emitter's `identity` + shared-bind + `noop` merge lowering for
value-producing branches is load-bearing rather than incidental. The
loop-termination change is brought in because the branch change cannot
land cleanly without it (see §3.6 below and §5.6.2 in earlier drafts).

## Purpose

A future reviewer should read this document when:

- asking whether a discriminant `branch` should be able to produce a
  value;
- evaluating proposals to remove `identity` / `noop` as load-bearing
  lowering builtins;
- designing DSL `if`/`switch`/`?:`-as-expression lowering;
- asking why `fork` branches use `WorkflowScope` but discriminant
  `branch` arms do not;
- asking why the loop node uses string sentinels (`@iterate`,
  `@exit`) when no other structured kind has in-scope routing
  targets that pierce its sub-scope;
- resolving validator coverage of branch-return convergence (G6 in
  the DSL gap doc) without prefix-string heuristics.

Cross-references:

- [../ir-v0.1.md](../ir-v0.1.md) §1.1.3 (Branch model row), §3.6
  (branch node), §3.7 (loop), §5.3 (branch execution), §5.7
  (dispatch contract), §8.3 (branch model rationale), §8.4 (loop
  sentinels rationale), §8.5 (state writes rationale), §8.6 (state
  commit timing).
- [../ir-v0.2.md](../ir-v0.2.md) §2.1 (fork), §2.2 (forkMap) -
  precedent for `WorkflowScope` per branch with explicit `output`.
- [../workflow-scope-proposal.md](../workflow-scope-proposal.md) -
  Accepted; defines `WorkflowScope` and its use across
  workflow/loop/fork/forkMap.
- [0001-bound-outputs.md](0001-bound-outputs.md) (hide-by-default
  `bind`; this proposal uses the existing mechanism unchanged).
- [0002-cfg-ddg-separation.md](0002-cfg-ddg-separation.md) (branch
  gains a DDG edge via `bind`, same as task/loop/fork).
- [0006-no-expressions-in-ir.md](0006-no-expressions-in-ir.md) (not
  reopened; arm outputs and `continueWhen` are template references,
  not expressions).
- [0009-loop-output-source.md](0009-loop-output-source.md) (precedent
  for "scope output resolved in scope context at completion";
  extended here to "termination predicate resolved in scope context
  at completion").
- [../revisit-triggers.md](../revisit-triggers.md) (branch-model and
  loop-sentinel trigger rows updated on adoption).
- [../../dsl/dsl-v0.1-gap.md](../../dsl/dsl-v0.1-gap.md) G5
  (`identity`/`noop` lowering analysis), G6 (validator branch-return
  convergence; dissolves under this proposal).
- [../../principles/design-principles.md](../../principles/design-principles.md)
  P1-P5 and the minimization rule.

---

## 0. The reframing: WorkflowScope unification, branch and loop

Under the v0.2 IR, every structured construct nests its sub-execution
as a `WorkflowScope`. The unification is, however, incomplete in two
related ways:

| Kind         | Uses `WorkflowScope`?       | Declared `output`?    | May `bind`? | In-scope routing escape hatch?     |
| ------------ | --------------------------- | --------------------- | ----------- | ---------------------------------- |
| top-level    | yes (extends WorkflowScope) | yes                   | n/a         | none                               |
| `task`       | n/a (opaque executable)     | yes (opaque)          | ✅          | n/a                                |
| `loop`       | yes (`body`)                | yes (at `@exit`)      | ✅          | **`@iterate` / `@exit` sentinels** |
| `fork`       | yes (per branch's `scope`)  | yes (combined object) | ✅          | none                               |
| `forkMap`    | yes (`body`)                | yes (array of bodies) | ✅          | none                               |
| **`branch`** | **❌ (arms are nodeIds)**   | **❌**                | **❌**      | n/a                                |

Two carve-outs, both v0.1 artifacts:

- **Branch arms are not `WorkflowScope`s.** Predates v0.2's adoption
  of `WorkflowScope` for fork. Forces `identity` + `noop` lowering
  for value-producing branches and a prefix-string phi heuristic in
  the validator (DSL gap G5, G6).
- **Loop body has in-scope routing targets that pierce the
  sub-scope.** `@iterate` and `@exit` are addressable from inside the
  body (and from inside a branch's arms today). This is the only
  case in the IR where control flow inside a sub-scope can name a
  control point outside it directly. It is the reason a v0.1 branch
  inside a loop body can encode "more / done" as `cases: { more:
"@iterate", done: "@exit" }`.

The two carve-outs are coupled. Removing the branch-arm carve-out
without also removing the sentinel carve-out leaves an
expressiveness regression in loop bodies. Removing the sentinel
carve-out without also removing the branch-arm carve-out is possible
but loses motivation: the sentinels were originally adopted so that
branches inside loop bodies could route iteration. Once branches
inside arm scopes cannot reach sentinels anyway, the sentinels'
remaining users are tail body nodes deciding "iterate vs exit," a
decision that fits naturally on the loop node as a predicate
reference.

This proposal closes both carve-outs. Branch arms become
`WorkflowScope`s with declared output. Loop termination becomes a
`continueWhen` reference on the loop node, mirroring the existing
`output` reference (decision 0009). After both changes, every
structured construct uses `WorkflowScope` with the same scope-
closure, completion, and reference-resolution rules.
each fork branch as a `WorkflowScope` with explicit `output`:

> "Each branch executes its sub-scope independently [...] The fork's
> output is an object keyed by branch name, each value resolved from
> that branch sub-scope's explicit `output` template. Branch outputs
> are not inferred from terminal bind names or by scanning branch-local
> bindings." — [../ir-v0.2.md](../ir-v0.2.md) §2.1

Discriminant `branch` is morally "fork, but execute only the arm
selected by `selector`." Yet today it uses a different structural model
(arms are nodeIds, no `output`, no `bind`). This proposal aligns
discriminant `branch` with the established pattern.

## 1. Scope

### 1.1 In scope

**Branch-arm change:**

Adopt `WorkflowScope`-per-arm for the discriminant `branch` kind.
`cases[<caseValue>]` and `default` change from `<nodeId>` to a
`{ inputs, scope: WorkflowScope }` shape, mirroring fork's
`branches[<branchName>]`. Branch gains `outputSchema`, `bind`, `next`,
and `onError`, mirroring fork.

**Loop-termination change:**

The loop node gains a `continueWhen` reference resolved in the body
scope at body-scope completion. The `@iterate` and `@exit` sentinels
are retired. Loop body becomes a plain `WorkflowScope` with the same
"runs to natural end" completion rule as fork branches and forkMap
bodies. `iterateState` is resolved at the same point `continueWhen`
is evaluated; the existing snapshot-read semantics (§8.6) are
preserved by retiming the commit to body-scope completion rather
than to a sentinel transition.

### 1.2 Out of scope

This proposal does **not** address the discriminant-vs-predicate axis
of §1.1.3. Selector is still computed by an upstream task; decision
0006 (no expressions in the IR) is preserved. The new `continueWhen`
is likewise a reference to a boolean value produced by an upstream
body-scope task, not an expression.

This proposal does **not** modify `WorkflowScope` itself, fork,
forkMap, or the top-level workflow shape. It modifies branch and
loop only.

This proposal does **not** propose removing `identity` or `noop` from
the standard task library. They remain available as ordinary tasks for
non-branch literal materialization (literal-only workflows, scopes that
choose to express literal-as-task for tracing reasons, etc.); they
simply cease to be required at branch convergence.

This proposal does **not** change the `state` / `iterateState`
mechanism or its read semantics. Only the commit _point_ moves (from
the `@iterate` sentinel transition to body-scope natural completion).

## 2. The §1.1.3 row, before and after

### Before (v1)

| Tension      | Writer pull         | Engine sufficiency / cost                                                 | v1 resolution                                | Where               |
| ------------ | ------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------- |
| Branch model | Predicate `if/else` | Engine needs total dispatch with no expression evaluator on the hot path. | Discriminant switch with required `default`. | §8.3, decision 0006 |

### Proposed amendment

| Tension      | Writer pull                                               | Engine sufficiency / cost                                                                                                                                        | Proposed resolution                                                                                                                                                                                           | Where                                       |
| ------------ | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Branch model | Predicate `if/else`, branch-as-expression value selection | Engine needs total dispatch with no expression evaluator on the hot path; scope-output resolution is the same machinery already used by loop, fork, and forkMap. | Discriminant switch with required `default`; **arms are `WorkflowScope`s with declared `output`, same shape as fork branches (ir-v0.2 §2.1). Branch supports `bind`, `next`, `onError`, and `outputSchema`.** | §8.3, ir-v0.2 §2.1, decisions 0006 and 0010 |

A new row is added for the loop-termination change:

| Tension          | Writer pull                                             | Engine sufficiency / cost                                                                                                                                         | Proposed resolution                                                                                                                                                                        | Where                               |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Loop termination | Body should be able to decide "iterate vs exit" locally | Engine needs a single termination decision per iteration; reference resolution to a boolean is the same machinery already used for loop `output` (decision 0009). | Loop node carries `continueWhen` (boolean reference resolved in body scope at body completion). `@iterate` / `@exit` retired. Body becomes a plain `WorkflowScope` matching fork branches. | §3.7, §8.4, decisions 0009 and 0010 |

The predicate-side writer pull remains resolved against (decision 0006
stands). The value-producing writer pull is met by extending the
already-adopted `WorkflowScope` pattern to the one structured kind
currently excluded from it. The loop-termination row replaces the
sentinel-based routing with a reference-based decision, following the
same shape as decision 0009 for `output`.

## 3. Concrete IR change sketch

### 3.1 Branch node, proposed shape

```jsonc
{
  "kind": "branch",
  "selector": {
    /* reference object yielding a discriminant value */
  },
  "selectorSchema": {
    /* JSON Schema; string-typed enum or string per decision 0008 */
  },
  "cases": {
    "<caseValue>": {
      "inputs": {
        /* outer -> arm-scope wiring, templates */
      },
      "scope": {
        /* WorkflowScope */
      },
    },
  },
  "default": {
    // optional; see exhaustiveness contract
    "inputs": {
      /* ... */
    },
    "scope": {
      /* WorkflowScope */
    },
  },
  "outputSchema": {
    // optional; required iff any arm declares an output
    /* JSON Schema. Compatible with every arm's scope.outputSchema. */
  },
  "next": "<nodeId>", // optional
  "onError": "<nodeId>", // optional; new for branch (parallel to fork)
  "bind": "<scopeVarName>", // optional; hide-by-default per §8.15
}
```

Notes:

1. **`cases[k]` and `default` are wrappers around `WorkflowScope`,
   identical in shape to fork's `branches[k]`.** Each arm carries
   `inputs` (outer-to-arm wiring) and `scope` (the arm's
   `WorkflowScope`).
2. **`scope.output` resolves at arm-scope completion**, exactly as for
   fork branches (ir-v0.2 §2.1 step 4). The arm-region question is
   answered by `WorkflowScope` itself: the scope is closed; `next:
null` inside the arm scope means arm-scope completion; output is
   the explicit template.
3. **Branch's combined output is the value of whichever arm's
   `scope.output` resolved.** Unlike fork (which combines all branches
   into one object), branch picks one. `outputSchema` is the type of
   that single value and must be compatible with every arm's
   `scope.outputSchema`.
4. **`bind` follows §8.15.** Hide-by-default unless declared.
5. **`onError` is new for branch.** Fork already has `onError`. Under
   v0.1, branch had no `onError` because selector failure was
   statically excluded and arms had no convergence point; under this
   proposal an arm's `scope` can fail just like a fork branch's scope,
   so `onError` becomes meaningful and parallel to fork's semantics.
   The selector-failure exclusion is preserved (selectorSchema +
   discriminant narrowing).
6. **Exhaustiveness contract preserved.** `default` is optional iff the
   branch is statically exhaustive (same rule as v1 §3.6).

### 3.2 Arm-region question: resolved

The question "where does an arm end?" - which was open under the
earlier `outputs.perCase` framing - is resolved by `WorkflowScope`:

- An arm is a closed sub-scope with its own `entry`, `nodes`, and
  `output`.
- An arm "ends" when its scope completes, defined identically to fork
  branch completion: control reaches a node with `next: null` inside
  the arm's `scope.nodes`, then `scope.output` resolves.
- No post-dominator analysis. No emitter-specific prefix conventions.
- Cross-scope visibility follows the existing `WorkflowScope` rules
  (declared `inputs`, no leakage out of the scope except via
  `scope.output`).

This is the same answer the IR already gives for fork branches, loop
bodies, and forkMap bodies.

### 3.3 Validator changes

Most validation is **reuse** of the existing per-`WorkflowScope` checks:

1. **Per-arm scope validation.** Each `cases[k].scope` and
   `default.scope` is validated as a `WorkflowScope` using the same
   passes loop bodies and fork branches already use (dominator, type
   compatibility, scope closure, `output` template resolves in the
   scope's binding context).
2. **`inputs` wiring.** Each arm's `inputs` templates resolve in the
   branch's outer scope and validate against the arm's
   `scope.inputSchema`. Identical to fork.
3. **Output schema compatibility.** If `outputSchema` is declared on
   the branch, every arm's `scope.outputSchema` must be assignable to
   it. Differs from fork (which combines arms into one object); for
   branch, the combination operation is selection, so all arms must
   be compatible with the same selected-output schema.
4. **Exhaustiveness.** Unchanged (§3.6 exhaustiveness contract).
5. **`bind` and `outputSchema` co-required.** If `bind` is declared,
   `outputSchema` must be declared. (Otherwise the bound name has no
   declared type.)

### 3.4 Execution semantics

Folds into §5.3. The semantics are "fork, but pick one":

1. Resolve `selector` against the branch's outer scope (unchanged).
2. Look up `cases[<selector value>]` (or `default`) (unchanged).
3. Resolve the selected arm's `inputs` templates against the outer
   scope; validate against `scope.inputSchema`.
4. Execute the selected arm's `scope` to completion exactly as fork
   would execute one branch.
5. Resolve `scope.output` against the arm-scope's final binding
   context; validate against `scope.outputSchema`.
6. If `outputSchema` is declared on the branch, validate the resolved
   arm output against it; publish under `bind` if declared.
7. Continue at `next` (or workflow exit / scope exit per existing
   rules).

Error semantics mirror fork: if the selected arm fails, `onError`
fires if declared, else propagates.

No expression evaluator. Template resolution and schema validation are
existing machinery.

### 3.5 Short-circuit `&&` / `||` lowering

ir-v0.2 §3.2 notes that `&&` and `||` lower to **branch nodes** today
(via the v0.1 shape). Under this proposal those lowerings declare arm
scopes with explicit boolean `output`. The DSL gap doc's G6 strategy
(c) "split-point phi coverage for short-circuit operators" disappears:
each lowered branch is a single node whose arm scopes declare their
outputs.

### 3.6 Loop node, proposed shape

```jsonc
{
  "kind": "loop",
  "inputs": {
    /* outer -> body scope wiring, templates */
  },
  "inputSchema": {
    /* JSON Schema */
  },
  "state": {
    "<stateVarName>": {
      "schema": {
        /* JSON Schema */
      },
      "initial": {
        /* reference resolved at loop entry, in outer scope */
      },
    },
  },
  "body": {
    /* WorkflowScope */
  },
  "continueWhen": {
    /* reference object resolved in body scope at body-scope completion;
       must yield a boolean. true = iterate (next iteration). false = exit. */
  },
  "iterateState": {
    "<stateVarName>": {
      /* reference resolved in body scope at body-scope completion */
    },
  },
  "output": {
    /* reference resolved in body scope at body-scope completion of the
       final iteration (the iteration in which continueWhen resolved false) */
  },
  "outputSchema": {
    /* JSON Schema */
  },
  "maxIterations": 1000, // optional; engine default 10,000
  "next": "<nodeId>", // optional
  "onError": "<nodeId>", // optional
  "bind": "<scopeVarName>", // optional
}
```

Notes:

1. **`body` is a plain `WorkflowScope`.** Same shape as fork branches
   and forkMap bodies. Body runs to natural completion (any
   `next: null` reached); there are no in-scope routing sentinels.
2. **`continueWhen` decides iteration.** Resolved in body scope at
   the moment the body reaches natural completion, against the same
   binding context that resolves `iterateState` and `output`. Must
   yield a boolean.
3. **`continueWhen` is a reference, not an expression.** Decision
   0006 preserved. The boolean is produced by an upstream body-scope
   task, exactly like the discriminant feeding a branch's `selector`.
4. **`iterateState` semantics unchanged.** Resolved at the same
   point `continueWhen` is evaluated. If `continueWhen` yields true,
   a new iteration begins with state computed from `iterateState`.
   The §8.6 snapshot-read semantics carry over: reads in iteration
   `i` see state as of iteration-`i` start.
5. **`output` semantics unchanged in substance** (decision 0009).
   Resolved in body scope at the final iteration's body completion
   - i.e., the same iteration that resolved `continueWhen` to false.
     The commit _point_ moves from "`@exit` transition" to
     "body-completion-with-`continueWhen`-false" but the binding
     context and reference shape are identical.
6. **`maxIterations` semantics unchanged.** If reached before
   `continueWhen` yields false, the loop fails with the existing
   well-known error type (consumable by `onError`).
7. **No `@iterate`, no `@exit`.** They are retired from the IR.
   Branch arms inside a loop body have no special routing; they
   compute and publish like any other branch.

### 3.7 Loop execution semantics

Folds into §5 (replacing the §5 loop semantics):

1. At loop entry, resolve `inputs` and `state.*.initial` in the
   outer scope.
2. Execute one iteration: run `body` (a `WorkflowScope`) to natural
   completion.
3. At body completion, resolve `continueWhen` in body scope.
4. If `continueWhen` yields true: resolve `iterateState` in body
   scope, commit next iteration's state, return to step 2.
5. If `continueWhen` yields false: resolve `output` in body scope,
   validate against `outputSchema`, publish under `bind` if declared,
   continue at `next` (or the enclosing scope's continuation per
   existing rules).
6. If `maxIterations` is exceeded: fail with the well-known error;
   `onError` fires if declared.

### 3.8 Loop validator changes

Body becomes a plain `WorkflowScope`; the existing per-`WorkflowScope`
validator passes apply (dominator, type compatibility, scope closure,
`output` template resolution). Additions:

- `continueWhen` must resolve in body scope and validate against
  `{ "type": "boolean" }`.
- `iterateState` references resolve in body scope (unchanged).
- Remove the §5.8.3 path-projection passes that special-case
  `@iterate` / `@exit`.
- Remove the validation that branch arms targeting `@iterate` /
  `@exit` do so only inside a loop body.

## 4. Trade-off analysis

### 4.1 Comparison table

The proposal has two coupled changes. The branch-arm row set:

| Property                                | A (status quo)                                                                                                                                        | B (this proposal: WorkflowScope per arm + loop continueWhen)                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------- |
| New IR concepts                         | 0                                                                                                                                                     | 1 (`continueWhen` boolean reference on loop; reuses reference-resolution machinery from decision 0009)                      |
| Special-case rules in the IR            | 2 ("branch is the only structured construct without WorkflowScope and without output"; "loop has in-scope routing targets that pierce its sub-scope") | 0                                                                                                                           |
| Hot-path engine work                    | dispatch + sentinel-transition state commit                                                                                                           | dispatch + WorkflowScope output resolution + boolean reference resolution (all already in the engine for fork/forkMap/loop) |
| Decision 0006 status                    | upheld                                                                                                                                                | upheld (arm outputs, `continueWhen`, and loop `output` are all template references, not expressions)                        |
| Decision 0001 status                    | upheld                                                                                                                                                | upheld and made uniform (hide-by-default `bind` applies to all structured kinds)                                            |
| Decision 0002 (CFG/DDG)                 | branch is CFG-only                                                                                                                                    | branch may be a DDG source when `bind` is declared; same as fork, loop                                                      |
| Decision 0009 status                    | upheld                                                                                                                                                | upheld and extended: termination joins output on the "reference resolved at scope completion" footing                       |
| P3 task boundary                        | crisp but inconsistent                                                                                                                                | crisp and uniform: no kind evaluates expressions; selection/resolution are not computation                                  |
| Minimization rule                       | violates by two exceptions                                                                                                                            | satisfies: one uniform rule across all structured kinds                                                                     |
| LLM-direct surface (§1.1.2)             | LLM must learn branch carve-out, shared-bind shim convention, and loop sentinels                                                                      | LLM learns one rule across all structured kinds: "the scope has `output`; the kind has its kind-specific reference fields"  |
| Codegen surface                         | one extra branch-convergence shape (identity shims + merge noop); special routing for loop iteration/exit                                             | one lowering shape unified across loop/fork/forkMap/branch                                                                  |
| Validator complexity                    | low + open G6 phi heuristic + sentinel path-projection passes                                                                                         | low; reuses fork's per-branch-scope validation; G6 dissolves; path-projection drops sentinel cases                          |
| Splice safety                           | easy at the IR level; hard for emitters (prefix conventions and sentinel-routed loops)                                                                | best - arms and bodies are scope-closed (P4)                                                                                |
| Static exhaustiveness                   | clean                                                                                                                                                 | clean (mechanism unchanged)                                                                                                 |
| `identity`/`noop` at branch convergence | required as load-bearing builtins                                                                                                                     | not required; remain as ordinary tasks for non-branch literal materialization                                               |
| Construct symmetry                      | branch and loop are exceptions                                                                                                                        | aligns with fork/forkMap/top-level - one scope shape across the IR                                                          |
| Debugger nodes per source decision      | ~4 (compare + branch + 2 identity + noop merge)                                                                                                       | ~1 (branch with arm scopes)                                                                                                 |
| `&&` / `                                |                                                                                                                                                       | ` lowering                                                                                                                  | uses prefix-string phi heuristic | uses ordinary arm-scope outputs |
| Loop body inner-routing escape hatch    | `@iterate` / `@exit` sentinels in-scope from anywhere in body                                                                                         | none; termination is a reference on the loop node, computed by an ordinary body-scope task                                  |

### 4.2 Where B helps

- **Removes two unprincipled exceptions.** Under v0.2,
  `WorkflowScope` is the established way every structured construct
  describes its sub-execution. Branch arms and loop sentinels are
  the two remaining holdouts. Neither is supported by any
  principle in P1-P5 or the minimization rule; both are v0.1
  artifacts predating `WorkflowScope` and the ir-v0.2 fork shape.
- **Reuse, not addition (mostly).** Branch-arm change introduces
  zero new IR concepts. Loop-termination change introduces one
  (`continueWhen`), but it reuses the reference-resolution machinery
  already used by decision 0009 for `output`. The "boolean reference
  resolved at scope completion" shape is novel only as a binding
  point on the loop node; the resolution semantics are existing.
- **Validator simplification (G6 dissolves; sentinel
  path-projection retires).** The shared-bind-through-prefixed-arm-
  tails heuristic is replaced by the same per-scope validation that
  fork already uses. The §5.8.3 sentinel projection cases retire.
- **`identity`/`noop` lose their load-bearing role.** Under A they
  are runtime contract; under B they are ordinary standard-library
  tasks available for non-branch literal materialization. G5 closes.
- **Arm-region question is resolved by precedent.** No new design
  needed: `WorkflowScope` already defines scope closure and explicit
  `output` resolution.
- **Debugger / visualizer locality.** One node per source decision,
  with each arm's body legible as a self-contained scope. Loop body
  no longer has in-scope routing targets reaching outside it.
- **LLM-direct uniformity.** An LLM authoring IR directly learns
  one pattern for sub-execution (`WorkflowScope`) and applies it
  uniformly across loop, fork, forkMap, and branch.
- **Short-circuit operator lowering simplifies.** v0.2's `&&` and
  `||` branch lowerings no longer need shims.
- **Branch-inside-loop-body pattern stays expressible.** With
  sentinels retired, the historical "more / done" pattern becomes:
  body's tail task publishes a boolean; loop's `continueWhen`
  reads it. Branches inside the loop body have no special routing
  need at all.

### 4.3 Where A wins, and what B owes

The IR is pre-1.0 with no outside consumers, so backward compatibility
is not a cost B owes. The remaining items:

- **§3.6 + §3.7 rewrites.** v0.1 §3.6 and §3.7 must both be
  largely rewritten. The §3.7 rewrite is substantial: sentinels
  retire, body becomes a plain `WorkflowScope`, `continueWhen` is
  added, `output` resolution retimes from `@exit` to
  "body-completion with `continueWhen` false." The §8.4 (loop
  sentinels) rationale is retracted.
- **More reference positions per branch.** B carries N+1 sub-scopes
  per branch (one per case + default). Tooling that walks branch
  contents must walk arm scopes. Same shape and roughly the same
  count as fork, which tooling already handles.
- **`outputSchema` selection vs combination.** Fork's `outputSchema`
  combines arm outputs into an object; branch's `outputSchema`
  selects one. Validator must understand both semantics. The
  selection semantics is the simpler of the two.
- **One new IR concept (`continueWhen`).** Net concept count is +1,
  not 0. This is the principal addition the bundled proposal makes.
  It is offset by the retirement of two sentinels (`@iterate`,
  `@exit`) and the path-projection rules they require, so the
  surface area of the IR shrinks even though one specific concept
  is added.

### 4.4 Cost B does **not** pay

- No expression sublanguage. Decision 0006 stands. `continueWhen`
  is a reference to a boolean computed by an upstream body-scope
  task, not an embedded expression.
- No predicate evaluation. Selector is still computed by an
  upstream task.
- No change to `WorkflowScope` (the existing type is used
  unchanged).
- No change to fork, forkMap, or the top-level workflow shape.
- No change to exhaustiveness contract (§3.6 exhaustiveness rule
  unchanged).
- No change to discriminant-key encoding (decision 0008).
- No change to pure-SSA (decision 0004): each arm scope is single-
  assignment within itself; loop body remains single-assignment per
  iteration.
- No change to the `bind` mechanism (decision 0001) - branch adopts
  the existing mechanism.
- No change to `state` / `iterateState` semantics. Only the commit
  point moves.
- No change to `maxIterations` semantics.

## 5. What changes if B is adopted

### 5.1 Spec edits

- **ir-v0.1.md §1.1.3:** Branch model row updated, and the new
  Loop-termination row added (both as in §2 above).
- **ir-v0.1.md §3.6:** Rewritten. The new shape is the §3.1 sketch
  above. The "no `outputs`, no `bind`, branches produce no value"
  language is retracted. The discriminant-switch rationale and the
  exhaustiveness contract are preserved. Cross-references to
  `WorkflowScope` and ir-v0.2 §2.1 are added.
- **ir-v0.1.md §3.7:** Rewritten per §3.6 of this proposal. Body
  becomes a plain `WorkflowScope`. `continueWhen` added.
  `@iterate` / `@exit` retired. `output` resolution retimes to
  body-completion-with-`continueWhen`-false. `iterateState` retimes
  similarly; snapshot-read semantics preserved.
- **ir-v0.1.md §5.3:** Branch execution rewritten per §3.4 above.
- **ir-v0.1.md §5.7:** Dispatch contract updated to include arm-scope
  completion and arm-output resolution, plus loop body completion +
  `continueWhen` evaluation.
- **ir-v0.1.md §5.8.3:** Path-projection passes simplified - sentinel
  projection cases retire.
- **ir-v0.1.md §8.3:** Rationale extended. Discriminant model
  preserved (decision 0006); the §3.6 publication asymmetry was a
  v0.1 artifact and is lifted in v0.2's `WorkflowScope` era.
- **ir-v0.1.md §8.4:** Retracted. Loop sentinels are retired in
  favor of body-completion + `continueWhen`. The original "string
  sentinel over node kinds or boolean flag" trade-off no longer
  applies; the question becomes "termination as reference vs
  termination as routing," and the reference shape wins by the
  same principles 0009 cites for `output`.
- **ir-v0.1.md §8.5:** No design change, but the historical
  "branches targeting `@iterate` directly" sub-rationale is now
  moot. Footnote, not rewrite.
- **ir-v0.1.md §8.6:** Update commit-timing description: state is
  still committed atomically per iteration; the commit _point_
  moves from `@iterate` transition to body-completion-with-
  `continueWhen`-true. Snapshot-read semantics preserved verbatim.
- **decision 0001:** no change. Cross-reference added noting branch
  now uses the existing `bind` mechanism.
- **decision 0002:** updated to list branch among DDG-source-eligible
  kinds (when `bind` is declared).
- **decision 0006:** no change. Cross-reference added noting that
  0010 is a scope-output adoption and a termination-as-reference
  adoption, not an expression addition.
- **decision 0009:** cross-reference added; branch arm output
  resolution is structurally identical to loop output resolution;
  loop `continueWhen` extends the same "reference resolved at scope
  completion" pattern from output to termination.
- **revisit-triggers.md:** the branch-model and loop-sentinel
  trigger rows are updated (the trigger conditions have been met:
  WorkflowScope landed and the branch-arm change is being adopted).
- **workflow-scope-proposal.md:** add a row to the "sites using
  WorkflowScope" list for branch arms; update the loop entry to
  note that body is now a plain `WorkflowScope` (no sentinels).
  is still pure routing; what changes is that the routing now picks
  among `WorkflowScope`s with declared outputs, the same way fork
  already does (but with selection instead of combination).
- **decision 0001:** no change. Cross-reference added noting branch
  now uses the existing `bind` mechanism.
- **decision 0002:** updated to list branch among DDG-source-eligible
  kinds (when `bind` is declared).
- **decision 0006:** no change. Cross-reference added noting that 0010
  is a scope-output adoption, not an expression addition.
- **decision 0009:** cross-reference added; branch arm output
  resolution is structurally identical to loop output resolution at
  `@exit`.
- **revisit-triggers.md:** the branch-model trigger row is updated
  (the trigger condition has been met: WorkflowScope landed).
- **workflow-scope-proposal.md:** add a row to the "sites using
  WorkflowScope" list for branch arms.

### 5.2 DSL gap doc edits

- **G5:** resolution becomes "lower value-producing `if`/`switch`/
  ternary to branch nodes whose arms are `WorkflowScope`s with
  declared `output`." `identity` and `noop` use at branch convergence
  is removed from the lowering contract; they remain in the standard
  task library for non-branch use.
- **G6:** dissolves. Per-arm-scope validation replaces the shared-bind
  phi heuristic. The four DSL-integration tests currently marked
  `NO_VALIDATE` and `skipValidation` for branch-return convergence
  become validatable. Strategy (c) "split-point phi coverage for
  short-circuit `&&`/`||`" is removed.

### 5.3 Validator changes (sketch)

Branch:

- Apply the existing per-`WorkflowScope` validator passes to each arm
  scope (dominator, type compatibility, scope closure, `output`
  template resolution).
- Validate `inputs` wiring per arm (same shape as fork branches).
- Validate that all arm `scope.outputSchema` values are compatible
  with the branch's declared `outputSchema`.
- Branch becomes a recognized DDG producer when `bind` is declared,
  reusing existing dominator + liveness passes.
- Remove the prefix-string phi heuristic (G6 strategy c).

Loop:

- Apply the existing per-`WorkflowScope` validator passes to `body`
  (it is now a plain `WorkflowScope`).
- Validate that `continueWhen` resolves in body scope and is
  boolean-typed.
- Validate that `iterateState` and `output` resolve in body scope
  (mechanism unchanged; resolution point retimed).
- Remove sentinel path-projection cases from §5.8.3.
- Remove the validation that branch arms targeting `@iterate` /
  `@exit` do so only inside a loop body (the targets no longer
  exist).

### 5.4 Runtime / engine changes (sketch)

Branch:

- Reuse the existing `WorkflowScope` execution path for each branch
  arm (the same code path fork uses per branch).
- After the selected arm scope completes, resolve `scope.output` and
  publish under `bind` if declared.
- Add `onError` handling parallel to fork's.

Loop:

- Execute `body` to natural completion (no sentinel transitions).
- At body completion, resolve `continueWhen` in body scope.
- If true: resolve `iterateState`, commit next iteration state,
  re-enter `body`.
- If false: resolve `output`, publish under `bind` if declared,
  continue at `next`.
- Existing `maxIterations` and `onError` handling unchanged.

No new scheduler, registry, or task contract changes.

### 5.5 Compatibility

The IR is pre-1.0 and has no outside consumers; this proposal does
not carry a backward-compatibility commitment. Both shape changes
land in place: v0.1 §3.6 is rewritten to the §3.1 shape and v0.1 §3.7
is rewritten to the §3.6 shape, with the emitter, validator, and
engine updated together. Hand-authored fixtures are rewritten at the
same time. No deprecation window, no dual-shape acceptance, no IR
version-bump policy.

### 5.6 Rationale carryover

v0.1 §3.6 and §3.7 / §8.4 / §8.5 / §8.6 make several claims worth
tracking through the rewrite. Two are preserved with clarification,
two are genuinely retracted (which is the point of the proposal),
and one stays in place with a footnote.

#### 5.6.1 §3.6 "No `onError`" - preserved in part, augmented in part

v0.1 §3.6 bullet 2: _"No `onError`. Branch is pure control flow with
no runtime failure mode: selector template resolution is statically
proven by the validator's dominator + path-projection passes (§5.8.3),
and `BranchSelectorUnmatched` is also statically unreachable …"_

That argument is two-part, and only one part is touched by this
proposal:

- **Selector-resolution failure remains statically unreachable.**
  The validator's dominator + path-projection passes (§5.8.3) still
  prove this. The exhaustiveness contract (§3.6 + §3.6.1) still
  rules out `BranchSelectorUnmatched`. This proposal does not weaken
  either guarantee. The "no selector-failure runtime mode" rationale
  carries over unchanged.
- **Arm-scope failure is the new runtime failure mode.** Under B,
  arms execute arbitrary `WorkflowScope`s; any task inside an arm
  scope may fail. This is exactly the failure mode fork branches
  already have, and `onError` is added to branch for the same reason
  it is on fork: scope-level failure propagation.

The §3.6 rewrite should preserve the selector-failure half of the
original rationale and add the arm-scope-failure half as the
justification for `onError`. The two halves are independent; one is
not a generalization of the other.

#### 5.6.2 §3.6 "Branch arms target `@iterate` / `@exit`" - retracted (resolved by §3.6 of this proposal)

v0.1 §3.6 last bullet: _"`cases` and `default` target node ids in the
same scope. In a loop body, the targets may also be `@iterate` or
`@exit`."_

Under the branch-arm change alone, arms are closed `WorkflowScope`s
and cannot reach the enclosing loop's sentinels. That would be a
genuine expressiveness narrowing for the v0.1 "more / done" pattern.
The loop-termination change in §3.6 of this proposal resolves the
regression by retiring the sentinels entirely: termination is now a
`continueWhen` reference on the loop node. The historical pattern

```jsonc
{ "kind": "branch", "cases": { "more": "@iterate", "done": "@exit" } }
```

becomes:

```jsonc
// body's tail task publishes a boolean
{ "kind": "task", "namespace": "compare", "name": "...",
  "bind": "shouldContinue", ... }

// loop reads it as the termination predicate
{ "kind": "loop",
  "body": { ... },
  "continueWhen": { "$from": "scope", "name": "shouldContinue" },
  ... }
```

Branches inside the loop body have no special routing requirement;
they compute and publish like any other branch. The §5.6.2
regression that earlier drafts called out is closed by the bundled
loop change, not deferred to a future proposal.

#### 5.6.3 §3.7 / §8.4 loop sentinels - retracted

v0.1 §8.4 chose explicit string sentinels (`@iterate`, `@exit`) over
distinct node kinds, boolean flags on body nodes, or implicit
re-entry. That decision is now retracted: the trade-off it framed
("which routing-layer encoding wins?") is replaced by a different
trade-off ("routing-layer encoding vs reference-layer encoding"),
and the reference-layer encoding wins by the same principles
decision 0009 cites for `output`. Specifically:

- **Scope closure (P4).** Body scope no longer has in-scope routing
  targets that pierce outside it. Body becomes splice-safe in the
  same way fork branches already are.
- **Construct symmetry (§1.3.2).** Loop body becomes a plain
  `WorkflowScope` matching fork branches and forkMap bodies.
- **Reference-resolution uniformity (decision 0009).** Termination
  joins output on the "reference resolved at scope completion"
  footing. The two pieces of post-body computation a loop performs
  (decide whether to continue, decide what to publish) sit on the
  same machinery.
- **P3 task boundary.** The "continue?" decision is fully inside a
  task (the upstream body-scope task that produces the boolean);
  the loop node only resolves a reference to it. No predicate
  evaluation in the IR.

The Alt A / Alt B / Alt C rejections from §8.4 do not transfer to
this proposal because the design point itself moved: the alternatives
v0.1 §8.4 considered were all routing-layer encodings.

#### 5.6.4 §8.5 rejection rationale - preserved, with a footnote

v0.1 §8.5 (rejection of per-node `stateWrites`) cites, among other
reasons, _"branches that target `@iterate` directly to either
disallow that or carry state-write declarations (compromising the
pure-control-flow story for branches)."_

Under B, neither branch arms nor anyone else targets `@iterate`
directly - the sentinel is retired. The specific failure mode §8.5
cited disappears. The §8.5 decision (centralized `iterateState` over
per-node `stateWrites`) is still correct for its other stated
reasons (unobservable dead writes under snapshot reads, no-race
validation, phi reuse). The §8.5 rewrite should footnote that one
of the historical reasons is now moot, without disturbing the
decision.

#### 5.6.5 §8.6 state commit timing - preserved, retimed

v0.1 §8.6: state commits at `@iterate`; reads see iteration-start
values; no intra-iteration mutation. The substantive guarantee
(snapshot-read semantics; atomic per-iteration commit) is preserved
verbatim. Only the commit _point_ moves: from "`@iterate` transition
taken" to "body completion with `continueWhen` resolving to true."
The §8.6 prose updates to reflect the new commit point, but the
rationale stack (P4, P5) carries over unchanged.

## 6. Recommendation

**Adopt B (this proposal).**

Under the v0.2 IR reframing, the principle-and-audience analysis is
no longer close:

- **Minimization** strongly favors B. B removes two exceptions
  (branch-arm carve-out, loop-sentinel carve-out) and adds one
  concept (`continueWhen`) that reuses decision 0009's reference-
  resolution-at-scope-completion shape. Net surface area shrinks.
- **Uniformity (§1.3.2)** favors B. After adoption, every
  structured construct uses `WorkflowScope` with the same closure,
  completion, and reference-resolution rules. Branch is no longer
  a special case; loop body is no longer a special case.
- **Decision 0006** is preserved. Arm outputs, `continueWhen`, and
  loop `output` are all template references, not expressions.
  Selector is still computed by an upstream task; the boolean
  feeding `continueWhen` is too.
- **Decision 0001** is preserved and generalized uniformly across
  all structured kinds.
- **Decision 0002** is preserved. Branch joins the set of DDG-
  source-eligible nodes via `bind`; the dominator invariant is
  unchanged.
- **Decision 0009** is extended cleanly: the "reference resolved
  at scope completion" footing now covers both output and
  termination, on the same machinery.
- **G5 closes** with a principled status for `identity`/`noop`
  (they return to being ordinary standard-library tasks). **G6
  dissolves** via reuse of fork's per-branch-scope validation.

The principal cost B incurs is the §3.6 and §3.7 rewrites and the
coordinated update of validator, engine, and emitter, including the
loop-iteration code path. The §8.4 rationale (loop sentinels) is
retracted; §8.5 and §8.6 are preserved with footnotes. The IR is
pre-1.0 with no outside consumers, so no migration burden applies.

This proposal bundles two changes that earlier drafts considered
separately. The bundling is deliberate: the branch-arm change alone
introduces an expressiveness regression (branch arms can no longer
target `@iterate` / `@exit` directly) that only the loop-termination
change resolves. Splitting the proposals would either (a) ship the
regression and rely on a follow-up to clear it - a transient IR
state that all consumers must accommodate, or (b) add a `cases[k].next`
field as a stopgap that the follow-up would make vestigial. Neither
splitting strategy is cheaper than the bundled change.

The honest counter-position to B is **not** "keep v0.1 §3.6 and
§3.7 as the discriminant-switch + sentinel-routed-loop shape." It
is "back out fork's WorkflowScope-per-branch shape (ir-v0.2 §2.1)
and return all structured constructs to the v0.1 shape." That
position would restore symmetry by removing WorkflowScope-per-branch
from fork rather than adding it to branch (and by keeping in-scope
routing targets across the board). It is not what this proposal
recommends, because the v0.2 decision to give fork explicit `output`
was already evaluated against the same principles and found stronger
than the heuristic-output v0.1 shape. But it is the principled
mirror of A, and rejecting B without considering it leaves the
asymmetries standing on no stated principle.

## 7. Decision needed

Adopt B (this proposal) - rewrite §3.6 and §3.7 in place, retract
§8.4, footnote §8.5 and §8.6 - or reject B and explicitly record
why fork/forkMap are allowed to use `WorkflowScope` while
discriminant `branch` is not, and why loop is allowed to expose
in-scope routing targets while no other structured kind is.

A narrower variant - "adopt the branch-arm change only and accept
the §5.6.2 expressiveness regression until a future loop proposal" -
is also possible but not recommended; see the bundling argument
above.

This document is the analysis. The decision belongs to the IR
maintainers.
