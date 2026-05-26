# Validator Soundness Fixes

Plan to close all gaps where the IR validator allows constructs that can fail at runtime.

## Gap 1: Path access on `{}` producer silently succeeds

**Problem**: `resolveSchemaPath` returns `{}` for any path on an unconstrained schema.
A `$from "scope", name "x", path: ["foo"]` where `x` has `outputSchema: {}` resolves
without error, but at runtime `x.foo` may not exist.

**Fix (two-pronged)**:

1. **Emitter** (primary): eliminate remaining `outputSchema: {}` sites by flowing type
   checker results through. Cases:
   - Destructuring picks (`emitDestructuring`): look up the tuple/array element type
     from `_resolvedSchemas` the same way `emitMap`/`emitFilter` do.
   - Branch result binds: compute the union of arm output types and emit that as the
     branch `outputSchema`.
   - Identity wrappers: propagate the input value's resolved schema to outputSchema.
2. **Validator** (safety net): keep the current `resolveSchemaPath` bailout for
   hand-authored IR, but emit a **warning** (new severity level or a separate
   diagnostics array) when it fires, so tooling can surface "unverified path access".

---

## Gap 2: `checkStructuralSubtype` skips when producer is top-type

**Problem**: `isTopSchema(producer) && !isTopSchema(consumer)` causes the function to
return immediately - no error even when the consumer requires a specific type.

**Fix**: same two-pronged approach as gap 1.

1. **Emitter**: once gap-1 emitter fixes land, there are no DSL-emitted `{}` producers
   feeding typed consumers.
2. **Validator**: change the lenient skip to emit a warning:
   ```typescript
   if (isTopSchema(producer) && !isTopSchema(consumer)) {
     warnings.push({
       path,
       message: `Producer is unconstrained ({}); cannot verify assignability to ${formatSchemaType(consumer)}.`,
     });
     return;
   }
   ```

---

## Gap 3: `$from "input"` name existence not validated

**Problem**: referencing a name not in `inputSchema.properties` silently resolves to
`undefined` in `resolveTemplateType`; no error reported.

**Fix**: add a dedicated pass (or extend `validateSchemaCompat`) that collects all
`$from "input"` refs and checks each `name` exists in the enclosing scope's
`inputSchema.properties`. Emit error: `$from "input", name "x": not declared in scope inputSchema`.

Location: add a helper `validateInputRefs(nodes, prefix, inputSchema, errors)` called
from `validateWorkflowBody` and recursively for loop/fork/branch sub-scopes (same
pattern as `validateSchemaCompat`).

---

## Gap 4: `$from "constant"` name existence not validated

**Problem**: same as gap 3, but for constants.

**Fix**: in the same new pass, collect `$from "constant"` refs and verify each `name`
exists in `ir.constants`. Emit error: `$from "constant", name "x": not declared in ir.constants`.

---

## Gap 5: Input/constant path access not schema-checked by `validateSchemaCompat`

**Problem**: `validateSchemaCompat` only calls `collectTemplateRefs(..., "scope")`. Paths
on `$from "input"` and `$from "constant"` are never checked by `checkSchemaCompat`.

**Fix**: extend the new pass from gaps 3-4 to also call `checkSchemaCompat` on the
resolved base schema (from `inputSchema.properties[name]` or `constants[name].schema`)
with the ref's `path`. This gives the same "path not declared in producer" error that
scope refs already get.

---

## Gap 6: Type check in `checkSchemaCompat` requires both sides to have `.type`

**Problem**: the overlap check only fires when `consumerType && resolved.type`. If
either side omits `.type` (e.g., `{ properties: {...} }` without `"type": "object"`),
no mismatch is reported.

**Fix**: normalize schemas before comparison. If a schema has `properties` but no
`type`, infer `type: "object"`. If it has `items` but no `type`, infer `type: "array"`.
Add a `normalizeSchemaType(schema)` helper and call it on both `resolved` and the
consumer before the overlap check.

---

## Gap 7: Branch arm covariance lost when branch `outputSchema` is `{}`

**Problem**: `checkArmCovariance` checks arms against the branch's `outputSchema`, but
since that's `{}`, `isTopSchema(consumer)` is true and the check is a no-op.

**Fix** (emitter-side): compute the branch's `outputSchema` as the union (anyOf) of all
arm `scope.outputSchema` values. Steps:

1. After emitting all arms, collect each arm's `scope.outputSchema`.
2. If all arms have the same schema, use that directly.
3. Otherwise emit `{ anyOf: [...armSchemas] }`.
4. Set this as `branchNode.outputSchema`.

This makes `checkArmCovariance` meaningful and also closes gap 2 for branch consumers.

---

## Gap 8: Loop `body.outputSchema` type check skipped when `{}`

**Problem**: `validateTypeCompatibility` skips the loop output check when
`isTopSchema(node.body.outputSchema)`.

