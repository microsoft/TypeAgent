# Azure DevOps Pipelines

This folder contains Azure DevOps pipelines for the TypeAgent repo.

## Pipeline inventory

### Consolidated build & publish

| Pipeline                      | Purpose                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `azure-build-publish-all.yml` | **Primary pipeline.** Builds all TypeAgent artifacts in a single run and publishes them under a unified version to the Azure Artifacts Universal feed and Azure Blob Storage. Replaces the individual publish pipelines below. |

### Independent pipelines

| Pipeline                            | Purpose                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `azure-smoke-tests.yml`             | Required PR and merge-queue check. CLI and shell tests only; broad live integration runs independently.                  |
| `azure-live-tests.yml`              | Independent Linux live integration after relevant main changes, daily, and manually on main. Not a required merge check. |
| `azure-build-docker-container.yml`  | Builds and pushes the TypeAgent Docker image to ACR (builds inside ACR).                                                 |
| `azure-docs-aggregation-signal.yml` | Documentation signal pipeline.                                                                                           |
| `component-detection.yml`           | Security / compliance component detection scan.                                                                          |

### Shared templates

| Template                             | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `include-prepare-repo.yml`           | Checkout + npm registry auth + Node setup + pnpm install |
| `include-install-pnpm.yml`           | corepack enable + pnpm store configuration               |
| `include-update-package-version.yml` | Stamp prerelease version across all workspace packages   |

## Pipeline variables (configure in ADO UI)

The consolidated pipeline requires these variables to be set on the pipeline
definition (or in a linked variable group):

| Variable                    | Description                                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `INSTALL_REGISTRY`          | npm registry URL for `pnpm install` (internal Azure Artifacts feed)      |
| `PUBLISH_REGISTRY`          | npm registry URL for `npm publish` (may be same feed, different view)    |
| `azureSubscription`         | Azure Resource Manager service connection (Workload Identity Federation) |
| `azureStorageAccountName`   | Azure Blob Storage account for shell/MSI uploads                         |
| `azureStorageContainerName` | Container name within the storage account                                |

## Smoke tests on pull requests from forks

`azure-smoke-tests.yml` needs protected resources (an internal npm feed, the
`MSOCTO-ADO-Service-Connection`, and Key Vault) that Azure Pipelines withholds
from fork builds by default, so a fork PR fails at its first authenticated step
unless secrets are made available to forks. Because this pipeline is sourced
from a GitHub repo, there is no `pull_request_target` / `check-user-permission`
equivalent; the write-access gate is configured in the pipeline UI instead.

Configure it under **Edit pipeline → ⋮ → Triggers → Pull request validation**
(these settings are UI-only and cannot be set in YAML):

| Setting                                                                           | Value                                        | Why                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forks → Build pull requests from forks of this repository                         | On                                           | Let fork PRs trigger the pipeline.                                                                                                                                         |
| Forks → Make secrets available to builds of forks                                 | On                                           | Fork builds otherwise can't reach the npm feed, service connection, or Key Vault.                                                                                          |
| Comment triggers → Require a team member's comment before building a pull request | Only for pull requests from non-team members | Nothing runs on a non-write-access contributor's fork PR until a team member (write or admin on the GitHub repo) comments `/azp run`. New commits require a fresh comment. |

The comment gate is the protection: it ensures the secrets-bearing run only
happens after someone with write access reviews and vouches for the fork code.
For defense in depth, optionally add an **Approvals & checks** gate on
`MSOCTO-ADO-Service-Connection`.

## Smoke browser setup

Required ADO smoke installs only Chromium, matching the shell's Playwright
projects and Electron tests. Windows uses `playwright install chromium` without
`--with-deps`: Playwright's Windows dependency installer enables Media Foundation
on Server images, which these tests do not exercise. Linux retains
`playwright install --with-deps chromium` for its native browser prerequisites.
The full Windows shell suite, Linux smoke selection and CLI checks are unchanged.
Broad live integration and the manually dispatched GitHub smoke workflow retain
their existing browser prerequisites.

