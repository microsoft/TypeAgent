# Faster PR pipelines — scope and measurements

PR CI still **builds, tests, and packages on every required OS × Node cell**.
The cut is redundant work only: the same ratchet running six times, five
identical `git fetch`es of the base, and a full-history clone on cells that
only need `HEAD` to install/build/test.

## What changed

- Shared decision helper: `ts/tools/scripts/prCiScope.mjs`. Tests:
  `pnpm run test:pr-ci-scope`.
- `build-ts`: install/build/`test:local` (and Linux UI tests) still run on
  all 6 cells when `ts/**` changed — same as `main` today.
- `build-ts` PRs: ratchets + one `git fetch` of the base run once (ubuntu/22)
  instead of five fetches and four ratchet steps on every cell. The circular
  ratchet is the heavy one (madge twice).
- `build-ts` PRs: every cell uses `fetch-depth: 2` (merge commit + parents).
  Tests and ratchets do not need the other ~2700 commits. The base ref is
  fetched once with `--depth=1`.
- `build-package-shell`: unchanged merge gate — all 3 OS still package.
- `pipelines/azure-smoke-tests.yml`:
  - detect job: `fetchDepth: 2`
  - Smoke agents overlap Playwright **chromium** install with
    `fluid-build agent-shell|agent-cli --dep` (not full monorepo build,
    not every browser binary). `playwright.config.ts` only defines
    chromium; `shell:smoke` launches Electron.
  - `test:live` is a parallel Linux job with `continueOnError`. It runs
    on **main and merge-queue only** — not on PullRequest. A live failure
    never blocked the PR, but the parent GitHub check stayed queued until
    live finished (~13 min past Windows smoke on `7e4135eff`).
  - Windows always runs full `shell:test` (PR, main, merge-queue). Linux
    stays on `shell:smoke` (unchanged from before this work).

## Job counts (from the shipped helper)

Run `node tools/scripts/prCiScope.mjs --table` from `ts/`:

| event                     | ts filter    | ts full | ts ratchet | shell package |
| ------------------------- | ------------ | ------- | ---------- | ------------- |
| pull_request (before)     | ts changed   | 6 / 6   | 6 / 6      | 3 / 3         |
| pull_request (after)      | ts changed   | 6 / 6   | 1 / 6      | 3 / 3         |
| pull_request (after)      | no ts change | 0 / 6   | 0 / 6      | 0 / 3         |
| merge_group / push / main | (ignored)    | 6 / 6   | 0 / 6      | 3 / 3         |

## Required-check span (the 30% bar)

Span = last required check `completedAt` − first required check `startedAt`
on one SHA. Required names: `Repo Policy Check`, `build_dotnet (Debug|Release)`,
six `build_ts (os, 22|24)`, three `build_package_shell (os, 22)`,
`TypeAgent Smoke Tests`.

**Baseline — microsoft/TypeAgent#2847** (merged to `main`, SHA of that PR’s
merge; rollup from the PR checks API):

|                      |                                                        |
| -------------------- | ------------------------------------------------------ |
| First required start | `TypeAgent Smoke Tests` `2026-08-12T16:39:50Z`         |
| Last required finish | `build_ts (windows-latest, 24)` `2026-08-12T17:45:44Z` |
| **Baseline span**    | **3954 s (65.90 min)**                                 |
| **30% target**       | **≤ 2768 s (46.13 min)**                               |

Why #2847 is that long: `build_ts (windows-latest, 22)` waited 24.13 min for
a runner, then ran 20.63 min; `windows-24` waited until that finished
(started `17:28:43Z`, 17.02 min). Smoke itself was 39.48 min
(`16:39:50Z`–`17:19:19Z`) and was _not_ the last required check.

New span for this draft is filled in after a complete required rollup.
Do not treat a still-running rollup as the 30% win.

## Timed local analog (this clone, file://)

Repo history at the branch tip: **2689** commits.

| analog                                      | wall  | `.git` size | commits |
| ------------------------------------------- | ----- | ----------- | ------- |
| `git clone --depth 1` (PR non-ratchet cell) | 2.15s | 60 MiB      | 1       |
| `git clone` (fetch-depth 0)                 | 2.90s | 132 MiB     | 2689    |
| 1× `git fetch` after clone                  | 0.03s | —           | —       |
| 5× `git fetch` after clone                  | 0.20s | —           | —       |

On GitHub-hosted runners the 5 extra fetches and the full-history clone are
network-bound. The circular ratchet comment in `build-ts.yml` says madge
runs twice and is the heaviest gate — that now runs once per PR instead of
six times.

## Draft PR FYI

**A draft PR’s pipeline will not run until it is approved.** Azure DevOps PR
validation (`azure-smoke-tests.yml`, required check “TypeAgent Smoke Tests”)
and some GitHub Actions environment / required-workflow gates stay pending
until a reviewer or admin approves the run. Request `/azp run` (or the GitHub
Actions “Approve and run”) after opening the draft; do not treat an empty
check rollup as a YAML failure.
