# Engine Implementation Review Items

Tracked items from the engine review against ir-v0.1.md and ir-v0.2.md
that require design discussion before implementation.

## R3: Error object `code` field uses generic values

**Spec:** ir-v0.1.md §3.8.1 defines well-known error codes:
`LoopMaxIterationsExceeded`, `BranchSelectorUnmatched`,
`ReferenceUnresolved`. The `source` field discriminates `"task"` vs
`"runtime"`.

**Current state:** The engine's `buildErrorObject` function uses generic
codes `TASK_ERROR` and `RUNTIME_ERROR` for all errors. The spec-defined
codes (`LoopMaxIterationsExceeded`, etc.) are not used. Error messages
contain the information but not in the structured `code` field.

**Discussion:** Fixing this requires:

1. Define an enum or constants for well-known error codes.
2. Thread the appropriate code through each failure site:
   - `LoopMaxIterationsExceeded` from the loop iteration cap
   - `BranchSelectorUnmatched` from branch selector lookup failure
   - `ReferenceUnresolved` from `$from` resolution failure
   - `OutputSchemaViolation` from output schema validation
   - `InputSchemaViolation` from input schema validation
3. Update `buildErrorObject` and the `EngineError` class to carry a
   `code` field.
4. Update tests that assert on error messages/shapes.

**Impact:** Medium — affects error handling workflows that branch on
`error.code`.
