# Future: branch arm state access model

Status: **Exploratory.**

## Current state (post-0010)

Branch arms are isolated sub-scopes: their `ScopeContext` has no
`state` namespace (symmetric with fork branches). `$from:"state"` in
arm node inputs is a validator error. State values that an arm needs
must cross the arm boundary explicitly through `arm.inputs`:

```jsonc
// arm.inputs resolves against the outer loop body (which has state)
"inputs": {
    "i":       { "$from": "state", "name": "i" },
    "results": { "$from": "state", "name": "results" }
}
// inside the arm: use $from:"input", not $from:"state"
```

The DSL emitter (`captureOuterRefs` with `hasState: false`) does this
rewriting automatically.

## Origin / why this was revisited

During decision 0010 execution, branch arms were temporarily given
ambient read access to the parent loop's `state` (a shallow copy)
to make map/filter's `checkBranch` work. On review, this turned out
to be unnecessary — `captureOuterRefs` already rewrites state refs to
input refs when building arm scopes. The ambient pass-through was
removed; arm scopes now match the fork-branch model exactly.

## Open question: arm state writes

The current model covers *reads*: state values flow in via `arm.inputs`
and are visible as `$from:"input"` inside the arm. What about *writes*?

Today there is no mechanism for an arm to update the parent loop's
state. A task inside an arm can produce a new value (via `bind`), and
that value is exposed as the arm's `scope.output`, which in turn
becomes the branch's bound output in the outer scope. Loop `iterateState`
can then project from the branch output to update state.

This works for map/filter (`_iter_out.newI`, `_iter_out.newResults`).
The question is whether a more direct "arm writes to state slot X"
semantic is ever needed, and if so, what form it should take.

## Candidate options

### Option A — keep current model (explicit boundary, no arm writes)

Arms read state via `arm.inputs`; arms update state indirectly via the
branch output → `iterateState` projection. No new mechanism needed.

**Pros:** Simple, auditable, consistent with fork branches.
**Cons:** Multi-state-variable updates require a multi-property output
object even when the arm only touches one variable.

### Option B — allow `iterateState`-style declarations on branch arms

An arm declares `updateState: { varName: template }` evaluated in the
arm scope at arm completion. The engine applies these updates before
continuing to the next loop iteration.

**Pros:** Ergonomic for arms that are the primary state-mutation site.
**Cons:** Breaks the clean "arm = sub-workflow" model; arms become
stateful constructs that know about their parent's state schema.

### Option C — structured output convention (current, explicit)

The DSL emitter packages all state updates into the arm output as a
named-property object; the outer `iterateState` destructures it. This
is what map/filter do today.

**Pros:** Works now, no IR changes needed.
**Cons:** Verbose for arms with many state variables.

## Trigger for revisiting

- A user-authored workflow requires an arm to update multiple state
  variables and the output-object convention becomes unwieldy.
- A DSL syntax is proposed for `arm { ... } -> state.x` that needs
  IR backing.