Validate on a fresh hosted agent before relying on the savings. Compare browser
installation, dependency installation, build, test and complete job durations
separately, and verify the full test inventory still passes. Browser setup savings
are not evidence of an equivalent reduction in total gate time.

## Independent live integration

`azure-live-tests.yml` runs broad provider-backed tests outside the required
`TypeAgent Smoke Tests` check. The moved live-test task retains
`continueOnError: true`, matching its previous advisory behavior in smoke.
Failures remain visible as issues in the independent run and can be investigated
separately. Dependency setup, build, key provisioning and cleanup remain blocking;
required CLI and shell coverage is unchanged.

Register it as **TypeAgent Live Tests**, separate from required PR and
merge-queue checks.

The live pipeline:

- Batches relevant pushes to `main` and runs daily at 09:43 UTC even when the
  source has not changed.
- Has no PR or merge-queue trigger and checks the source branch before starting
  the job. Do not configure UI trigger overrides that enable fork/PR builds.
- Skips non-main branches unless an authorized operator explicitly queues a
  manual branch run with `validateCandidate: true`. This permits validation
  before merging the new YAML; PR refs and automatic branch runs remain excluded.
- Reuses `include-prepare-repo.yml`, Node 24, Ubuntu 24.04, and the previous
  libsecret/Playwright prerequisites. It builds before running the same Linux
  `test:live` selection previously in smoke.
- Provisions keys in a separate blocking `AzureCLI@2` task before the advisory
  live-test task takes its own fresh federated login. The live task retains a
  60-minute limit; the complete job has a 90-minute limit. Only the live-test
  task has `continueOnError`; this does not suppress job cancellation or
  infrastructure failures.
- Removes generated `.env` and `config.local.yaml` on success, failure, or
  cancellation, with a five-minute cancellation cleanup budget.

### One-time registration and ordered rollout

Adding YAML does not create an Azure Pipelines definition. When provisioning
another project or restoring this configuration, validate the replacement
before deploying the smoke cutover:

1. Publish the new live entry point separately, keeping the old smoke live step.
   To validate before merge, register from the reviewed candidate branch without
   an initial run; queue that exact commit manually with `validateCandidate: true`.
   Do not interpret a skipped job or a YAML preview as successful execution.
2. Register a separate GitHub-backed pipeline named **TypeAgent Live Tests** with
   YAML path `pipelines/azure-live-tests.yml`, using the existing TypeAgent
   GitHub service connection. Use the candidate branch only during validation;
   switch the default to `refs/heads/main` after the new YAML lands there.
3. Configure `REGISTRY` and `azureSubscription` using the existing smoke
   pipeline's approved feed and federated service connection. Authorize only
   this pipeline for those resources; do not broaden access to all pipelines.
4. Choose a failure-notification owner/subscription and verify a main-branch run,
   including authentication, native dependencies, failure reporting, and cleanup.
   Existing live-test failures remain advisory; verify they are visible and
   track their investigation separately from setup or infrastructure failures.
5. After main activation and verified execution and cleanup, deploy the removal from
   required smoke. Preserve that pipeline's name,
   required check, PR/fork approval settings, and merge-queue triggers. Do not
   add **TypeAgent Live Tests** as a required PR/merge-queue check.

Roll back by restoring the old smoke live step and disabling the separate
pipeline's automatic triggers to avoid duplicate live executions. Separate
pipelines can still contend for organization-level agent capacity; monitor that
queue while validating the latency improvement.

Offline contract checks, from `ts/`:

```powershell
node --test tools\scripts\test\liveTestsPipeline.spec.mjs tools\scripts\test\smokeTestsAuthorization.spec.mjs
```

These checks do not authenticate, fetch keys, call models, or validate Azure
service-connection permissions. Azure-side validation and a real pipeline run
remain rollout requirements.

## GitHub sharded build/test CI

