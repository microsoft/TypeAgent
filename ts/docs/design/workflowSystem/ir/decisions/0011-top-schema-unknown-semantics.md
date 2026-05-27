# Decision 0011: `{}` = unknown semantics for bound producer schemas

**Status:** Accepted (implemented).
**Supersedes:** The implicit "any" behaviour in the previous validator.
**Related:** ir-v0.1.md §4.1 pass 7; G29 (dsl-v0.1-gap.md).

---

## 1. Problem

`outputSchema: {}` appears in two semantically different roles across the IR,
but the old validator treated both identically as **"any"** (skipping all
subtype checks when the producer schema is `{}`). This is unsound when a
downstream consumer reads from a `{}`-typed reference into a typed slot.

| Role                                 | Example nodes                        | Semantics needed                      |
| ------------------------------------ | ------------------------------------ | ------------------------------------- |
| Pure CFG node, no consumer           | `noop`, `merge` (no `bind`)          | `{}` is irrelevant; skip silently     |
| Bound producer, type not fully known | `BranchNode` with `bind`, arm scopes | `{}` means **unknown** (top type)     |
| Bound producer, type IS knowable     | emitter gap (e.g. destructuring)     | Fix the emitter; emit the real schema |

---

## 2. Decision

**`{}` on a bound producer is valid IR, semantically `unknown` (top type).**

Enforcement is **consumer-side** via `checkUnknownAssignability`:

1. **Assignability TO `{}`** (consumer is `{}`): anything is assignable to
   unknown. Skip silently (no error).

2. **Assignability FROM `{}` to a typed consumer** (producer is `{}`):
   the validator **errors**. A consumer that requires a concrete type cannot
   safely read from an unknown producer without a runtime type guard.

3. **Unbound CFG nodes** (nodes with no `bind`, pure sequencing): their
   `outputSchema: {}` is correct and irrelevant. No error is raised because
   no consumer references them.

4. **Captured references in sub-scopes**: The emitter's `propagateBodySchemas`
   post-pass resolves captured-ref schemas from the parent scope into each
   sub-scope's `inputSchema.properties`. This prevents false positives where
   a capture was conservatively typed as `{}` but the parent has a concrete
   schema.

---

## 3. What `{}` does NOT mean

- `{}` does **not** mean "opt out of type checking" (that would be `any`).
- `{}` does **not** imply the runtime value is actually unconstrained; it only
  means the IR author did not capture the schema.
- `{}` is **not** a substitute for `{ "not": {} }` (never/bottom type, used for
  nodes that always throw such as `error.fail`).

---

## 4. Formal type lattice position

```
           {} (unknown / top)
          /        \
   string ...    object    array    boolean    number    ...
          \        /
        { "not": {} }   (never / bottom)
```

`{}` is the **top type**: every other schema is a subtype of it. Reading
_from_ the top type is the unsafe operation (you know nothing about the shape).
Writing _to_ the top type is always safe (anything is a subtype).

This mirrors TypeScript's `unknown`:

- `T → unknown`: always safe
- `unknown → T`: error (requires a concrete schema on the producer)

---

## 5. Implementation

The validator enforces consumer-side checks via `checkUnknownAssignability()`.
This function is called at three sites:

1. **`node.inputs` fields** - when a resolved template type is `{}` but the
   consumer property requires a concrete type.
2. **Branch `selector`** - when the selector resolves to `{}` but
   `selectorSchema` requires a concrete type.
3. **`scope.output`** - when the workflow output template resolves to `{}` but
   the body's `outputSchema` is concrete.

Error message format:

```
{producerLabel} resolves to {} (unknown); not assignable to
{consumerLabel} {formatSchemaType(consumer)}. Only consumers that
accept unknown (schema {}) may read from an unknown producer.
```

The emitter's `propagateBodySchemas` post-pass resolves captured-reference
schemas from the parent scope into sub-scope `inputSchema.properties`, so
sub-scopes that capture typed bindings don't see `{}` at runtime.

---

## 6. Emitter obligations

The emitter should produce concrete `outputSchema` on all bound producers
where the type is statically known. Current coverage:

| Site                                           | Status                                             |
| ---------------------------------------------- | -------------------------------------------------- |
| Generic task calls                             | Done (resolvedSchemas)                             |
| `forkMap` body outputSchema                    | Done                                               |
| `fork` parallel branch body outputSchema       | Done                                               |
| `attempts` loop body output                    | Done                                               |
| Destructuring pick nodes                       | Done (symbolTypes)                                 |
| Pure-literal return identity wrapper           | Done                                               |
| Branch `outputSchema` (if/switch/ternary bind) | Done                                               |
| Arm `scope.outputSchema`                       | Done                                               |
| Ternary literal identity wrappers              | Uses `{}` (accepted; consumer-side catches misuse) |
| Noop merge nodes                               | Uses `{}` (unbound; irrelevant)                    |

---

## 7. IR spec impact

§4.1 pass 7 (type compatibility) should state:

> A producer schema of `{}` (the universal top type) is treated as **unknown**
> for validation purposes. Assignability _to_ `{}` is unconditionally satisfied.
> Assignability _from_ `{}` to a typed consumer is a validation **error**.
> Unbound nodes (no `bind`) with `outputSchema: {}` are exempt because no
> consumer can reference them.

---

## 8. Relationship to other decisions

- **Decision 0001 (bound outputs):** A node without `bind` has no addressable
  output. Its `outputSchema` is required by the IR grammar but is irrelevant to
  consumers. The unknown semantics decision applies only to _bound_ producers.
- **G29 (branch arm output types):** Resolved. The type checker enforces
  same-type arms, stores result types in `_resolvedSchemas`, and the emitter
  reads them back to set `branch.outputSchema` and `arm.scope.outputSchema`.
- **G18 (union types):** When `anyOf` is introduced for heterogeneous arm types,
  branch `outputSchema` can be a concrete union instead of requiring same-type.
