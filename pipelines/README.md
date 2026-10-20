# Azure DevOps Pipelines

This folder contains Azure DevOps pipelines for the TypeAgent repo.

## Pipeline inventory

### Consolidated build & publish

| Pipeline | Purpose |
| --- | --- |
| `azure-build-publish-all.yml` | **Primary pipeline.** Builds all TypeAgent artifacts in a single run and publishes them under a unified version to the Azure Artifacts Universal feed and Azure Blob Storage. Replaces the individual publish pipelines below. |

### Independent pipelines

| Pipeline | Purpose |
| --- | --- |
| `azure-smoke-tests.yml` | Required PR status check — runs unit tests, shell smoke tests, and live tests. |
| `azure-build-docker-container.yml` | Builds and pushes the TypeAgent Docker image to ACR (builds inside ACR). |
| `azure-docs-aggregation-signal.yml` | Documentation signal pipeline. |
| `component-detection.yml` | Security / compliance component detection scan. |

### Shared templates

| Template | Purpose |
| --- | --- |
| `include-prepare-repo.yml` | Checkout + npm registry auth + Node setup + pnpm install |
| `include-install-pnpm.yml` | corepack enable + pnpm store configuration |
| `include-update-package-version.yml` | Stamp prerelease version across all workspace packages |

## Packaging regression checks

From `ts`, run `node --test tools/scripts/test/optionalAgentInstallPolicy.spec.mjs tools/scripts/test/windowsInstallerTrust.spec.mjs`.
The optional-agent check verifies that the temporary pnpm workspace explicitly
disables `protobufjs` install scripts, matching the main workspace policy.
On Windows, the trust checks exercise certificate-byte conversion and cleanup
with a synthetic certificate and a mocked trust store; they do not modify
certificate stores or retrieve signing secrets. PowerShell 7 (`pwsh`) is required
for the synthetic-certificate check, matching the shell packaging pipeline.
The checks also enforce machine-level build trust, cleanup after success and
failure, preservation of pre-existing trust, and rejection of unpinned certificates.

### Windows shell signing hangs after certificate retrieval

Run `20261020.1` (build `139732`) stopped logging after writing the PFX and
was canceled about 41 minutes later. The previous build-trust helper added the
public certificate to `CurrentUser\Root`, which can display a native Windows
trust-confirmation dialog even under PowerShell `-NonInteractive`.
The log alone does not prove where it blocked, since there were no progress
messages between certificate retrieval and packaging.

Build and publication verification now temporarily trust only the policy-pinned
public certificate in `LocalMachine\Root`, avoiding the per-user dialog.
Both operations require an administrator Windows agent (as provided by
`windows-latest`); store-access failures fail the task rather than falling back
to interactive per-user trust. Existing matching trust is left unchanged, and
certificates added by the helper are removed in `finally`, including when the
package action fails. A forcibly terminated agent may not execute cleanup, so
use disposable agents for these jobs. End-user installer trust is unchanged.
Signing logs identify certificate retrieval, password retrieval, policy checking,
trust-store access, packaging, verification, and trust cleanup separately.

## Pipeline variables (configure in ADO UI)

The consolidated pipeline requires these variables to be set on the pipeline
definition (or in a linked variable group):

| Variable | Description |
| --- | --- |
| `INSTALL_REGISTRY` | npm registry URL for `pnpm install` (internal Azure Artifacts feed) |
| `PUBLISH_REGISTRY` | npm registry URL for `npm publish` (may be same feed, different view) |
| `azureSubscription` | Azure Resource Manager service connection (Workload Identity Federation) |
| `azureStorageAccountName` | Azure Blob Storage account for shell/MSI uploads |
| `azureStorageContainerName` | Container name within the storage account |

## Smoke tests on pull requests from forks

`azure-smoke-tests.yml` needs protected resources (an internal npm feed, the
`MSOCTO-ADO-Service-Connection`, and Key Vault) that Azure Pipelines withholds
from fork builds by default, so a fork PR fails at its first authenticated step
unless secrets are made available to forks. Because this pipeline is sourced
from a GitHub repo, there is no `pull_request_target` / `check-user-permission`
equivalent; the write-access gate is configured in the pipeline UI instead.

Configure it under **Edit pipeline → ⋮ → Triggers → Pull request validation**
(these settings are UI-only and cannot be set in YAML):

| Setting | Value | Why |
| --- | --- | --- |
| Forks → Build pull requests from forks of this repository | On | Let fork PRs trigger the pipeline. |
| Forks → Make secrets available to builds of forks | On | Fork builds otherwise can't reach the npm feed, service connection, or Key Vault. |
| Comment triggers → Require a team member's comment before building a pull request | Only for pull requests from non-team members | Nothing runs on a non-write-access contributor's fork PR until a team member (write or admin on the GitHub repo) comments `/azp run`. New commits require a fresh comment. |

The comment gate is the protection: it ensures the secrets-bearing run only
happens after someone with write access reviews and vouches for the fork code.
For defense in depth, optionally add an **Approvals & checks** gate on
`MSOCTO-ADO-Service-Connection`.