Sharded CI is the default for PRs, main pushes, merge queues and manual runs. It
exercises all supported OS/Node targets without Azure access or model keys.
Its test selections match normal gating: full Linux/Windows coverage and the
existing minimal macOS compatibility suites, not full macOS package tests.
The daily schedule retains the legacy macOS-only full-test matrix. Local test
defaults are unchanged. Documentation-only PRs keep their fast path; changes
to TypeScript or the sharded workflows/action require complete validation.

From GitHub Actions, manually run **build-ts** with its default inputs, or use:

```powershell
gh workflow run build-ts.yml --repo microsoft/TypeAgent --ref <candidate-branch>
```

The historical `fanout_experiment` input is retained for compatibility. Set it
to false on a manual dispatch to use the unsharded full-test matrix, still
restricted to Node 24 and 26.
The six `build_ts (OS, Node)` check names for Node 24 and 26 remain blocking: lightweight
compatibility jobs require the entire selected strategy to succeed, rejecting
failed, cancelled, skipped or missing coverage. Only a successful explicit
documentation-only path decision permits a no-op check. Remove only the three
Node 22 `build_ts (OS, 22.23.4)` required checks from the branch ruleset when
deploying this matrix change; retain all other required checks and rules.
PR formatting and all four ratchets run once in sharded analysis.

The reusable `ci-fanout-experiment.yml` calls `ci-fanout-target.yml` independently
for each combination of Ubuntu, Windows and macOS with Node
24.22.1 and 26.12.1. Node 22 is excluded from all CI matrices, including
scheduled and manual legacy runs; package engines and installer runtime
support are unchanged. Each target includes the client's compiled view protocol
dynamically imported by memory-service tests. It fingerprints and uploads that
small runtime closure and then finishes. It does not build the remaining
workspace or run non-memory tests, and does not depend on those jobs.
Unrelated application bundles are not uploaded to memory-only consumers.

Memory timeline and source-following fixtures poll background work until it
settles, with a 60-second deadline below Jest's 90-second test timeout. They
return immediately on completion and report the last state on timeout; failed
or cancelled ingestion still fails the test. This accommodates slow hosted
filesystem work without fixed sleeps, retries or reduced coverage.

Within each target, an independent `workspace_build` job builds the workspace once
and publishes a fingerprinted compiled-output artifact and partition plan.
`remainder`, `package_partitions` and `roots` jobs consume matching outputs without rebuilding;
they never gate the memory consumers. The full workspace payload intentionally
trades transfer/storage for avoiding repeated builds: the validated local payload
was 614 MiB across 15,128 files. Its new hosted transfer and verification costs
must be measured, not assumed free or equivalent to the small memory artifact.

Linux/Windows remainder jobs exclude memory service, dispatcher and default agent
provider. Dispatcher/provider files run in four duration-balanced groups per
OS/Node, only on Linux/Windows. macOS remainder jobs retain exactly the eight
non-memory compatibility suites; no full dispatcher/provider partitions run there.
The 77 remaining Linux/Windows packages use four deterministic, duration-balanced
whole-package lanes per target, with the original package concurrency of three
inside each lane. The canonical macOS compatibility selection uses one lane.
Remainder jobs use the existing retry harness. Root script and memory-quality
tests run independently of package tests on every target; their subphase timings
are reported separately while retaining the original short-circuit failure policy.
Linux UI tests follow the root phases, reusing that consumer's setup and artifact.
Chained/non-Jest package phases
remain intact. Platform-independent formatting and lint run once in a separate
blocking analysis job.

CI orchestration uses `pnpm run ci:node tools/scripts/<script>.mjs ...`.
This supplies pnpm's JavaScript CLI through `npm_execpath`, letting nested
workspace discovery and partition tests invoke Node directly without a command
shell on any platform. Bare `node` or `pnpm exec node` does not supply that
package-script context and is not supported for these orchestration commands.
The dependency-free qualification job sets
`pnpm_config_verify_deps_before_run=false` so pnpm 11 does not implicitly install
the entire workspace before reading reports. Producers and test consumers retain
their normal dependency installation and verification.

