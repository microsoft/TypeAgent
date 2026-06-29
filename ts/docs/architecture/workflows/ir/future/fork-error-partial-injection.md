# Future: Fork/ForkMap Error Enrichment and Cancellation

Status: planned future work (not current behavior).

## Current state

On error, fork and forkMap handlers receive a structured `error` object
and an empty `trigger` (`{}`). Unlike task and loop error handlers which
populate `trigger` with the failing node's resolved inputs, fork/forkMap
pass an empty object. `partial` (completed results so far) is not part of
the current spec. In-flight branches/iterations are not explicitly
cancelled on failure.

## Planned enrichment

### 1. Abort signal propagation to task execution

Add an `AbortController` per fork/forkMap execution. On failure:

- signal abort to all in-flight branch/iteration scopes
- task execution should respect the abort signal and clean up

This is a prerequisite for meaningful `partial` injection, because without
cancellation the set of "completed" results keeps growing after the error.

### 2. `trigger` injection

Pass the failing branch's resolved inputs (fork) or the failing element
(forkMap) as `trigger` in the error handler payload, so the handler knows
which input caused the failure.

### 3. `partial` injection

After cancellation settles:

- fork: pass an object keyed by branch name containing completed branches'
  outputs (failed/cancelled branches absent)
- forkMap: pass an array of completed iterations' outputs with `null` for
  failed/cancelled entries, preserving index correspondence

### 4. Wait vs fail-fast policy

For fork/forkMap with side-effectful tasks, immediately aborting may leave
work in an inconsistent state. Add a policy option to control behavior on
first failure:

- `"fail-fast"` (default): signal abort immediately, trigger error handler
  as soon as possible
- `"wait"`: let all in-flight branches/iterations finish (or abort
  gracefully) before triggering the error handler, so `partial` reflects
  the full settled state

Possible shape (illustrative):

```jsonc
{
  "kind": "fork",
  "errorPolicy": "wait",   // or "fail-fast"
  ...
}
```

This matters most when branches have side effects (writes, external calls)
that should not be interrupted mid-execution.

## Open questions

1. Should abort signal be cooperative (tasks check it) or forceful
   (execution is interrupted)?
2. Should `errorPolicy` be an IR-level field or an engine runtime option?
3. Should there be a timeout on the "wait" policy to prevent indefinite
   hangs?
4. How does this interact with `maxConcurrency` queued branches that
   haven't started yet? (Probably: don't start them.)
5. Should the DSL surface this policy, or is it IR/engine-only?

## Non-goal

This note does not change current behavior. Current error handling
(error-only payload, no cancellation) remains the implemented contract
until this work is picked up.
