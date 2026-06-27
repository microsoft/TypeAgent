# Workflow IR

The workflow IR: the JSON document format, validation rules, and execution
semantics that any conforming engine must implement.

## Files

- **[ir-v0.1.md](./ir-v0.1.md)** - the foundational IR spec. Core node kinds, scope model, execution semantics.
- **[ir-v0.2.md](./ir-v0.2.md)** - IR extensions: fork/forkMap concurrency, standard library, builtin tasks.
- **[revisit-triggers.md](./revisit-triggers.md)** - index of decisions with explicit reopening conditions.
- **[dsl-assumptions.md](./dsl-assumptions.md)** - DSL-shaped assumptions baked into the IR that the DSL design must confirm or refute.
- **[decisions/](../../../design/workflowSystem/ir/decisions)** - numbered per-decision records.
- **[future/](../../../design/workflowSystem/ir/future)** - sketches of features deferred to future iterations.

## Decision records

| #    | Topic                           | Status        | Doc                                                                            |
| ---- | ------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| 0001 | Bound outputs (hide-by-default) | Adopted v1    | [decisions/0001-bound-outputs.md](./decisions/0001-bound-outputs.md)           |
| 0002 | CFG/DDG separation              | Adopted v1    | [decisions/0002-cfg-ddg-separation.md](./decisions/0002-cfg-ddg-separation.md) |
| 0003 | Task schema source of truth     | Open (v1: IR) | [decisions/0003-task-schema-source.md](./decisions/0003-task-schema-source.md) |

When adding a new decision, allocate the next sequential number. Use
[decisions/0001-bound-outputs.md](./decisions/0001-bound-outputs.md) as the
template.

## Post-v1 sketches

- **[future/block-scope.md](./future/block-scope.md)** - explicit `block` scope (multi-statement try, regional grouping).

## Related

- [../principles/](../../../design/workflowSystem/principles) - the principles the IR is derived from.