The `full-without-memory` test profile differs from `full` by exactly one pnpm
filter excluding `@typeagent/memory-service`; it is used only by qualification
legacy memory-only remainders. The new `fanout-remainder` profile additionally
excludes exactly `agent-dispatcher` and `default-agent-provider`, which must pass
their separate partitions. On macOS, `macos-compat-without-memory` reuses the
existing compatibility list minus its five memory-service suites. Those five
suites are selected explicitly for both memory discovery and shard/control
execution; the full memory-service inventory is used only on Linux/Windows.
The remainder and memory selections together equal the existing 13-suite macOS
compatibility selection. Missing compiled compatibility suites fail explicitly.
Local selections are unchanged. Scheduled runs and explicit manual legacy
rollbacks retain full macOS testing; ordinary sharded CI keeps minimal macOS coverage.

Each producer uploads compiled `dist` outputs and a manifest containing the exact source SHA, lockfile hash,
OS/architecture, Node/ABI, output hashes, and the complete selected Jest spec inventory.
Only manifest-listed files are staged into a new runner-temp directory before
upload, avoiding recursive artifact globs through workspace dependencies.
Dependencies and credential files are not uploaded.

Fresh test runners install their own native dependencies, restore only matching
outputs, verify the manifest, and run memory-service Jest specs without rebuilding.
Four file-level shards consume the same per-OS/Node artifact. All six toolchain
combinations must report, giving 24 memory-test reports. Artifact and result
names include Node versions to prevent collisions. Actual organization/OS
runner capacity can still queue jobs. Duplicate unsharded controls are disabled
by default; set `fanout_include_controls=true` for a manual equivalence experiment,
which requires 30 reports. The redundant `fanout_node_set` / reusable `node_set`
workflow inputs have been removed: all dispatches qualify Node 24 and 26.
Offline collectors still accept the historical `24-and-26` selection alias,
which now has the same coverage as `all`; neither accepts Node 22 reports.
Each memory group waits only for its matching target's memory producer.
Likewise, workspace consumers wait only for their matching workspace producer:
there are no cross-OS/Node producer barriers. A failed target blocks final
qualification without skipping successful targets' independent measurements.
Default full-scope validation has 85 executable jobs, including path selection
and six compatibility checks. Runner capacity and repeated native installations
must be measured rather than assuming unlimited parallelism.

Runner-local dependency installation retries visibly up to three times, with
bounded backoff and forced reimport/rebuild after a failed attempt. Frozen
lockfiles, strict peers and the repository's native install-script policy remain
in force. Exhaustion fails the job; installation failures are not suppressed.

Dispatcher/provider groups use a deterministic longest-processing-time-first
plan seeded from hosted per-file Linux/Windows timings. Missing timing entries
are explicitly reported and weighted by the observed package median, not treated
as measured zero-cost tests. Plans cover each discovered eligible file exactly
once, preserve the provider's existing ignored suite, and fail if package script
or lifecycle assumptions change. Consumers check the restored inventory against
fresh discovery. Failed files get up to two serial, fresh-process, no-cache
retries; all attempt JSON and new per-file timings are uploaded. Retry-only
successes remain visible. Qualification requires all 32 package reports in
addition to the 24 memory reports (30 with controls), 18 exact remainder reports and successful
analysis, build, root and Linux UI jobs. Remainder reports preserve full script
inventories, selected packages, artifact fingerprints and producer provenance.

Refresh the seed from hosted logs or downloaded `.partition.json` reports:

```powershell
pnpm run ci:node tools\scripts\ciPackagePartitions.mjs profile <source-run-id> <windows-log> <linux-log>
pnpm run ci:node tools\scripts\ciWorkspaceLanes.mjs profile <source-run-id> <first-pass-windows-log> <first-pass-linux-log>
```

Local Windows/Node 24 execution discovered 147 dispatcher and 61 provider files.
All four combined groups passed on their first attempt: 6,277 assertions passed
and 371 were reported pending/skipped under the existing test conditions.
Combined package execution took 92.0-112.4 seconds per group, excluding build,
consumer setup, artifact verification and discovery. These local measurements
are not hosted CI wall-clock evidence. Both checked-in profiles now use hosted
run 42129894103: all 208 dispatcher/provider files and all 77 remaining packages.
First-pass and retry timings must be profiled separately.