**Fix** (emitter-side): for while-loops, the body output type is known from the type
checker (it's the return expression type). Emit it the same way map/filter do. For
`attempts` loops, the body output is the last arm's type - compute and emit.

Validator-side: once the emitter produces concrete schemas, the existing check works.
As a safety net, emit a warning (like gap 2) when the skip fires.

---

## Gap 9: `forkMap` element schema not validated against body `inputSchema`

**Problem**: the validator checks `collectionSchema.type === "array"` but never verifies
that `collectionSchema.items` is compatible with `body.inputSchema`.

**Fix**: in `validateForkMapNode`, after the array-type check, add:

```typescript
const itemSchema = node.collectionSchema?.items;
if (
  itemSchema &&
  typeof itemSchema !== "boolean" &&
  !Array.isArray(itemSchema)
) {
  checkStructuralSubtype(
    itemSchema,
    node.body.inputSchema,
    `${path}.body.inputSchema`,
    errors,
    "Collection element",
    "body inputSchema",
  );
}
```

---

## Implementation order

1. ~~**Gaps 3 + 4 + 5** (name existence + path checking for input/constant refs)~~ **DONE**
   Landed in `validateInputConstantRefs`.
2. ~~**Emitter: constrained sub-scope inputSchemas**~~ **DONE**
   Fixed `emitParallelMap` and `emitParallel` (fork branches) to declare proper
   `inputSchema.properties` via `captureOuterRefs` instead of bare `{}`.
   The validator now naturally validates parallelMap and fork body refs.
3. ~~**Gap 9** (forkMap element vs body)~~ **DONE**
   validateForkMapNode checks collectionSchema.items against body elementParam.
4. ~~**Gap 6** (normalize `.type` inference)~~ **DONE**
   `inferSchemaType()` infers type from structural cues; applied in
   `checkStructuralSubtype` and `checkSchemaCompat`.
5. ~~**isTopSchema guard removal**~~ **DONE**
   Removed `isTopSchema(scopeInputSchema)` leniency from
   `checkInputConstantRefsInTemplate`. Now all scopes with a defined inputSchema
   validate `$from input` refs against declared properties (no silent passthrough).
6. ~~**Gap 1 emitter** (destructuring picks, identity wrappers)~~ **DONE**
   - Exported `typeInfoToSchema` from type checker.
   - Emitter accepts `symbolTypes` map (from `checker.collectSymbolTypes()`).
   - `emitDestructuring` pick nodes use element type from symbolTypes for outputSchema.
   - Pure-literal return identity wrapper uses the workflow's declared outputSchema.
   - Fixed pre-existing bug: destructuring of complex expressions (parallel, map, etc.)
     now correctly creates pick nodes even when `emitExprAsNode` adds nodes to scope
     directly (returns undefined).
   - Ternary identity wrappers deferred to Gap 7 (branch arm types).
7. **Gap 7 emitter** (branch outputSchema as union) - deferred; see G29 in
   dsl-v0.1-gap.md for the architectural questions that must be resolved first.
8. ~~**Gap 8 emitter** (attempts loop body outputSchema)~~ **DONE**
   TypeChecker stores `bodyReturnType` in `_resolvedSchemas` at `e.loc.offset`.
   Emitter reads it back via `getResolvedSchemas` and sets `body.outputSchema`
   on the loop node (same pattern as map/filter/parallelMap).
9. **Gaps 2 + remaining 1** (validator warnings for residual `{}`) - superseded
   by the long-term plan below. Do not patch in isolation.

## Long-term plan: `{}` = unknown → full enforcement

The original Gap 9 is subsumed by a broader architectural plan targeting
**full enforcement** (errors, not just warnings). See:

- **IR decision 0011** (`ir/decisions/0011-top-schema-unknown-semantics.md`):
  defines `{}` as `unknown` (not `any`) for bound producers. End state is
  validator **errors** on any bound `{}` producer.

**Phases:**

1. ~~Decision doc (0011)~~ **DONE**
2. **Emitter — immediately fixable gaps:**
   - `forkMap` body `outputSchema` (~2397): wire `elementSchema`.
   - `fork` parallel branch body `outputSchema` (~2278): compute from terminal node.
3. **G29 resolution — type checker:**
   - `IfStatement`: error if value-producing arms return different types.
   - `SwitchStatement`: same.
   - Partial return in value-producing if/else: type error.
   - Store result type in `_resolvedSchemas` at `s.loc.offset` / `e.loc.offset`.
4. **Emitter — branch/arm gaps (unblocked by Phase 3):**
   - `if/else` and `switch` branch `outputSchema` (lines 603/729).
   - Ternary branch `outputSchema` (line 1419) and arm `scope.outputSchema`.
   - Ternary literal identity wrappers (lines 1366/1397).
   → After Phase 4: **zero `{}` on any bound producer** from the DSL compiler.
5. **Validator warnings** (`warnings[]` in `ValidationResult`): deploy and
   confirm DSL-compiled IR produces zero warnings.
6. **Validator enforcement**: promote warnings to errors. Any IR with a bound
   `{}` producer is rejected.
7. **IR spec update**: ir-v0.1.md §4.1 pass 7 note.

## Testing strategy

- Each gap fix should have a corresponding `.json` IR fixture that previously passed
  validation but should now fail (for gaps 3-6, 9) or warn (gaps 1-2, 7-8).
- Compile all existing `.wf` files and confirm zero new errors (regression).
- Add unit tests in `validate.spec.ts` for each new error/warning message.
