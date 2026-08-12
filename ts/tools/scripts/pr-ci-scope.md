# Faster PR pipelines — scope and measurements

PR-triggered `build-ts` / `build-package-shell` jobs keep the same required
status-check _names_ (the branch ruleset lists every OS × Node cell). This
change only skips expensive work on the `pull_request` event. `push`,
`merge_group`, and `main` still do the full matrix.

## What changed

- Shared decision helper: `ts/tools/scripts/prCiScope.mjs` (wired from both
  workflows). Tests: `pnpm run test:pr-ci-scope`.
- `build-ts` PRs: Node 24 cells report without install/build/test. Ratchets
  and the PR-base `git fetch` run once (ubuntu/22) instead of five fetches on
  every cell.
- `build-ts` PRs: non-ratchet cells use `fetch-depth: 1` instead of a full
  clone (~2700 commits).
- `build-package-shell` PRs: ubuntu still packages; macos/windows package on
  `push` / `merge_group` / `main`.
- `pipelines/azure-smoke-tests.yml` detect job: `fetchDepth: 2` (only HEAD
  and `HEAD^1` are needed on a PR merge commit).

## Job counts (from the shipped helper)

Run `node tools/scripts/prCiScope.mjs --table` from `ts/`:

| event                     | ts filter    | ts full | ts ratchet | shell package |
| ------------------------- | ------------ | ------- | ---------- | ------------- |
| pull_request (before)     | ts changed   | 6 / 6   | 6 / 6      | 3 / 3         |
| pull_request (after)      | ts changed   | 3 / 6   | 1 / 6      | 1 / 3         |
| pull_request (after)      | no ts change | 0 / 6   | 0 / 6      | 0 / 3         |
| merge_group / push / main | (ignored)    | 6 / 6   | 0 / 6      | 3 / 3         |

A TS-touching PR drops from **9 full install+build(+test/package) cells to 4**
(3 Node 22 `build_ts` + 1 ubuntu `build_package_shell`). The other 5 required
cells still start and succeed after checkout + path filter + scope.

## Timed local analog (this clone, file://)

Repo history at the branch tip: **2689** commits.

| analog                                      | wall  | `.git` size | commits |
| ------------------------------------------- | ----- | ----------- | ------- |
| `git clone --depth 1` (PR non-ratchet cell) | 2.15s | 60 MiB      | 1       |
| `git clone` (fetch-depth 0)                 | 2.90s | 132 MiB     | 2689    |
| 1× `git fetch` after clone                  | 0.03s | —           | —       |
| 5× `git fetch` after clone                  | 0.20s | —           | —       |

The local file:// clone understates GitHub-hosted checkout cost (network +
Actions cache). The size cut (132 MiB → 60 MiB) is what the 5 non-ratchet PR
cells no longer download.

## Historical CI cost of the skipped cells (microsoft/TypeAgent#2847)

Typical `ts/**` PR, 2026-08-12:

| job                                        | duration                           | now on `pull_request`   |
| ------------------------------------------ | ---------------------------------- | ----------------------- |
| `build_ts (ubuntu-latest, 22)`             | 14m 13s                            | still full              |
| `build_ts (ubuntu-latest, 24)`             | 12m 39s                            | skip install/build/test |
| `build_ts (macos-latest, 22)`              | 15m 52s                            | still full              |
| `build_ts (macos-latest, 24)`              | 22m 51s                            | skip install/build/test |
| `build_ts (windows-latest, 22)`            | 20m 38s                            | still full              |
| `build_ts (windows-latest, 24)`            | 17m 01s (queued behind windows 22) | skip install/build/test |
| `build_package_shell (ubuntu-latest, 22)`  | 8m 58s                             | still packages          |
| `build_package_shell (windows-latest, 22)` | 13m 02s                            | skip package            |
| `build_package_shell (macos-latest, 22)`   | 18m 38s                            | skip package            |

Runner-minutes avoided on a TS PR: ~52m (Node 24 `build_ts`) + ~32m
(macos/windows package) ≈ **84 minutes**. Wall clock on #2847 was gated by
Windows serialization + smoke tests (~40m); skipping `windows-24` removes
that extra Windows queue slot.

## Draft PR FYI

**A draft PR’s pipeline will not run until it is approved.** Azure DevOps PR
validation (`azure-smoke-tests.yml`, required check “TypeAgent Smoke Tests”)
and some GitHub Actions environment / required-workflow gates stay pending
until a reviewer or admin approves the run. Request `/azp run` (or the GitHub
Actions “Approve and run”) after opening the draft; do not treat an empty
check rollup as a YAML failure.