### Optional build and artifact experiments

The manual fan-out dispatch also accepts:

- `fanout_build_cache=true` (default false): coherent `dist` outputs and
  incremental metadata keyed to the exact source SHA, lockfile, package manager,
  OS/architecture, Node/ABI and hosted runner image version. Compiler, generator
  and .NET inputs are pinned by the source/lockfile and stock runner-image keys.
  There are no cross-commit prefix restores. A hit is integrity-checked before
  restoration, and the normal full build still runs. Missing/corrupt caches fail
  explicitly. Native dependencies, broker binaries outside `dist`, credentials
  and fluid-build completion receipts are not cached. This conservative prototype
  helps same-commit reruns, not the first cold build of a new commit.
- `fanout_native_cache=true` (default false): runtime/image-specific pnpm
  side-effect reuse, with real Node and Electron SQLite write/read probes.
  Exactly one producer saves each key. Failed installation or runtime probes
  trigger visible bounded uncached reimport; exhaustion fails the job. Hosted
  trials eliminated Windows/Linux source rebuilds but have not established a
  successful net workflow speedup, so this is not enabled by default.
- `fanout_compact_artifact=true` (default false): separate dispatcher/provider
  and whole-package remainder payloads derived from each consumer's complete
  transitive workspace dependency inventory, including test and optional
  dependencies and built-in agents. The node-provider test agent loaded by
  relative path is included explicitly. Generated assets and source maps remain;
  dispatcher/provider payloads omit incremental metadata, while remainder lanes
  retain it because whole-package tests can invoke the compiler.
  Root and UI consumers retain the full artifact until their smaller closures
  are independently qualified. Consumer scope, exact inventory, script selection,
  SHA/OS/Node/ABI/lockfile and hashes remain blocking checks.
  Workspace discovery compares canonical filesystem paths so temp-directory
  aliases and Windows junctions do not invalidate those containment checks.
- `fanout_artifact_compression=0|3|6` (default 6): controlled compression A/B
  measurements. Compare producer upload plus consumer extraction/verification,
  not archive bytes alone.

These options remain opt-in for manual experiments; default sharded CI leaves
build caching, native side-effect reuse and compact artifacts disabled.
More consumers can increase total transfer volume even when individual payloads
shrink. Neither caching nor compact artifacts are promoted without hosted
matrix qualification and measured critical-path/cost results.

Local Windows/Node 24 candidate validation passed all 208 dispatcher/provider
specs and all 77 remaining packages from clean scoped restores. The compact
dispatcher/provider payload is 155.15 MiB versus 614.19 MiB for the full local
workspace; the 150 MiB investigation target remains unmet. Remainder dependency
closures vary substantially and are not all comparably small. Coherent cache
restoration followed by the normal full build passed, including native broker
publication. The complete root phases passed (511 unit tests, five existing
skips, then 282 memory-quality tests). These are functional local results,
not hosted cold-build, Linux/macOS/UI or end-to-end latency qualification.

The final qualification rejects missing, failed, cancelled or skipped analysis,
producer or consumer work,
mixed artifacts, missing/duplicate test files, and differences between control
and sharded assertion identities and outcomes. Parameterized test names must be
deterministic across runners; use fixed fixtures rather than clock-derived values.
The collector does not normalize away differing assertion names. Memory
shards/controls intentionally do not retry: validation must expose initial
outcome differences. Existing retries are preserved for the remaining packages;
memory failures remain blocking rather than being hidden by automatic reruns.
Its summary reports test-process timings only;
use job/step timings separately for build, dependency setup, artifact transfer,
queue delay, and runner cost. One run is functional qualification, not proof of
a 30-minute full merge gate or a statistically established speedup.

### Measured duration and next targets

