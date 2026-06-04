# LSP — Future Work

Ideas and deferred enhancements that have a clear trigger condition
for when they become worth doing. Items here are **not** bugs or
accepted-by-design limitations — they are genuine improvements
deferred until user feedback or a dependency change makes them
worthwhile.

---

## Dotted-name hover beyond the head segment

**Origin:** Phase 2 inline self-review (2026-05-19)
**Trigger:** User feedback requesting member-aware hover

**Context:** `findReferenceAt` resolves a `DottedNameExpr` against its
head segment only — hovering `foo.bar.baz` shows `foo`'s definition,
not `bar` or `baz`. Resolving member accesses requires plumbing through
the `TypeChecker`'s inferred output types for each step in the chain;
the current resolver intentionally does not re-implement that.

**What "done" looks like:**

- `TypeChecker` exposes a `resolvedOutputType(taskName)` API (or
  equivalent) that maps a task's output-schema property names to their
  types.
- `findReferenceAt` walks the dotted chain, resolving each segment
  against the previous step's output type, and returns a hover
  `Location` pointing at the schema property definition.
- Existing head-segment behavior is unchanged for single-segment
  references.

---
