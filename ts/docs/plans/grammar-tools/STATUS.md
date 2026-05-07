# Grammar Tools - Plan Status & Backlog

Working tracker for the plan-refinement pass kicked off by the
2026-04-28 review of [PLAN.md](./PLAN.md) and the eight chunk / four
ADR documents in this folder.

This file is the **single source of truth for queued plan-refinement
work**. Update it whenever an action is started, completed, or a new
follow-up surfaces. Keep entries terse - one line per item where
possible.

## Conventions

- **Status**: `queued` / `in-progress` / `done` / `dropped`.
- Each item links to the relevant chunk(s) / ADR(s) it touches.
- New follow-ups discovered mid-action go under "Discovered follow-ups"
  with a back-reference to the action that surfaced them.

## In progress

_(none)_

## Queued actions (from 2026-04-28 review)

Ordered as in the review's "Recommended next actions" list. Action 1
is already done; items below are next.

| #   | Action                                                                                                                                                           | Touches                                                                                      | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| 2   | Sketch `LoadedGrammar` and `TraceEvent` types (placeholders)                                                                                                     | [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) | done   |
| 3   | Pick CLI location (`packages/grammarTools/cli`); update PLAN + chunk 07                                                                                          | [PLAN.md](./PLAN.md), [07-cli.md](./07-cli.md)                                               | done   |
| 4   | Define error-handling contract (Diagnostics vs exceptions) in chunk 01                                                                                           | [01-core.md](./01-core.md)                                                                   | done   |
| 5   | Add Phase-2 decision-gate exit criteria to PLAN                                                                                                                  | [PLAN.md](./PLAN.md)                                                                         | done   |
| 6   | Lock diff granularity (rule-level v1) and coverage shape (source-coordinated) in chunk 08                                                                        | [08-coverage-and-diff.md](./08-coverage-and-diff.md)                                         | done   |
| 7   | Delete now-redundant `/memories/repo/grammar-matching-architecture.md` (content folded into [actionGrammar.md](../../architecture/actionGrammar.md) in action 1) | repo memory                                                                                  | done   |
| 8   | Add a "Motivation" section to PLAN.md (1-2 paragraphs on users / problems)                                                                                       | [PLAN.md](./PLAN.md)                                                                         | done   |

## Queued actions (from 2026-04-28 second review)

Surfaced by the plan re-review after action 8. Ordered by blocking
impact: 9 unblocks the most downstream work, 13 is least urgent.

| #   | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Touches                                                                                                                                                                                                            | Status   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 9   | Resolve [ADR 0001](./decisions/0001-shared-ui-tech.md) (shared UI tech). Component inventory in chunk 04 already covers 0001's step 1; finish step 2 (lib survey) and pick A/B/C. Unblocks Track D scaffold and (transitively) C.6 / G.3 / H.2. **Deferred 2026-04-28:** owner doing lib survey first; theming + bundle-shape sub-questions also deferred to chunk 04 implementation.                                                                                                                                                                                                                                             | [ADR 0001](./decisions/0001-shared-ui-tech.md), [04-shared-ui.md](./04-shared-ui.md)                                                                                                                               | deferred |
| 10  | Decide `PartId` stability strategy (compile-time integer id vs AST-path string vs rule-local index). Affects coverage aggregation across reloads, `GrammarDebugInfo.positions` keying, and `TraceEvent` hot-path size. Lock before chunk-02 starts. **Decided 2026-04-28:** option B - compile-time integer id, source-assigned at parse time, propagated through every optimizer pass. Chunks 02 and 01 updated; `GrammarDebugInfo` split into `rules` and `parts` maps.                                                                                                                                                         | [02-matcher-instrumentation.md](./02-matcher-instrumentation.md), [01-core.md](./01-core.md), [08-coverage-and-diff.md](./08-coverage-and-diff.md)                                                                 | done     |
| 11  | Decide `GrammarDebugInfo` emission sequencing: either promote to a Track 0 item (e.g. 0d) so coverage can ship usable, or downgrade chunk-08 to "source coordinates optional in v1". Pick one - current state lets the gate open with broken B.3. **Decided 2026-04-28:** hybrid (option C). `PartId` assignment + optimizer propagation lands in Track 0 (chunk 02, per action 10); compiler-side `GrammarDebugInfo` emission is a new Track A.5 item in `actionGrammar`. Chunks 02 / 01 / PLAN updated; gate criterion #5 now requires A.5 landed.                                                                              | [PLAN.md](./PLAN.md), [08-coverage-and-diff.md](./08-coverage-and-diff.md), [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md)                                           | done     |
| 12  | Promote shared service contract to a new ADR 0005: `grammar-tools-core` function signatures **are** the wire format; `GrammarBackend` is the typed mirror; webview/HTTP/IPC/in-process all use it. Removes chunk-03 open question on messaging. **Decided 2026-04-28:** ADR 0005 accepted. Wire framing and `traceMatch` event-stream shape deferred as explicit open sub-decisions tied to chunk 03 and 04 implementation (UX requirements not yet defined). Chunks 01 / 03 / 04 + PLAN ADR table updated.                                                                                                                       | new [decisions/0005-shared-service-contract.md](./decisions/0005-shared-service-contract.md), [01-core.md](./01-core.md), [03-vscode-extension.md](./03-vscode-extension.md), [04-shared-ui.md](./04-shared-ui.md) | done     |
| 13  | Resolve [ADR 0003](./decisions/0003-grammar-snapshot.md) before (or as part of) A.1 lands, not later. Locks whether snapshots ship `debugInfo` / source bytes / both / neither, which `LoadedGrammar` already declares as an open question. **Decided 2026-04-28:** ADR 0003 accepted with three sub-decisions. (1) Transport: JSON via `grammarToJson` over RPC. (2) Ship `GrammarDebugInfo` alongside grammar (unblocks live coverage + reveal-rule). (3) No source bytes in v1 (use `decompile()` if needed). F.1 now depends on A.5 as well as A.1; chunk 01 scenario 4b removed; chunk 06 source-spans open question closed. | [ADR 0003](./decisions/0003-grammar-snapshot.md), [01-core.md](./01-core.md), [PLAN.md](./PLAN.md), [06-shell-integration.md](./06-shell-integration.md)                                                           | done     |

