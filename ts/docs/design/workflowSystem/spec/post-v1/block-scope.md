# Post-v1: explicit `block` scope

Status: **Post-v1 sketch.** Listed in [../spec-v1.md](../spec-v1.md) §2.2.

## 1. Motivation

v1 has two scope kinds: the workflow root and the loop body. Both follow
the same shape (entry, nodes map, declared inputs, optional state, optional
outputs, sentinel rules). The validator's per-scope checks are already
parameterized over "scope kind".

A third scope kind, **`block`**, would be a run-once sub-scope sitting in
its enclosing scope as a single node. It is the post-v1 closure for two
distinct gaps in v1:

- **Multi-statement `try`.** A single `onError` on the block node catches
  any failure that propagates out of the block. Without blocks, the only
  ways to cover several nodes with one handler are (a) duplicate `onError`
  per node and accept duplicate handlers (which v1 forbids: one trigger
  per handler), or (b) let failures bubble to the surrounding loop or
  workflow scope and lose locality.
- **Regional grouping with localized error handling.** When a join is
  itself a region (each branch arm is several steps that together need
  their own try / their own intermediate hiding), the block makes that
  region first-class. v1's bound outputs already handle simple diamond
  merges (each arm binds the same name); blocks become valuable when each
  arm is itself non-trivial.

Per-node hiding is **already handled in v1** by bound outputs (hide-by-
default `bind`); blocks are not needed for that case. See
[../decisions/0001-bound-outputs.md](../decisions/0001-bound-outputs.md).

Secondary value: mechanical "promote this region to a sub-workflow"
refactor (block + document boundary = sub-workflow).

## 2. Why it slots in cleanly

The spec already treats "scope" as an abstract concept with a small
contract. A new scope kind only specifies the cells in this table:

| Scope contract piece      | Workflow root   | Loop body            | Sub-workflow (post-v1)   | Block (this doc)     |
| ------------------------- | --------------- | -------------------- | ------------------------ | -------------------- |
| Has its own `entry`       | yes             | yes                  | yes                      | yes                  |
| Has its own `nodes` map   | yes             | yes                  | yes                      | yes                  |
| Carries declared `inputs` | yes             | yes (loop-level)     | yes                      | yes                  |
| Carries `state`           | no              | yes                  | optional                 | no (proposed)        |
| Carries `constants`       | yes             | no                   | yes                      | no (proposed)        |
| Carries `outputs`         | `outputBinding` | `outputs` on `@exit` | yes                      | yes                  |
| Allowed sentinels         | none            | `@iterate`, `@exit`  | none                     | `@exit` only         |
| `next: null` legality     | yes             | no                   | yes (terminates the sub) | no (use `@exit`)     |
| Cross-scope visibility    | n/a             | only outer constants | only declared `inputs`   | only outer constants |
| Handlers / `onError` work | yes             | yes                  | yes                      | yes                  |
| DDG dominator check       | within scope    | within scope         | within scope             | within scope         |

Implementation cost is roughly: define the JSON shape, add it to the
scope-kinds set the validator iterates, document. No new dominator math,
no changes to handler semantics, no changes to the reference model.

## 3. Sketch

```jsonc
"buildAndShip": {
  "kind": "block",
  "inputs": {
    "version": { "$from": "node", "name": "computeVersion" }
  },
  "body": {
    "entry": "build",
    "nodes": {
      "build": { "kind": "task", "task": "build.run", /* ... */, "next": "test" },
      "test":  { "kind": "task", "task": "test.run",  /* ... */, "next": "ship" },
      "ship":  { "kind": "task", "task": "ship.run",  /* ... */, "next": "@exit" }
    }
  },
  "outputSchema": { /* shape of the block's output */ },
  "outputs": { "shipped": { "$from": "node", "name": "ship" } },
  "next": "notify",
  "onError": "buildShipError"
}
```

`buildShipError` is a handler in the **outer** scope. It catches any
failure inside `body` that wasn't caught by an inner body-scope handler,
plus any failure of the block's own `inputs` / `outputs` resolution.

Inside the block, individual nodes can still carry their own `onError`
pointing to body-scope handlers, exactly like a loop body. Nested catch
behavior falls out of the existing rules.

## 4. The five design choices

### 4.1 Cross-scope read rules

Same as loop body: a block reads only workflow-root constants from outside;
everything else enters via declared `inputs`.

- **Pro:** P4 - block is composable; "lift this block into a sub-workflow"
  is a mechanical refactor with zero rewrite.
- **Con:** more typing for short blocks.
- The lax alternative (block nodes can directly reference outer node ids
  whose dominators include the block's entry point) saves typing but breaks
  P4 composability and forces the validator to cross scope boundaries.

The strict rule is the consistent choice.

### 4.2 State

Blocks have no `state`. Intermediate values are just node outputs,
referenced via `$from: "scope"`. If iteration state is needed, use a loop.

### 4.3 Sentinels

Reuse `@exit` as the block's terminator. `@iterate` is not applicable
(blocks run once).

Using `next: null` instead of `@exit` would change `next: null`'s meaning
depending on enclosing scope, costing P5. `@exit` keeps the rule
"sentinels terminate the enclosing non-root scope, root uses `null`".

### 4.4 Block-level `onError`

This is the whole point. The block node, like any other node in its
enclosing scope, carries an optional `onError` pointing to a handler in
that outer scope. No new mechanism.

### 4.5 Constants and types

`constants` and `types` remain workflow-root only. Same rule as loop body.

## 5. What this does NOT buy

- Not **typed errors**. The block-level handler is still one handler that
  internally discriminates on the error structure.
- Not **`finally`**. The diamond pattern (success-`next` and handler-`next`
  both pointing at the same cleanup node) remains the way.
- Not **shared handlers**. Each protected region (block or single node)
  still has exactly one handler.

These remain separate post-v1 items.

## 6. Relationship to sub-workflows

A block is essentially a sub-workflow inlined into the parent document.
Two coherent end states:

- **Coexist:** sub-workflow is a separate document referenced by id; block
  is the same shape inlined.
- **Unified:** the inline form is a block; the document-reference form is
  a "block call". Reference vs. inline is a packaging choice.

Adding **block first** and treating sub-workflow as "block in a separate
file" later is the easier path: it doesn't require multi-document
machinery (id resolution across files, versioning, packaging) up front,
yet it pays off the multi-statement-try use case immediately.

## 7. Why record this now

Three near-term design conversations are influenced by knowing this
exists in the post-v1 backlog:

- **Error-routing design** can rest the multi-statement-try concern on
  "this is the planned closure" rather than re-litigating shared handlers.
- **Sub-workflow design** can be framed as "block + document boundary"
  rather than as a from-scratch construct.
- **Validator architecture** can be written so the per-scope check loop
  is parameterized from day one, rather than hard-coding "workflow or loop
  body".

## 8. Open questions

- Should the block carry an explicit `inputSchema` (like a task / handler)
  so that the validator can type-check the inputs block against a single
  declared shape, or just rely on per-input schemas?
- Does the block need an `outputSchema`, or can it be inferred from the
  `outputs` references plus their producers' schemas? (Loop chose
  explicit; consistency argues for explicit here too.)
- If a block fails before any body node runs (its own `inputs`
  resolution fails), is that a block failure that the outer `onError`
  catches? Most likely yes, by analogy with loop init failures.
