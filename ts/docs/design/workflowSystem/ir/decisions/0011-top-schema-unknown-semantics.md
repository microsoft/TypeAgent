# Decision 0011: `{}` = unknown semantics for bound producer schemas

**Status:** Proposed.
**Supersedes:** The implicit "any" behaviour in the current validator.
**Related:** ir-v0.1.md §4.1 pass 7; G29 (dsl-v0.1-gap.md); validator-soundness plan.

---

## 1. Problem

`outputSchema: {}` appears in two semantically different roles across the IR
today, but the validator treats both identically as **"any"** — it skips all
subtype checks when the producer schema is `{}`.  This is unsound for the
second role.

| Role | Example nodes | Semantics needed |
|------|--------------|-----------------|
| Pure CFG node, no consumer | `noop`, `merge` (no `bind`) | `{}` is irrelevant; skip silently ✓ |
| Bound producer, type not yet inferred | `BranchNode` with `bind`, arm scopes | `{}` means **unknown** — warn on path access |
| Bound producer, type IS knowable | emitter gap (e.g. forkMap body) | Fix the emitter; emit the real schema |

The IR specification (§1.1) requires that *"every type check… is determinable
from the IR alone, cheaply."* A `{}` on a bound producer makes that impossible:
the validator cannot verify that downstream consumers use the value correctly.

---

## 2. Decision

**`{}` on a bound producer is valid IR but semantically `unknown`, not `any`.**

Concretely:

1. **Assignability TO `{}`** (consumer is `{}`): anything is assignable to
   unknown. No change. Continue to skip the check silently.

2. **Assignability FROM `{}` to a typed consumer** (producer is `{}`):
   the validator **SHOULD warn**, not error. The warning message should name the
   producer, the consumer, and the path. This is a warning (not an error)
   because hand-authored IR and partially-typed LLM-generated IR are legitimate
   escape hatches — the author may know the runtime type even when the schema
   doesn't capture it.

3. **Path access on a `{}` producer** (`resolveSchemaPath({}, ["foo", ...])`):
   the validator **SHOULD warn**. Path access on unknown is unverifiable.

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

`{}` is the **top type**: every other schema is a subtype of it.  Reading
*from* the top type is the unsafe operation (you know nothing about the shape).
Writing *to* the top type is always safe (anything is a subtype).

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
if (isTopSchema(consumer)) return;                     // still silent ✓
if (isTopSchema(producer) && !isTopSchema(consumer)) { // was: silent skip
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
    return {};   // current behaviour preserved; warning added
}
```

---

## 6. Emitter obligations

Before Phase 3 (validator warnings) lands, the emitter should close all sites
where the type IS statically knowable but is dropped:

| Site | Fix |
|------|-----|
| `forkMap` body `outputSchema` (emitter.ts ~2397) | Wire the already-computed `elementSchema` into `body.outputSchema` |
| `fork` parallel branch body `outputSchema` (~2278) | Compute terminal node's outputSchema and emit it |
| Ternary arm identity wrappers (~1366, ~1397) | Infer schema from the literal value passed as `value` input |
| Ternary `BranchNode.outputSchema` (~1419) | Look up result type from `symbolTypes` at `expr.loc.offset` |
| `if/else` and `switch` branch/arm schemas (~603, ~729) | Deferred to G29 resolution |

The goal: by the time Phase 3 warnings land, the warning set should be small
enough (only the genuinely unknowable cases) to be actionable rather than noisy.

---

## 7. IR spec impact

§4.1 pass 7 (type compatibility) should add a note:

> A producer schema of `{}` (the universal top type) is treated as **unknown**
> for validation purposes. Assignability *to* `{}` is unconditionally satisfied.
> Assignability *from* `{}` to a typed consumer, or path projection on `{}`,
> produces a validation **warning** (not an error), because the author may hold
> runtime knowledge the schema does not capture. Tools MAY surface these
> warnings; engines MAY ignore them.

---

## 8. Relationship to other decisions

- **Decision 0001 (bound outputs):** A node without `bind` has no addressable
  output. Its `outputSchema` is required by the IR grammar but is irrelevant to
  consumers. The unknown semantics decision applies only to *bound* producers.
- **G29 (branch arm output types):** The arm-scope `{}` schemas on if/else and
  ternary branches are the largest remaining source of `{}` bound producers.
  G29 resolves the architectural questions that gate fixing those sites.
- **G18 (union types):** When `anyOf` is introduced for heterogeneous arm types,
  branch `outputSchema` can be a concrete union instead of `{}`.
