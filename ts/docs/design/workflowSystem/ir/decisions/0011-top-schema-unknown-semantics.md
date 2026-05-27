# Decision 0011: `{}` = unknown semantics for bound producer schemas

**Status:** Proposed.
**Supersedes:** The implicit "any" behaviour in the current validator.
**Related:** ir-v0.1.md §4.1 pass 7; G29 (dsl-v0.1-gap.md); validator-soundness plan.

**End state:** The validator MUST error (not warn) on bound producers with
`{}` outputSchema. Warnings are an intermediate step while emitter gaps are
closed. This document records both the principle and the enforcement target.

---

## 1. Problem

`outputSchema: {}` appears in two semantically different roles across the IR
today, but the validator treats both identically as **"any"** — it skips all
subtype checks when the producer schema is `{}`. This is unsound for the
second role.

| Role                                  | Example nodes                        | Semantics needed                             |
| ------------------------------------- | ------------------------------------ | -------------------------------------------- |
| Pure CFG node, no consumer            | `noop`, `merge` (no `bind`)          | `{}` is irrelevant; skip silently ✓          |
| Bound producer, type not yet inferred | `BranchNode` with `bind`, arm scopes | `{}` means **unknown** — warn on path access |
| Bound producer, type IS knowable      | emitter gap (e.g. forkMap body)      | Fix the emitter; emit the real schema        |

The IR specification (§1.1) requires that _"every type check… is determinable
from the IR alone, cheaply."_ A `{}` on a bound producer makes that impossible:
the validator cannot verify that downstream consumers use the value correctly.

---

## 2. Decision

**`{}` on a bound producer is valid IR but semantically `unknown`, not `any`.**

Concretely:

1. **Assignability TO `{}`** (consumer is `{}`): anything is assignable to
   unknown. No change. Continue to skip the check silently.

2. **Assignability FROM `{}` to a typed consumer** (producer is `{}`):
   the validator MUST eventually **error**. While emitter gaps remain
   (i.e. while DSL-compiled IR can still produce `{}` on bound producers due
   to unresolved G29), the validator emits a **warning** as an intermediate
   step. Once emitter gaps are closed (Phases 2-4 of the soundness plan), the
   warning is promoted to an error.

3. **Path access on a `{}` producer** (`resolveSchemaPath({}, ["foo", ...])`):
   same staged approach — **warning** while emitter gaps exist, **error** once
   all bound producers carry concrete schemas.

4. **Unbound CFG nodes** (nodes with no `bind`, pure sequencing): their
   `outputSchema: {}` is correct and irrelevant. No warning is needed because
   no consumer references them.

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

- `T → unknown`: always safe ✓
- `unknown → T`: requires narrowing (here: a concrete schema) — warn if absent

---

## 5. Validator changes required

Add `warnings: ValidationWarning[]` to `ValidationResult` (a new array
parallel to `errors`, with the same `{ path, message }` shape).

Two warning sites in `validate.ts`:

```typescript
// checkStructuralSubtype (currently line ~2562)
if (isTopSchema(consumer)) return; // still silent ✓
if (isTopSchema(producer) && !isTopSchema(consumer)) {
  // was: silent skip
  warnings.push({
    path,
    message:
      `Producer schema is unconstrained ({}); cannot verify ` +
      `assignability to ${formatSchemaType(consumer)}. ` +
      `Add a concrete outputSchema to enable static checking.`,
  });
  return;
}

// resolveSchemaPath — when called with a non-empty path on a {} schema
if (isTopSchema(schema) && path.length > 0) {
  warnings.push({
    path: refPath,
    message:
      `Path [${path.join(".")}] accessed on unconstrained schema ({}); ` +
      `cannot verify the field exists at runtime.`,
  });
  return {}; // current behaviour preserved; warning added
}
```

---

## 6. Emitter obligations and G29 resolution

Before Phase 5b (validator errors) can land, the emitter must produce zero `{}`
on any bound producer. This requires two tracks:

**Track A — immediately fixable (type already known):**

| Site                                               | Fix                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `forkMap` body `outputSchema` (emitter.ts ~2397)   | Wire the already-computed `elementSchema` into `body.outputSchema` |
| `fork` parallel branch body `outputSchema` (~2278) | Compute terminal node's outputSchema; same pattern as forkMap      |

**Track B — requires G29 resolution (branch/arm types):**

G29 is resolved prescriptively here:

1. **Same-type enforcement for `if`/`switch` arms.** The type checker must
   error when value-producing arms return different types (matching ternary).
2. **Partial return is a type error.** When `resultBind` is set on a branch
   node, both arms must return a value. `thenOutput ?? null` as a fallback must
   become unreachable.
3. **Store result types in `_resolvedSchemas`.** After checking `IfStatement`,
   `SwitchStatement`, and `TernaryExpr`, store the result type at the node's
   `loc.offset` — same pattern as `AttemptsNode` (gap 8). The emitter reads it
   back to set `branch.outputSchema` and `arm.scope.outputSchema`.

Once Track A and B are done:

| Site                                             | Fix                                            |
| ------------------------------------------------ | ---------------------------------------------- |
| `if/else` branch `outputSchema` (~603)           | Read from `_resolvedSchemas` at `s.loc.offset` |
| `switch` branch `outputSchema` (~729)            | Same                                           |
| Ternary branch `outputSchema` (~1419)            | Read from `_resolvedSchemas` at `e.loc.offset` |
| Arm `scope.outputSchema` (via `buildArmScope`)   | Pass resolved type instead of `{}`             |
| Ternary literal identity wrappers (~1366, ~1397) | Infer from literal value's JSON Schema type    |

---

## 7. IR spec impact

§4.1 pass 7 (type compatibility) should add a note:

> A producer schema of `{}` (the universal top type) is treated as **unknown**
> for validation purposes. Assignability _to_ `{}` is unconditionally satisfied.
> Assignability _from_ `{}` to a typed consumer, or path projection on `{}`,
> is a validation **error**. (During the transition period while emitter gaps
> are being closed, this is a warning; it becomes an error once the DSL
> compiler no longer emits `{}` on bound producers.)

---

## 8. Relationship to other decisions

- **Decision 0001 (bound outputs):** A node without `bind` has no addressable
  output. Its `outputSchema` is required by the IR grammar but is irrelevant to
  consumers. The unknown semantics decision applies only to _bound_ producers.
- **G29 (branch arm output types):** Resolved prescriptively in §6 above.
  Same-type enforcement for if/switch arms, partial-return as type error, and
  result type storage in `_resolvedSchemas` are the three required type-checker
  changes. G29 is no longer open once §6 Track B is implemented.
- **G18 (union types):** When `anyOf` is introduced for heterogeneous arm types,
  branch `outputSchema` can be a concrete union instead of `{}`.
