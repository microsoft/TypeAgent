# Workflow IR

The workflow IR: the JSON document format, validation rules, and execution
semantics that any conforming engine must implement.

## Files

- **[ir-v1.md](ir-v1.md)** - the authoritative v1 IR. Single source of truth.
- **[revisit-triggers.md](revisit-triggers.md)** - index of v1 decisions with explicit reopening conditions.
- **[dsl-assumptions.md](dsl-assumptions.md)** - DSL-shaped assumptions baked into v1 that a future DSL design must confirm or refute.
- **[decisions/](decisions/)** - numbered per-decision records.
- **[post-v1/](post-v1/)** - sketches of features deferred past v1.

## Decision records

| #    | Topic                           | Status        | Doc                                                                          |
| ---- | ------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| 0001 | Bound outputs (hide-by-default) | Adopted v1    | [decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md)           |
| 0002 | CFG/DDG separation              | Adopted v1    | [decisions/0002-cfg-ddg-separation.md](decisions/0002-cfg-ddg-separation.md) |
| 0003 | Task schema source of truth     | Open (v1: IR) | [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md) |

When adding a new decision, allocate the next sequential number. Use
[decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md) as the
template.

## Post-v1 sketches

- **[post-v1/block-scope.md](post-v1/block-scope.md)** - explicit `block` scope (multi-statement try, regional grouping).

## Related

- [../principles/](../principles/) - the principles the IR is derived from.
