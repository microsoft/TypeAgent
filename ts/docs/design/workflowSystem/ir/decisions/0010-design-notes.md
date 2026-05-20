# Decision 0010 design notes (in-flight log)

Companion to [0010-finish-workflow-scope-unification.md](0010-finish-workflow-scope-unification.md)
and [0010-implementation-plan.md](0010-implementation-plan.md).

This file accumulates **design choices made during execution** that
warrant a later review pass. Entries fall into three categories:

- **Non-obvious choice.** The decision is not implied by 0010 itself;
  a reader of 0010 alone could not guess the implementation chose
  this path. Examples: validator pass ordering, error message
  taxonomy, internal helper boundaries.
- **Revised assumption.** An initial assumption proved wrong during
  execution and was corrected. The correction may have implications
  beyond the immediate fix that are worth a second look.
- **Live alternative.** A plausible alternative exists with credible
  upside; the implementation picked one path but the other should
  be revisited if pressure changes.

Entries are appended during execution. The whole file is reviewed
once all phases of 0010 land.

## Entry template

```
### YYYY-MM-DD - <short title>

Category: non-obvious choice | revised assumption | live alternative
Phase: 1 | 2 | 3
Touches: <file:line or section refs>

Context: <one or two sentences>
Choice: <what was decided>
Alternatives considered: <what else was on the table>
Why this one: <reasoning>
Revisit when: <trigger that would justify reopening>
```

## Entries

### 2026-05-19 - revisit-triggers.md: annotate row 2, no new row for loop sentinels

Category: non-obvious choice
Phase: 1
Touches: ir/revisit-triggers.md row 2 ("Branch model")

Context: Plan task 11 said "mark branch-model and loop-sentinel rows
resolved." On reading the index, only one row matched (row 2, branch
model: discriminant switch vs. predicate). There was never a row for
loop sentinels because §8.4 was originally closed without a post-v1
revisit trigger.

Choice: Annotate row 2 in place to record that the v1 position now
includes "arms are `WorkflowScope`s (0010)" but keep the predicate-vs-
discriminant trigger open (0010 does not address that axis). Do NOT
add a new row for loop sentinels or for branch-as-scope; both are
closed decisions with no post-v1 reopen condition under 0010.

Alternatives considered:
- Add a row "Loop body shape" with "trigger: 0010 retraction
  evidence" so the change is discoverable from this index alone.
  Rejected: revisit-triggers.md is for v1 decisions that carry an
  explicit reopening condition; 0010 is itself a decision record and
  the canonical place to find this history is the decision file.
- Mark row 2 fully resolved. Rejected: the predicate-vs-discriminant
  trigger (per-decision dispatch hot-path) survives 0010 unchanged.

Why this one: the index stays a catalog of open reopen-conditions;
closed decisions live in the decision files. Adding closed rows would
dilute the index's purpose.

Revisit when: if a future decision adds a different post-v1 reopen
condition to the branch-as-scope or loop-continueWhen designs, add a
new row then.

### 2026-05-19 - Branch `onError` semantics: cover only arm-scope failure

Category: non-obvious choice
Phase: 1
Touches: ir-v0.1.md §3.6 (branch shape), §5.3 (branch execution), §5.5 (onError dispatch)

Context: Pre-0010 §3.6 said "No `onError`. Branch is pure control
flow with no runtime failure mode." Under 0010 the arm scope can
contain arbitrary tasks, so arm-scope failure is now a real runtime
failure mode that needs a routing rule.

Choice: `onError` on a branch covers arm-scope failure only.
Selector resolution remains statically proven (the §5.8.3 dominator
and path-projection passes still apply, and exhaustiveness still
rules out `BranchSelectorUnmatched`). The branch trigger's `inputs`
for §3.8 trigger-injection is the branch's resolved `selector` plus
the selected arm's resolved `inputs` (the values the branch was
actually consuming when the arm failed).

Alternatives considered:
- Disallow `onError` on branch; let arm-scope failures escape the
  arm and rely on the arm's own internal `onError` edges. Rejected:
  parallel to fork (which does have an `onError`) and to loop; the
  branch should be uniform.
- Include selector failure under `onError` for symmetry. Rejected:
  reintroduces a runtime failure mode the validator already proves
  unreachable, growing the runtime surface for no benefit.