The successful Node 24/26 shard-only baseline completed in 18m09s
([run 42272195529](https://github.com/microsoft/TypeAgent/actions/runs/42272195529)).
An opt-in native-cache cold-population run passed in 20m34s; the populated-key
17m55s follow-up failed memory tests and is not a qualified speedup.
These historical six-target experiments do not qualify the current production
graph or the separately required Azure/.NET checks.
The first nine-target [PR run 42297124484](https://github.com/microsoft/TypeAgent/actions/runs/42297124484)
took 23m52s and failed two Node 22 memory cases and two Windows installer
fixtures. Qualification and all nine compatibility checks correctly failed.
The repaired [nine-target run 42303655771](https://github.com/microsoft/TypeAgent/actions/runs/42303655771)
passed in 21m01s with independently qualified 36 memory, 48 partition and 27 lane
reports. Its [20m29s repeat](https://github.com/microsoft/TypeAgent/actions/runs/42307785264)
failed on remaining restart-head and paused-draft fixture races. These are not
repeated successful latency samples.

Consolidation fixtures now wait for runnable queued maintenance as well as
running work before and after reading inventories, preserving deferred, failed,
paused and manual work semantics. Paused draft edits refresh their inventory
and cloned content on bounded optimistic-head conflicts; other errors and
exhaustion propagate. Deterministic regressions preserve restart-head assertions,
original content and maintenance-release behavior. The final candidate requires
its own complete hosted qualification.

That diagnostic run's critical Windows/Node 22 workspace producer spent 183s in
setup, 544s building and 62s in post-setup cache work. The final remainder
consumer spent another 171s in setup and 317s in its test step. The memory
MCP-server package accounted for 228.396s of first-pass process time in that
lane. Profile its file-level distribution before further partitioning; adding
whole-package lanes cannot subdivide that package.

The immediate target is approximately twenty-minute TypeScript validation, with
fifteen minutes as the next iteration. Prioritize producer compilation, repeated
consumer setup and root/remainder tails before adding more runner nodes: more
test shards do not shorten those serial stages. Historical cold builds alone
took 2.27-7.72 minutes. Same-commit cache hits cannot establish new-commit
cold-build performance, and additional runners can increase total CI cost.

A ten-minute gate needs a measured budget such as at most one minute of
queue/setup, three minutes building, five minutes in the slowest parallel test
lane (including consumer setup/transfer), and one minute aggregating/finishing.
That requires faster or safely cached builds, measured runtime-closure transfer,
enough runner concurrency, further remainder/root-test optimization as measured,
and keeping comparison controls out of normal gating after qualification.
All-required-check latency also depends on completing the separately gated
Azure live-test cutover; shortening this workflow alone does not establish a
ten-minute complete CI gate.

No tests are moved out of required validation by this rollout.

### Measuring complete CI duration

From `ts/`, collect read-only timing evidence for explicit comparable run IDs:

```powershell
node tools\scripts\ciDurationReport.mjs --repo microsoft/TypeAgent --run <baseline-run-id> --run <candidate-run-id> > ci-duration-report.json
```

The command requires authenticated `gh` access. It reads active default-branch
required-check rules, paginates GitHub jobs/checks/statuses, and includes every
attempt of each selected workflow run. Reports distinguish latest-attempt wall
time, elapsed time since the first attempt, summed GitHub runner execution, and
the observed span until all required checks finish. Azure-backed GitHub checks
contribute to the required-check span, but not GitHub runner cost.

Missing, queued or running required checks leave the all-required duration
unknown, not green. Failed and cancelled runs remain in the output and outcome
counts; successful-duration distributions are explicitly labeled. p50 uses the
median and p95 uses nearest rank. Individual job/step timings remain available
for attribution. Queue delay and in-process test-retry time are not inferred.

Rules and latest check results are sampled at reporting time, so this is not a
historical reconstruction of branch protection. In particular, main pushes may
lack PR-only required checks; use comparable PR/merge-group runs for gate
comparisons. Verify source/coverage equivalence separately and retain reports
outside source control. A small successful sample is not a p95 performance claim.