## Done

| Date       | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Touches                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 2026-04-28 | Sketch `LoadedGrammar` (semi-opaque handle: source / compiled grammar / AST / text / identifier index) and `TraceEvent` discriminated union (rule entered / exited / part attempted / matched / failed / backtrack). Defines `RuleId` / `PartId` placeholders. Coverage (chunk 08, B.3) reuses the trace stream.                                                                                                                                                                                      | [01-core.md](./01-core.md), [02-matcher-instrumentation.md](./02-matcher-instrumentation.md) |     | 2026-04-28 | Restructure `LoadedGrammar` into a three-layer envelope (`grammar` + optional `debugInfo` + optional `files`) after walking through six host scenarios. Compiler-emitted `GrammarDebugInfo` (sidecar JSON, analogous to `.pdb` / source maps) and lazy `decompile(grammar)` API give graceful degradation for snapshot mode. Per-service requirements matrix added. Decompile API declared in chunk 01; implementation deferred. | [01-core.md](./01-core.md) |     | 2026-04-28 | Resolve ADRs 0001 & 0002, sequence 0003 / 0004 into the plan as phase-gated decisions. Move canonical NFA/DFA backend overview into [actionGrammar.md](../../architecture/actionGrammar.md). 0002 Accepted (option A, with bench-validation gate); 0001 / 0003 / 0004 still Open with phase-relative resolve-before markers. | All four ADRs, [PLAN.md](./PLAN.md), architecture doc |
| 2026-04-28 | Add Motivation section to PLAN.md, placed before Naming conventions. Names three audiences (agent authors, matcher devs, quality / release engineers), states the gap each faces today, and ties the single-core-services design back to that gap.                                                                                                                                                                                                                                                    | [PLAN.md](./PLAN.md)                                                                         |
| 2026-04-28 | Delete repo memory `/memories/repo/grammar-matching-architecture.md`. Verified that actionGrammar.md already covers NFA/DFA backends, `computeNFACompletions` / `getDFACompletions`, `matchedPrefixLength`, direction asymmetry, and Cat 3b shadow-candidate handling - all content from the repo memory is preserved (and richer) in the architecture doc.                                                                                                                                           | repo memory                                                                                  |
| 2026-04-28 | Lock chunk 08 v1 contracts: diff granularity = rule-level only (`added` / `removed` / `changed`, no sub-rule structural diff; upgrade path is additive); coverage shape = source-coordinated Istanbul-flavored (per-rule + per-part hit counts keyed by `SourceLocation`, requires `GrammarDebugInfo`, throws `MissingDebugInfoError` otherwise); coverage event source = reuse chunk 02 `TraceEvent` stream (no separate cheaper coverage event in v1).                                              | [08-coverage-and-diff.md](./08-coverage-and-diff.md)                                         |
| 2026-04-28 | Add Phase-2 decision-gate exit criteria to PLAN: (1) Tracks A/B shipped end-to-end with green tests, (2) VS Code C.1-C.6 landed (C.7/C.8 nice-to-have), (3) manual E2E pass on three representative grammars, (4) ADRs 0003 and 0004 resolved, (5) chunk-01 follow-ups closed or owned. Single named owner signs off; no partial opening.                                                                                                                                                             | [PLAN.md](./PLAN.md)                                                                         |
| 2026-04-28 | Add error-handling contract to chunk 01: three failure kinds with one canonical channel each. (1) In-source problems = `Diagnostic[]`. (2) Catastrophic load = `LoadResult.ok = false`. (3) Caller misuse / missing fidelity layer = typed exception (`MissingDebugInfoError`, `MissingSourceError`, all extending `GrammarToolsError`). Per-service throw matrix; `hasDebugInfo` / `hasSource` type-guard helpers; internal invariant violations stay as plain `Error`s outside the public contract. | [01-core.md](./01-core.md)                                                                   |
| 2026-04-28 | Lock CLI location: `packages/grammarTools/cli` (kebab name `grammar-tools-cli`), sibling to `core` and `ui`. `--json` output mode mandatory from E.0 so each later command is CI-pipeable. Fixture grammars come from `packages/actionGrammar/test-data`; CLI does not ship its own.                                                                                                                                                                                                                  | [PLAN.md](./PLAN.md), [07-cli.md](./07-cli.md)                                               |
| 2026-04-28 | Make `grammar` required on `LoadedGrammar` after weighing pros / cons of "grammar optional when source present". Compile failures now flow through a `LoadResult` discriminated union at the loader boundary; LSP-style hosts cache last-known-good. Eliminates a runtime branch from every service.                                                                                                                                                                                                  | [01-core.md](./01-core.md)                                                                   |

