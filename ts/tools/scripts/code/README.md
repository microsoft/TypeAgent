# Code-quality analysis suite

A set of self-contained analysis tools for the TypeAgent `ts/` tree, plus the
maintainability roadmap they drive. Each tool wraps a **standard engine**
(ESLint, jscpd, madge, knip) rather than a bespoke metric, runs against a
throwaway in-memory config so the repo needs no committed linter config, and
emits a CSV + JSON + self-contained HTML report **and** a console summary.

Most tools also have a **CI mode** — a stateless _ratchet_ (the base branch is
the baseline, so the metric can only trend down) or a zero-tolerance _gate_ —
wired into [`.github/workflows/build-ts.yml`](../../../../.github/workflows/build-ts.yml)
so existing debt never blocks a PR but new debt does.

> Report output folders (`*-report/`) are generated and git-ignored.

## The tools

Run any of these from `ts/`. All accept `--help`, `--root <path>`,
`--out-dir <path>`, `--top <n>`.

| Command                    | Engine                     | Measures                                                                                          | Baseline (2026-07)                                               | CI gate                                                    |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run code-complexity`  | ESLint + sonarjs           | cyclomatic + cognitive complexity per function                                                    | budgets 50/60 in CI                                              | **ratchet** (+ new-file caps)                              |
| `npm run code-lint`        | ESLint + typescript-eslint | `no-explicit-any`, `no-console`, `no-unused-vars`, `no-var`, `prefer-const` (+ opt-in type-aware) | 6,396 (any 3,874 · console 2,098 · unused 421 · **var/const 0**) | **ratchet** (+ zero-tolerance for `no-var`/`prefer-const`) |
| `npm run code-duplication` | jscpd                      | copy/paste clones, cross-package + per-package                                                    | 744 clones / 13,984 lines (3.67%)                                | —                                                          |
| `npm run code-circular`    | madge                      | runtime import cycles                                                                             | 232 cycles (dispatcher 115)                                      | **ratchet** (no new cycles)                                |
| `npm run code-consistency` | custom                     | cross-package duplicate exports, direct `process.env`, agent-layout conformance                   | 16 dup exports · 263 env refs · agents 33/34                     | —                                                          |
| `npm run code-deadcode`    | knip                       | unused files / exports / deps                                                                     | ~1,790 raw (needs config)                                        | — (report-only)                                            |
| `npm run code-debt`        | regex scan                 | TODO/FIXME/HACK/XXX, `@deprecated`, skipped/focused tests                                         | TODO 207 · `@deprecated` 41 · skipped 2 · focused 0              | **gate** (no focused / no new skips)                       |

### Modes

- **Report (default):** scans the tree, writes `<tool>-report/{*.csv,report.json,report.html}` + a console summary.
- **Ratchet / gate (`--ratchet` / `--gate` `--base <ref>`):** lints only the
  files changed vs the merge base and fails if the change adds debt. Used in CI
  with `--base "origin/${{ github.base_ref }}"`.

### Tool-specific flags

- **code-lint:** `--fix` (apply `no-var`/`prefer-const` autofixes in place),
  `--changed` (with `--fix`, only rewrite files changed vs `--base`),
  `--type-aware` (adds `no-floating-promises`, `no-misused-promises`,
  `no-deprecated` — slower, report only), `--new-file-max <n>`.
- **code-complexity:** `--cyclomatic <n>`, `--cognitive <n>`,
  `--new-file-cyclomatic <n>`, `--new-file-cognitive <n>`,
  `--exceptions-file <path>` (optional baseline exceptions by `file:line`).
  For local CI-parity runs, use `npm run code-complexity:ci`.
  To refresh the baseline exception file from current code, use
  `npm run code-complexity:update-exceptions`.
- **code-deadcode:** `--config` (defaults to [`knip.jsonc`](./knip.jsonc)).

### Baseline exceptions

The ratchet/gate tools accept `--exceptions-file <path>` — an optional JSON file
that grandfathers a specific set of known offenders so they don't trip the gate
(useful when a file move that git rename detection misses makes pre-existing
debt look new). Each file's `--ratchet`/`--gate` step honors it; the report
modes ignore it. Shape is `{ "exceptions": [ ... ] }` (a bare array also works):

- **code-lint** / **code-complexity** / **code-debt:** entries are
  `{ "file": "packages/foo/src/bar.ts", "line": 42 }` (paths are normalized, so
  a leading `ts/` is optional). Matches by `file:line`.
- **code-circular:** entries are `{ "cycle": ["packages/a/src/x.ts", "packages/b/src/y.ts"] }`
  or `{ "key": "packages/a/src/x.ts > packages/b/src/y.ts" }`. Matched
  rotation-invariantly against detected cycles.

### Notes for maintainers

- `npx` cannot resolve local bins in some dev environments; the tools invoke
  engines via `pnpm exec` (knip) or `createRequire` (jscpd, madge) accordingly.
- `jscpd@4` (not 5, which is a Rust CLI with no Node API) is required for the
  programmatic API used by the duplication tool.
- Each tool is intentionally self-contained (its own `packageKeyOf`, arg parser,
  report writers) so it can be copied/run in isolation.

## CI gates

PR-only steps in `build-ts.yml`, after the build, each fetching the base ref:

1. **Complexity ratchet** — changed files may not add functions over the
   cyclomatic/cognitive budget; new files held to a hard cap.
2. **Lint ratchet** — changed files may not add violations; `no-var` /
   `prefer-const` are zero-tolerance (must stay at 0).
3. **Circular dependency ratchet** — the change may not introduce a new import
   cycle (compares HEAD vs the merge base via a throwaway git worktree; heavier,
   ~80s).
4. **Test debt gate** — zero focused tests (`.only`/`.only.each`/`fit`/`fdescribe`),
   no newly skipped tests (`.skip`/`.skip.each`/`xit`/`xdescribe`) in changed files.

Dead-code is **not** gated yet — knip's numbers are inflated until
[`knip.jsonc`](./knip.jsonc) declares the entry points it can't infer.

## Maintainability roadmap

### Done

- Built the 7-tool analysis suite above.
- Wired 4 CI gates (complexity, lint, circular, debt) into `build-ts.yml`.
- **Quick win #1 — `prefer-const`/`no-var` → 0** (262 files auto-fixed via
  `code-lint --fix` + 7 hand-fixed; now gated at zero). Verified: full build
  passes, and every unit/live test failure was proven pre-existing (the changes
  are semantics-preserving `let`/`var`→`const`).
- **Quick win #2 — skipped-test detection + triage.** Taught `code-debt` to see
  `.skip.each`/`.only.each` and to ignore conditional/placeholder stubs (empty
  `() => {}` bodies from the `testIf`/`describeIf` key-gates and data-driven
  loops), so the count reflects genuinely disabled tests. Re-enabled the
  `CalendarDate` grammar test (the converter it waited on now exists) and
  replaced the dead, no-op `api/test/api.spec.ts` with a real `api.test.ts`
  web-server smoke test: **14 → 2** (both remaining are intentional).

### Next — quick wins (low risk)

- **Skipped tests — down to 2, both intentional** (no action needed): the
  documented `.skip.each` suites `actionGrammar/test/nfaDfaParity.spec.ts`
  (DFA-AST ruleRef-binding gap) and `actionSchema/test/regen.spec.ts`
  (exact-regen, explicitly not a goal). Un-skip when those land; the debt gate
  already blocks new ones.
- **WebSocket helpers** — `createWebSocket` + `keepWebSocketAlive` are
  reimplemented in 4 packages; point `browser`/`coda`/`shell` at
  `utils/webSocketUtils` and delete the forks.

### Next — consolidations (medium)

- **Async helpers → `packages/typeagent`** — unify `delay`/`sleep`/`pause`,
  export the private `withTimeout`, consolidate retry.
- **FS helpers → shared module** — `ensureDir` (4 pkgs) + JSON read/write.
- **De-fork `actionGrammar` ↔ `agentSdkWrapper`** — ~1,115 duplicated lines
  (grammar-gen near-forks).
- **Extract `powershell` ↔ `taskflow` benchmark harness** — ~1,069 lines / 45
  clones → one shared package.
- **`process.env` → `@typeagent/config`** — 263 refs across 115 files; then add
  a lint rule so it can't regress.

### Ongoing burn-downs (ratchets already hold the line)

- **`any`** — 3,874 occurrences.
- **`console.log` → `debug` tracing** — 2,098 in non-CLI packages.
- **Untangle `dispatcher/internal.ts` barrel** — source of ~115 of the 232 cycles.
- **God-file decomposition** — `chatPanel.ts` (4,790), `collisionCorpusHandlers.ts`
  (5,230), `grammarMatcher.ts` (3,744)…
- **Remove `@deprecated` APIs** — 41.

### Tooling follow-ups

- Tune [`knip.jsonc`](./knip.jsonc) entry points → trustworthy dead-code number
  → then add a `code-deadcode` gate.
- Optionally restrict the heavier circular ratchet to one CI matrix cell
  (`&& matrix.os == 'ubuntu-latest' && matrix.version == 22`) to save compute.
- Optionally add a `code-duplication` ratchet.

## Known pre-existing issues (surfaced by the test runs, unrelated to the above)

- **Missing local test fixtures** — e.g.
  `packages/memory/conversation/test/data/claudeSession.jsonl` (+ `copilotSession.jsonl`,
  `claudeSessions/`). Causes `ENOENT` unit + live failures locally.
- **Stale local build/link** — `knowledgeProcessor` (`Cannot find module 'aiclient'`),
  `shell` (`Cannot find module 'action-grammar'`, missing `PartialCompletionSession`
  export). A clean `pnpm install && pnpm run build` likely clears these.
- **`workflow/cli`** unit tests time out at the default 5s (need higher timeouts).
- **`defaultAgentProvider` translate live tests** drift — the model returns
  newer/plausible actions (e.g. `createPlaylist`) the fixtures don't allow; the
  expectations need refreshing.
