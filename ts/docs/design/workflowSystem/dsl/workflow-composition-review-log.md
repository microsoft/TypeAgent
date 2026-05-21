# Workflow composition — review log

Per impl plan §4, this file captures code-review feedback that was
**not** acted on, with reason. Acted-on feedback does not need a log
entry; the diff is the record. Each entry is tagged to the phase that
produced it.

## Phase 3 — Type checker

(No unactioned feedback. All review-pass findings were addressed in
the same phase.)

## Phase 5 — Engine

(No unactioned feedback. Both critical/major findings from passes 1
and 2 were addressed in-phase: input-validation EngineErrorKind, the
`timeoutMs` enforcement gap, and the early-return-before-finally bug.)

## Phase 7 — Imports

### P7-R1 (MINOR, pass 1): MemoryResolver in tests can produce non-canonical paths

- **Finding:** The test-only `MemoryResolver` in
  `fileLoader.spec.ts` joins path segments manually and may produce
  strings without a leading `/` if `..` climbs past the root, which
  could in principle defeat the loader's path-keyed dedup.
- **Decision:** Not acted on. The class is test-only and all current
  tests construct absolute paths under `/p/...` that never climb above
  root. Production code uses Node's `path.resolve`, which normalizes
  correctly. Re-evaluate if a future test legitimately needs `../`
  climbing past the workspace root.

### P7-R2 (defensive, pass 2): broader Windows-path / case-insensitive coverage

- **Finding:** `path.relative` + `realpathSync` covers the symlink
  bypass on POSIX. Windows behavior (case-insensitive comparisons,
  drive letters, UNC paths) is not exercised by tests.
- **Decision:** Not acted on. The TypeAgent CI matrix is POSIX-first
  for these packages, and `path` is platform-aware (it already does
  the right thing on Windows). If we ever target Windows-only
  deployment scenarios for `wfc`, add a Windows-specific test pass.