Why this one: matches fork's `onError` semantics exactly; the branch
trigger is the only kind whose `onError` is restricted to a strict
subset of its failure surface, and that restriction comes for free
from the validator passes that already exist.

Revisit when: a scenario surfaces where the branch trigger needs a
selector-resolution error path (e.g., dynamic-registry concerns from
revisit-triggers row 8 redefine "statically proven" coverage).

### 2026-05-19 - 0007 audit: extend template-position enumeration; no fresh contradictions

Category: non-obvious choice
Phase: 1
Touches: ir/decisions/0007-value-construction-in-references.md §G-K1.d (line ~456); ir/decisions/0010-finish-workflow-scope-unification.md §3

Context: Plan task 10 required auditing decision 0007 (value
construction in references) against 0010's two new surfaces: branch
arms (`cases[*].inputs.<field>` and arm `scope.output`) and the loop's
`continueWhen`. The audit asked whether 0007's "template positions vs.
opaque-literal positions" partition (G-K1.d) still holds, whether the
`$from`/`$literal` reservation produces any new collision risk, and
whether 0007's deferred `$value`/`$build` proposals interact with the
new positions.

Choice: Treat all three new positions as **template positions** under
G-K1.d (the v1 rule); add them to the enumeration in 0007 §G-K1.d
explicitly. No change to the `$from`/`$literal` semantics, the
deferred `$value`/`$build` proposals, or the opaque-literal positions.

Alternatives considered:
- (a) Opaque-literal for `continueWhen`. Rejected: `continueWhen`
  is conceptually identical to an `inputs.<field>` reference of
  boolean type; the body produces a value and the loop reads it.
  Treating it as a literal would force a `bool.identity` task and
  re-create the §3.6 problem 0010 is fixing.
- (b) Treat arm `scope.output` as a different position from the
  workflow's `output`. Rejected: arms are now `WorkflowScope`s by
  construction; their `output` field IS the same position. The whole
  point of the WorkflowScope reframing is that one rule covers all
  embedding sites.

Why this one: 0010 is explicitly the "remove the carve-out" move.
Carving `continueWhen` or arm outputs out of the template-position
rule would re-introduce a different carve-out at the 0007 layer.

Revisit when: if `$value`/`$build` lands post-v1 and asks "which
template positions accept value construction?" the answer should be
"all of them, uniformly." Re-audit the enumeration in 0007 §G-K1.d
when that decision is opened.


## 4. §6.2 worked example was rewritten away from diamond-merge

**Category:** Non-obvious choice.

**Where:** ir-v0.1.md §6.2 ("Branch with task-level onError recovery").

**Choice:** When updating the §6.2 worked example for the new branch
shape, replaced the original "three arms all bind `output`; `format`
reads `output`" diamond-merge demonstration with a "branch declares
`bind: "routed"`; `format` reads `routed`" demonstration. The diamond
merge over arms is no longer needed because the branch itself reifies
the selection into a single binder.

**Reason:** Decision 0010's headline value is that branch-as-value
flattens what previously required either phi-merge or shim nodes. The
worked example should illustrate the new affordance rather than the
old workaround. The previous diamond-merge story (P1 scenario 3) is
still demonstrated elsewhere -- arms binding into outer scope is no
longer legal because each arm is now a sub-scope, so the diamond
merge story would have to migrate to a different shape (e.g., two
recovery tasks for `onError` that bind the same name) anyway.

**Revisit when:** if a reader asks "where is the canonical
diamond-merge example?", add a short §6.x demonstrating phi-merge in
the new world (probably two `onError` recovery tasks binding the same
name on mutually exclusive paths).

## 5. Fork per-branch-scope code path: inline replication chosen over extraction

**Category:** Non-obvious choice.

**Where:** ts/examples/workflow/engine/src/runner.ts (Phase 2 task 15 audit).

**Observation:** `executeFork` contains a short, self-contained
per-branch-scope execution pattern (resolve `branch.inputs` against
outer scope, construct a fresh `ScopeContext` with that input,
constants, and an empty bindings map, call `executeScope`, then
resolve `branch.scope.output` against the branch scope). This is
exactly the pattern needed for branch arms.

