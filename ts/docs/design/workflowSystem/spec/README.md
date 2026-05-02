# Spec (v1 IR)

The workflow IR: the JSON document format, validation rules, and execution
semantics that any conforming engine must implement.

## Files

- **[spec-v1.md](spec-v1.md)** - the authoritative v1 spec. Single source of truth.
- **[revisit-triggers.md](revisit-triggers.md)** - index of v1 decisions with explicit reopening conditions.
- **[decisions/](decisions/)** - numbered per-decision records.
- **[post-v1/](post-v1/)** - sketches of features deferred past v1.

## Decision records

| #    | Topic                           | Status          | Doc                                                                          |
| ---- | ------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| 0001 | Bound outputs (hide-by-default) | Adopted v1      | [decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md)           |
| 0002 | CFG/DDG separation              | Adopted v1      | [decisions/0002-cfg-ddg-separation.md](decisions/0002-cfg-ddg-separation.md) |
| 0003 | Task schema source of truth     | Open (v1: spec) | [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md) |

When adding a new decision, allocate the next sequential number. Use
[decisions/0001-bound-outputs.md](decisions/0001-bound-outputs.md) as the
template.

## Post-v1 sketches

- **[post-v1/block-scope.md](post-v1/block-scope.md)** - explicit `block` scope (multi-statement try, regional grouping).

## Related

- [../principles/](../principles/) - the principles the spec is derived from.
- [../archive/](../archive/) - earlier drafts that drove this spec.