## Discovered follow-ups

Items raised mid-action that aren't on the original numbered list.
Promote into "Queued actions" when scheduling.

- **ADR 0003 (snapshot transport): does the snapshot ship `debugInfo`,
  source bytes, both, or neither?** Surfaced by the action-2 deeper
  pass on `LoadedGrammar`. The three-layer model lets snapshot mode
  degrade gracefully whichever choice we make, but ADR 0003 should
  pick a default and call it out.
- **Implement `decompile(grammar)` and `GrammarDebugInfo` emission.**
  API declared in chunk 01; needs an implementation chunk (Track A.5
  candidate) before chunks 06 / 08 can rely on it. Touches
  `actionGrammar` (compiler emits debug info, writer projects
  `Grammar` → `RuleDefinition`) and `grammar-tools-core`.
- **Error-tolerant parser.** `parseGrammarRules` currently throws on the
  first error. Make it recoverable so it can report multiple errors in
  one pass (e.g. skip to next `;` after a parse failure and continue).
  Also add a `returnPartial` option to `loadGrammarRulesNoThrow` that
  returns the `Grammar` even when errors are present (best-effort) so
  symbol navigation continues working on incomplete files. Semantic
  analysis (unused rules, unreachable alternatives) should also be a
  flag on `loadGrammarRulesNoThrow` rather than a separate function,
  since the compiler already has access to the full AST and symbol
  table at compile time.
- **Extension bundling.** Consider esbuild/rollup for the agr-language
  extension to produce a single-file bundle for faster activation and
  smaller install size. Not blocking for dev, but desirable before
  publishing.
- **Cross-file symbol resolution.** Handle imports and multi-file
  grammars in the symbol index (go-to-def across files, find-refs
  spanning imported grammars). Requires the loader to resolve import
  paths and build a multi-file LoadedGrammar.
- **NFA/DFA trace instrumentation.** The current trace hook covers only
  the `grammarMatcher` (rule-level backtracking matcher). Adding trace
  support to `nfaMatcher` and `dfaMatcher` would allow debugging and
  coverage analysis for the NFA/DFA compile paths as well. Lower
  priority since the rule-level matcher is the primary matching backend
  for authoring/debugging; NFA/DFA are production-optimized paths.
- **B.3 coverage / B.4 diff implementation.** Stubs (`runCoverage`,
  `diffGrammars`) removed during self-review (2026-05-07) to avoid
  shipping dead code. Types (`CoverageReport`, `RuleCoverage`, etc.)
  remain in `types.ts` as the agreed shape. Implement when Track A.5
  (`GrammarDebugInfo` emission) lands.

## Out of scope for this pass

_(none yet)_