**Choice:** Implementing branch arm execution by **inline replication
of the fork per-branch-scope pattern** inside `executeBranch`, rather
than extracting a shared helper. The pattern is ~10 lines, only two
call sites would consume it (fork and branch), and the call sites
differ in their iteration shape (fork loops over all branches with
concurrency control; branch picks one arm). Extracting a helper would
not eliminate duplication so much as relocate it.

**Trade-off accepted:** If a future caller (e.g., a "block scope" or
"do-while" construct) emerges, the helper can be extracted then. The
forkMap and loop body sites also share most of this shape but
already diverge in small ways (forkMap binds `elementParam` into
input; loop reuses the same input across iterations and threads
`state`), so a single shared helper would need parameters that make
it less readable than the current inline form.

**Revisit when:** a third or fourth WorkflowScope-execution call site
appears, or when test gaps reveal the per-scope event emission
pattern needs to be unified across fork/branch/loop/forkMap.

---

### Validator must treat branch as a bindable node

**Category:** Revised assumption.

**Phase:** 2 (uncovered by Phase 2 positive coverage matrix, task 19).

**Where:** ts/examples/workflow/model/src/validate.ts -
`isBindableNode`, `nodeOutputSchema`, `buildBindingMap`.

**Initial assumption:** Branch nodes were "control flow only", and
`isBindableNode` excluded them (`return node.kind !== "branch"`).
The validator's binding map was built only from task/loop/fork/forkMap
nodes; consumers reading `$from: "scope", name: branchBind` would
silently fail.

**What broke:** Once 0010 made branches value-producing (carrying
`bind` + `outputSchema` per spec §3 / §6), downstream consumers
correctly emitted by the DSL referenced the branch's `bind` and the
validator reported the bind name as "not bound by any node in this
scope". The positive coverage matrix surfaced this immediately;
existing negative tests passed because they targeted other failure
modes (missing outputSchema, incompatible arms).

**Fix applied:** `isBindableNode` returns true for all kinds.
`nodeOutputSchema` was generalized to return `node.outputSchema ?? {}`
for branch (branches without `bind` may legitimately omit
`outputSchema`; consumers of those branches can never bind anyway, so
returning the top type is safe). The dead `else if (node.kind ===
"branch")` arm in `onError` validation was deleted - the `if
(isBindableNode(...))` arm now covers it because `BranchNode` already
carries `next` and `onError`.

**Why this is worth a re-read:** the change widens the "bindable
node" surface across the validator. Any pass that branches on
`isBindableNode` now applies its logic to BranchNode too. We audited
the call sites (lines 191, 487, 637, 909, 1493, 2330) and confirmed
each is correct under the wider definition. New passes that assume
`isBindableNode` excludes branch should be written against the new
contract or guarded explicitly.

---

### Map/filter checkBranch outputSchema declares projected paths

**Category:** Non-obvious choice.

**Phase:** 2 (DSL emitter, task 18+19).

**Where:** ts/examples/workflow/dsl/src/emitter.ts - `emitMap`,
`emitFilter`.

**Problem:** Map/filter lower to pre-check loops with a checkBranch
that binds `_iter_out`. The loop's `iterateState` projects path
references `_iter_out.newI` / `_iter_out.newResults` to update loop
state. When the validator was first wired through (after fixing
`isBindableNode`), it correctly resolved `_iter_out` to the branch's
output schema and then tried to navigate the declared path - the
schema was `{}` (top), so `newI` / `newResults` were "not declared in
producer outputSchema".

**Choice:** The checkBranch declares its `outputSchema` as an object
with `newI: integer, newResults: array` (or the filter equivalent).
This documents the contract the loop relies on, lets the validator
verify the path projection, and matches what the arm's task actually
binds.

**Why this is worth a re-read:** Branch outputSchema declarations now
have a concrete dependency from the iteration projection. If we later
add a stricter producer-schema check that requires arm outputs to be
*assignable* to the branch outputSchema (rather than just structurally
compatible), the map/filter arms' task `outputSchema` should be
audited to match - currently they declare `type: object, properties:
{ newI, newResults }` for map and `{ newI, newResults }` for filter.

---

### Branch arms inherit ambient `state` from parent scope

**Category:** Revised assumption.

**Phase:** 2 (engine runner, dsl-integration follow-up).

**Where:** ts/examples/workflow/engine/src/runner.ts -
`executeBranch`; ts/examples/workflow/dsl/src/emitter.ts -
`captureOuterRefs` (state-rewrite logic).

