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
- `build-ts` PRs: non-ratchet cells use `fetch-depth: 1` (tests do not need
  the other ~2700 commits).
- `build-package-shell`: unchanged merge gate — all 3 OS still package.
- `pipelines/azure-smoke-tests.yml` detect job: `fetchDepth: 2` (only HEAD
  and `HEAD^1` are needed on a PR merge commit). The smoke-test jobs still
  run when `ts/**` changed.

## Job counts (from the shipped helper)

Run `node tools/scripts/prCiScope.mjs --table` from `ts/`:

| event                     | ts filter    | ts full | ts ratchet | shell package |
| ------------------------- | ------------ | ------- | ---------- | ------------- |
| pull_request (before)     | ts changed   | 6 / 6   | 6 / 6      | 3 / 3         |
| pull_request (after)      | ts changed   | 6 / 6   | 1 / 6      | 3 / 3         |
| pull_request (after)      | no ts change | 0 / 6   | 0 / 6      | 0 / 3         |
| merge_group / push / main | (ignored)    | 6 / 6   | 0 / 6      | 3 / 3         |

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
