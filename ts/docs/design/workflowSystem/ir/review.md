# Engine Implementation Review Items

Tracked items from the engine review against ir-v0.1.md and ir-v0.2.md
that require design discussion before implementation.

## R2: Fork branch sub-scope structure diverges from spec

**Spec:** ir-v0.2.md §2.1 defines each fork branch as a flat structure
with `inputs`, `inputSchema`, `entry`, `nodes`, `output`, `outputSchema`
(same contract as loop bodies).

**Current state:** The engine's `ForkBranch` type separates this as:
```typescript
interface ForkBranch {
    inputs: Record<string, Template>;
    scope: WorkflowScope;
}
```
where `WorkflowScope` contains `inputSchema`, `entry`, `nodes`, `output`,
`outputSchema`. This means the IR JSON shape has a nested `scope` object
not shown in the spec's flat branch structure.

**Discussion:** The factoring is reasonable for code reuse (WorkflowScope
is shared with loop bodies and the top-level workflow). However, it means
IR documents must use the nested `scope` shape, which diverges from the
spec. Options:

1. Update the spec to match the engine's nested `scope` shape.
2. Flatten `ForkBranch` to match the spec (breaking change to existing IR
   documents).
3. Accept both shapes with a normalization step.

**Impact:** Medium — affects IR serialization format and any tooling that
produces fork nodes.