**Problem:** When 0010 was sketched, branch arms were described as
fully isolated sub-scopes: their visible inputs are only what
`arm.inputs` provides. That works for plain `if`/`switch`, but breaks
when arms appear *inside* a loop body. The map/filter emitter places
per-iteration work (read element, evaluate predicate, append) inside
a checkBranch arm. Those arm-internal tasks need to read the loop's
`state.i` and `state.results` - but a fully isolated arm scope has
no `state` namespace, so those references fail with `Reference
unresolved: $from "state"`.

**Choice:** `executeBranch` now inherits `state` from
`resolveScope.state` into the arm scope, treating state as ambient
(like `constants`). The emitter's `captureOuterRefs` keeps its
state-rewrite codepath, but only applies it when `hasState: false`
(i.e. genuine arm sub-scopes, not loop bodies).

**Trade-off / why this is worth a re-read:** This subtly broadens
what "arm scope" means: arms now share their parent's `state`
namespace by reference. That matches the user mental model that an
arm is a *continuation* of the outer scope's data flow, but it does
mean that future passes that audit "what does an arm see?" must
treat state as readable. Writes to state from inside an arm are not
currently exercised - if we later allow that, we need an explicit
decision about whether arm writes mutate the parent's state map.

**Update (Phase 2 review round 1):** the arm scope now receives a
**shallow copy** of `state` (`{ ...resolveScope.state }`) rather than
the same reference. This matches loop body semantics (`executeLoop`
already shallow-copies into `bodyScope.state`). Top-level reassignment
inside an arm therefore does not leak to siblings or to the parent
loop's `state`. Deep-object mutation (e.g. `state.results.push(...)`)
would still leak — current standard-library tasks happen to be
non-mutating, but this is a structural soundness gap. Either move to
deep-copy on hand-off or document a non-mutation contract for tasks.

---

### Output templates participate in arm capture

**Category:** Non-obvious choice.

**Phase:** 2 (DSL emitter, task 18 follow-up).

**Where:** ts/examples/workflow/dsl/src/emitter.ts - `buildArmScope`,
`captureOuterRefs` (`extraVisit` option).

**Problem:** An arm scope's `output` template is set on the scope
itself (not on any node). The first cut of `captureOuterRefs` only
visited `scope.nodes`, so an else arm that did `return x` (where `x`
is a workflow-level input) produced an arm with `inputs: {}` and an
unresolvable `output: $from:"input", name:"x"`. Symptom: the else
branch returned `undefined` at runtime.

**Choice:** `captureOuterRefs` now accepts an `extraVisit` array
that is scanned with the same rewrite logic as node inputs.
`buildArmScope` passes the arm `output` template through this hook,
so refs in the output are hoisted into `arm.inputs` and rewritten to
`$from:"input"`. We also added every node's `bind` name to the local
"do not hoist" set so branch-bind names like `updated_results` are
not mistakenly captured as outer refs when seen from the output.

**Why this is worth a re-read:** The `extraVisit` hook is generic;
any future code that adds templates living on a scope (annotations,
guards, etc.) should pass them through the same hook. If we forget,
we'll see the same "ref unresolved at runtime, no validator error"
class of bug.

---

### Phase 2 promote summary

**Phase 2 = "DSL emitter rewrite + engine runner alignment".** Closed
2025-XX with all three test suites green:

- model: 148 pass (+ 1 skip — see deferred items).
- dsl: 634 pass.
- engine: 199 pass.

**Reviews:**
- Code review r1 → fixed branch arm `state` to be shallow-copy.
- Code review r2 → deferred literal-`continueWhen:true` flagging.
- Test gap r1 → added `buildOutputOnlyArm` and `filter_check.next`
  structural emitter tests.
- Test gap r2 → added skipped test for `continueWhen` reference
  validation (real validator gap surfaced); deferred loop body
  state isolation runtime test.

**Open soundness gaps** (tracked in `0010-review-deferred.md`):
1. Deep-object mutation of inherited loop/arm state.
2. Literal `continueWhen: true` not flagged.
3. `continueWhen` template references not name-resolved.
4. Loop body state shallow-copy isolation has no runtime test.

Phase 3 (non-DSL stdlib documentation, straggler search, decision
log audit) can now proceed.
