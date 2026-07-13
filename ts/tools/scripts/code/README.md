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
  `--exceptions-file <path>` (deprecated JSON baseline exceptions keyed by `file:line`; prefer
  inline `// code-complexity-allow: <reason>` markers — see
  [Suppressing a known offender](#suppressing-a-known-offender)).
  For local CI-parity runs, use `npm run code-complexity:ci`.
- **code-deadcode:** `--config` (defaults to [`knip.jsonc`](./knip.jsonc)).

### Suppressing a known offender

Usually you don't need to. The complexity and lint ratchets are **stateless** —
they compare each changed file against its own merge-base version — so
pre-existing debt is grandfathered automatically (a function over budget on both
sides cancels out). You only need an explicit suppression for an edge case, e.g.
a file move that git's rename detection misses and that makes old debt look new.
Two mechanisms, in order of preference.

**Inline markers (preferred).** Put a comment next to the offending code; the
`--ratchet`/`--gate` step skips it, but the report still measures and shows it.
Because the marker is attached to the code it moves with it under reformatting
(unlike a `file:line`) and travels with the file when it's relocated. A
non-empty, non-placeholder **reason is required** — an invalid marker is ignored
and warned about, so it can't silently grandfather debt.

| Tool              | Marker                                         | Placement                                                                                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `code-complexity` | `// code-complexity-allow: <reason>`           | the function's declaration line, or a comment/decorator line directly above it                  |
| `code-lint`       | `// code-lint-allow <rule>[,<rule>]: <reason>` | trailing a line (applies to it) or standalone above it (next line); the **rule id is required** |
| `code-debt`       | `// code-debt-allow[(#issue)]: <reason>`       | above (or trailing) the focused/skipped test; an issue ref is expected for temporary skips      |

```ts
// code-complexity-allow: hand-written arg marshaller, inherently branchy
function buildArgs(/* … */) {
  /* … */
}

const raw = payload as any; // code-lint-allow no-explicit-any: third-party shape

// code-debt-allow(#1234): flaky on the CI windows runner, re-enable after fix
it.skip("uploads large files", () => {
  /* … */
});
```

**`--exceptions-file <path>` (deprecated).** The ratchet/gate tools also accept a
JSON file that grandfathers offenders by position. It remains the mechanism for
`code-circular` (a cycle spans files, so it has no single line to annotate);
`code-complexity`, `code-lint`, and `code-debt` still honor it as a fallback but
emit a deprecation notice — prefer inline markers there. Shape is
`{ "exceptions": [ ... ] }` (a bare array also works);
`--ratchet`/`--gate` honor it, report modes ignore it:

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

Four code-quality steps run in
[`build-ts.yml`](../../../../.github/workflows/build-ts.yml), **on pull requests
only**, sequenced after `Build` and before `Test`. They are skipped entirely
unless the PR touches `ts/**` or the workflow file itself (a `dorny/paths-filter`
guard), and — like the rest of the job — they run on every matrix cell
(`ubuntu`/`windows`/`macos` × Node 22/24).

Each step is a **changed-files diff against the PR's base branch**: it first
`git fetch --no-tags origin <base_ref>`, then passes `--base origin/<base_ref>`
so only what the PR actually touches is judged. Two flavors:

- **Ratchet** (`--ratchet`) — _stateless_: the base branch _is_ the baseline
  (there is no committed baseline file), so the metric can only trend down.
  Pre-existing debt is grandfathered; the PR simply may not add more in the code
  it edits. The tool measures each changed file at both HEAD and the merge base
  and fails only on a net increase, printing the offending `file:line`s.
- **Gate** (`--gate`) — _zero-tolerance_: the thing must be absent regardless of
  the baseline.

| #   | Step (tool)                                       | Type     | Fails the PR when it…                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Complexity ratchet** (`code-complexity`)        | ratchet  | leaves a changed file with more functions over the cyclomatic (25) or cognitive (30) budget than it had at the base; **any** function in a brand-new file over 25/30 also fails. Pre-existing offenders are grandfathered by the stateless HEAD-vs-base diff; a `// code-complexity-allow` marker covers the rare rename-miss. |
| 2   | **Lint ratchet** (`code-lint`)                    | ratchet  | adds net ESLint violations (`no-explicit-any`, `no-console`, `no-unused-vars`, `no-var`, `prefer-const`, `no-debugger`) in a changed file — syntactic rules only, so it's fast. `no-var`/`prefer-const` are effectively zero-tolerance (baseline is already 0).                                                                |
| 3   | **Circular dependency ratchet** (`code-circular`) | ratchet  | introduces a runtime import cycle absent at the base. A whole-graph property, so it builds the cycle set for HEAD **and** the merge base (checked into a throwaway git worktree) — madge runs twice, ~80s, the heaviest step.                                                                                                  |
| 4   | **Test debt gate** (`code-debt`)                  | **gate** | contains **any** focused test (`.only`/`.only.each`/`fit`/`fdescribe`), or newly skips a test (`.skip`/`.skip.each`/`xit`/`xdescribe`) in a changed file. TODO/FIXME/`@deprecated` are reported by this tool but not gated.                                                                                                    |

### Reproduce a gate locally

Run the same command against your base branch (usually `main`). Complexity has a
canned parity script; the rest just take `--base`:

```bash
npm run code-complexity:ci                          # == the CI step (--base origin/main)
npm run code-lint     -- --ratchet --base origin/main
npm run code-circular -- --ratchet --base origin/main
npm run code-debt     -- --gate    --base origin/main
```

`npm run lint` also runs the lint ratchet against `origin/main` as its final step.

### When a ratchet fires on debt you didn't add

A file move that git's rename detection misses can make pre-existing offenders
look "new." Grandfather them with an inline marker — see
[Suppressing a known offender](#suppressing-a-known-offender) — instead of
weakening the threshold.

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
