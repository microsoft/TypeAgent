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
| `azure-smoke-tests.yml`             | Required PR and merge-queue check. Existing CLI, shell, and optional live steps remain until the validated cutover.      |
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

## Independent live integration

`azure-live-tests.yml` provides the replacement for broad provider-backed tests
currently inside the required `TypeAgent Smoke Tests` check. That optional step
can time out for an hour before the required check completes. The staged
registration leaves smoke unchanged until the replacement is validated; only
the subsequent removal delivers the latency improvement. Independent live
failures fail their own pipeline. Required CLI and shell coverage is unchanged.

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
- Takes its own federated `AzureCLI@2` login, provisions keys inside that step,
  and fails if provisioning or tests fail. The live task retains a 60-minute
  limit; the complete job has a 90-minute limit.
- Removes generated `.env` and `config.local.yaml` on success, failure, or
  cancellation, with a five-minute cancellation cleanup budget.

### One-time registration and ordered rollout

Adding YAML does not create an Azure Pipelines definition. Before deploying the
removal of the live step from required smoke:

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
   The existing suite may expose teardown/authentication failures previously
   downgraded to warnings; triage them rather than restoring `continueOnError`.
5. After main activation and a successful main run, deploy the removal from
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

## GitHub build/test fan-out qualification

This is an opt-in qualification, not a replacement for required checks. It
exercises the full manual-run OS/Node matrix without Azure access or model keys.

From GitHub Actions, manually run **build-ts** on the candidate branch with
`fanout_experiment` checked, or use:

```powershell
gh workflow run build-ts.yml --repo microsoft/TypeAgent --ref <candidate-branch> -f fanout_experiment=true
```

The reusable `ci-fanout-experiment.yml` builds the memory-client dependency
closure first for each combination of Ubuntu, Windows and macOS with Node
22.23.4, 24.22.1 and 26.12.1. This includes the client's compiled view protocol
dynamically imported by memory-service tests. It fingerprints and uploads that
small runtime closure before incrementally building the rest of the workspace;
shared dependencies are reused, and unrelated application bundles are not
uploaded to memory-only consumers. Each producer also runs all non-memory package scripts
through the existing retry harness, the root script and memory-quality phases,
and Linux UI tests. Chained/non-Jest package phases remain intact. Platform-
independent formatting and lint run once in a separate blocking analysis job.

The `full-without-memory` test profile differs from `full` by exactly one pnpm
filter excluding `@typeagent/memory-service`; it is used only by qualification
producers. It does not change default local or required CI selections.

Each producer uploads compiled `dist` outputs and a manifest containing the exact source SHA, lockfile hash,
OS/architecture, Node/ABI, output hashes, and the complete Jest spec inventory.
Only manifest-listed files are staged into a new runner-temp directory before
upload, avoiding recursive artifact globs through workspace dependencies.
Dependencies and credential files are not uploaded.

Fresh test runners install their own native dependencies, restore only matching
outputs, verify the manifest, and run memory-service Jest specs without rebuilding.
Four file-level shards and an unsharded control consume the same per-OS/Node
artifact. All nine toolchain combinations must report, giving 45 memory-test
reports. Artifact and result names include Node versions to prevent collisions.
The experiment caps concurrent memory-test runners at twelve; controls
intentionally add qualification cost and are not proposed as permanent gating
jobs. The current matrix dependency waits for all producers, including their
remaining tests, before starting consumers. This is safe qualification scheduling,
not the final optimized production job graph.

The final qualification rejects missing, failed, cancelled or skipped analysis,
producer or consumer work,
mixed artifacts, missing/duplicate test files, and differences between control
and sharded assertion identities and outcomes. Parameterized test names must be
deterministic across runners; use fixed fixtures rather than clock-derived values.
The collector does not normalize away differing assertion names. Memory
shards/controls intentionally do not retry: qualification must expose initial
outcome differences. Existing retries are preserved for the remaining packages;
integrating memory retries into a production fan-out gate remains a rollout gate.
Its summary reports test-process timings only;
use job/step timings separately for build, dependency setup, artifact transfer,
queue delay, and runner cost. One run is functional qualification, not proof of
a 30-minute full merge gate or a statistically established speedup.

Normal PR, main, merge-group, scheduled, and default manual `build-ts` behavior
remains unchanged, including all supported Node versions and macOS coverage.
Compared with the first memory-only experiment, the candidate now runs the other
workspace phases and all supported toolchains as well. This is source-level
coverage wiring, not a claim that hosted equivalence or latency qualification has
passed. Do not enable it as a required gate until repeated clean hosted runs
validate selections, runtime closure, native dependencies, outcomes and complete
wall time, and memory retry/reporting semantics and required-check migration are
implemented. Keep the existing nine `build_ts` check names and macOS
compatibility/nightly policy during that migration.

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
