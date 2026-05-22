# Future: task input immutability / deep-copy on hand-off

Status: **Exploratory.**

## Origin

During the decision 0010 phase 2 review, two related findings were
noted in `runner.ts`:

1. Branch arms and loop body iterations receive a **shallow copy**
   of the parent `state` dict, so top-level reassignment by one
   arm/iteration is invisible to sibling arms / subsequent
   iterations. But a task that mutates a _property_ of an input
   object (e.g. `results.push(x)`) would still mutate the parent's
   copy, because `resolveTemplate` returns the live reference
   stored in `scope.bindings` or `scope.state`.

2. This is not limited to `$from:state` in loops — it applies to
   **any** `$from:scope` or `$from:state` reference that resolves
   to an object or array. The receiving task gets a live reference,
   and any in-place mutation bleeds back to all later nodes that
   read the same name.

Both findings were deferred because all current standard-library
tasks are non-mutating (they return new values via `bind`). The
risk is real only when a user-supplied task mutates its inputs.

## Problem statement

`resolveTemplate` resolves a `$from:scope` / `$from:state`
reference by returning the value directly from the binding map:

```
case "scope": value = scope.bindings.get(name);   // live ref
case "state": value = scope.state?.[name];          // live ref
```

If `value` is an object or array, the receiving task holds a live
reference into the engine's internal scope. A mutation like
`input.items.push(x)` or `input.count++` made inside the task
propagates back silently.

The current implicit contract is **"tasks must not mutate their
inputs"**. This is not documented, not enforced, and not tested.

## Candidate options

### Option A — document the contract only

State explicitly in the task-authoring guide that tasks must treat
their inputs as read-only. No engine change. Low cost; does not
prevent accidental violations.

### Option B — deep-copy resolved inputs before handing off to tasks

In `executeTask`, replace:

```ts
const resolvedInput = resolveTemplate(node.inputs, resolveScope);
```

with:

```ts
const resolvedInput = structuredClone(
  resolveTemplate(node.inputs, resolveScope),
);
```

**Pros:** Eliminates the risk entirely; tasks are free to mutate
their inputs; aligns with actor-model message-passing semantics.

**Cons:** `structuredClone` is O(n) in input size; most tasks are
non-mutating, so the copy is wasted work. Custom types (functions,
class instances) are not cloneable.

### Option C — freeze resolved inputs in development/debug mode

Wrap resolved inputs in a recursive `Object.freeze` before
handing off, controlled by a `defenseInDepth` flag already
present in the runner.

**Pros:** Zero overhead in production; surfaces bugs early during
development and test.

**Cons:** Freeze is shallow in JS — nested objects require
recursive application. Throws `TypeError` on mutation only in
strict mode.

### Option D — enforce at the task-registry level

Add an optional `pure: true` flag to task declarations. The
runner deep-copies inputs only for tasks not marked pure, or
conversely, validates non-mutation after the call in debug mode.

**Pros:** Author opt-in; no overhead for tasks that are known
non-mutating.

**Cons:** Requires task authors to reason about and declare
purity; no enforcement for unmarked tasks.

## Risks and open questions

- How expensive is `structuredClone` on large lists? Benchmarks
  needed before committing to Option B for all tasks.
- Does the engine already expose `defenseInDepth` in a way that
  Option C can hook into without touching each call site?
- Should the contract be enforced at the IR/validator level
  (e.g. flag tasks not in a known-pure set) or only at runtime?
- Are there legitimate cases where a task needs to mutate its
  input (e.g. a streaming task building up a result in place)?

## Non-goals

- Immutability of the workflow IR itself (already a plain JSON
  object; mutations there are a separate concern).
- Preventing tasks from having side-effects on external state
  (files, network, databases) — out of scope for the engine.

## Trigger for revisiting

Re-open when:

- A user-supplied task causes a silent mutation bug in a workflow.
- A standard-library task is added that mutates its inputs.
- A benchmarking pass on `structuredClone` shows acceptable cost.
