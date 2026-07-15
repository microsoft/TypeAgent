# docs-autogen — Pipeline Setup Guide

> **Important — current implementation (supersedes this guide's Azure/GitHub-App steps).**
> The shipped pipeline is a single **GitHub Actions** workflow,
> [`.github/workflows/docs-generate.yml`](https://github.com/microsoft/TypeAgent/blob/main/.github/workflows/docs-generate.yml),
> running **daily** (`cron`) plus manual `workflow_dispatch`. It requires
> **no federated credentials and no stored secrets**, so most of the
> provisioning below (creating a new GitHub App, Azure OpenAI / Key Vault /
> WIF wiring, the `docs-bot/last-run` watermark) **does not apply**.
>
> What it actually needs — all already present on `microsoft/TypeAgent`:
>
> | Need            | How it's satisfied                                                                                                                                                                                                                                      |
> | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | LLM authoring   | **GitHub Models** via `permissions: models: read` + the job's `GITHUB_TOKEN`. aiclient is pointed at it with `OPENAI_ENDPOINT=https://models.github.ai/inference/chat/completions`, `OPENAI_API_KEY=${{ github.token }}`, `OPENAI_MODEL=openai/gpt-4o`. |
> | PR identity     | The **existing TypeAgent-Bot** GitHub App — reuses `vars.DEPENDABOT_APP_ID` and `secrets.DEPENDABOT_APP_PRIVATE_KEY` already configured for `fix-dependabot-alerts.yml`. No new App or secret.                                                          |
> | Branch push     | Native `GITHUB_TOKEN` (`contents: write`). Pushing is not gated by the org "Actions can't create PRs" policy.                                                                                                                                           |
> | Change baseline | The last `README.AUTOGEN.md` commit on the branch (computed in-workflow). No watermark tag to seed or advance.                                                                                                                                          |
>
> **Validated (no action needed):** the `microsoft` tenant grants the
> Actions `GITHUB_TOKEN` (with `models: read`) enterprise-grade GitHub
> Models limits — tens of thousands of requests per 10s and 10M tokens/min —
> so even a full ~100-package regeneration runs comfortably within quota.
> There is **no per-run package cap**; selection stays change-scoped via the
> `--since` baseline, and a hard CI gate refuses to open a PR if anything
> other than `README.AUTOGEN.md` files changed.
>
> The step-by-step provisioning below documents the earlier Azure-DevOps /
> GitHub-App design and is kept for historical context only.

This guide walks an operator through provisioning the
[`docs-generate`](https://github.com/microsoft/TypeAgent/blob/main/.github/workflows/docs-generate.yml) GitHub
Action that regenerates `README.AUTOGEN.md` companion files on
demand.

For the _why_ — architecture, format spec, and design rationale — see
[`doc-autogen.md`](./doc-autogen.md). For the local CLI and operations
runbook see
[`ts/tools/docsAutogen/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/tools/docsAutogen/README.md).

## Prerequisites

Before starting, confirm:

- You have **Owner** or **Admin** access to the target GitHub
  repository (needed to install the GitHub App, set Actions secrets
  and variables, and grant `contents: write` / `pull-requests: write`
  permissions).
- You have access to an **Azure OpenAI** resource with at least one
  chat deployment provisioned. The pipeline currently calls the
  default model exposed by `@typeagent/aiclient`; a deployment of
  `gpt-4o` (or an equivalent reasoning model) is sufficient.
- You have permission to create a **GitHub App** in the same
  organization (or in your personal account if running against a
  personal fork). Installing the App into the target repo also
  requires Owner/Admin on that repo.

Estimated time to complete: 20–30 minutes for a first-time install
once the prerequisites are in place.

## Pipeline overview (one-paragraph version)

An optional `workflow_dispatch`-only workflow (no schedule) that, when
manually triggered, diffs `ts/packages/**` against a watermark git tag
(`docs-bot/last-run`) or an operator-supplied `since` ref, regenerates
`README.AUTOGEN.md` for every changed package, validates each link
resolves on disk, opens a single batched PR via a dedicated GitHub
App, and closes any previously-open bot PRs so only one is live at a
time. The job runs inside the `development-fork` GitHub environment so
it can reuse the same Entra federated credential the smoke-tests and
build-docker workflows already trust. The hand-written `README.md` is
never modified — `docs-autogen` writes to a parallel
`README.AUTOGEN.md` file only.

## Step 1 — Create the docs-bot GitHub App

The pipeline pushes a branch and opens a PR using a dedicated GitHub
App rather than `GITHUB_TOKEN`, so reviews and `CODEOWNERS` rules
treat the PR as authored by an external bot identity (and the App's
permissions can be scoped down to exactly what's needed).

1. In the GitHub UI, navigate to **Settings → Developer settings →
   GitHub Apps → New GitHub App** (organization-level if applicable;
   user-level works for forks).
2. Fill in:
   - **Name:** something recognisable, e.g. `<org>-docs-bot`.
   - **Homepage URL:** any valid URL (the App is not a web service).
   - **Webhook:** uncheck **Active**. The App is invoked from
     Actions, not via webhooks.
3. **Repository permissions** (set the rest to "No access"):
   - **Contents:** **Read & write** — needed to push the PR branch
     and (optionally, when an operator advances the watermark by
     hand) force-update the `docs-bot/last-run` tag.
   - **Pull requests:** **Read & write** — needed to open the PR
     and close superseded ones.
   - **Metadata:** **Read-only** (auto-required).
4. **Where can this GitHub App be installed?** "Only on this account"
   is fine — there is no reason to expose it more broadly.
5. **Create GitHub App.** On the post-create page:
   - Note the **App ID** (you'll need this as a workflow variable).
   - Click **Generate a private key** and download the `.pem` file.
     Store it somewhere safe — you'll paste it into a repository
     secret in Step 3 and there is no second download.
6. From the App's left nav choose **Install App → Install** and pick
   the target repository. **Only select repositories →
   `<your-repo>`** is the safest choice; do not grant the App access
   to anything it does not need to update.

> **Why a GitHub App and not `GITHUB_TOKEN`?** Actions invoked by
> `GITHUB_TOKEN` do not trigger downstream workflows on PRs they
> open. That would prevent CI from running on the generated docs PR.
> Using a dedicated App identity sidesteps that limitation, gives
> the PRs a clearly attributed author, and lets you revoke App
> credentials independently of any human PAT.

## Step 2 — Azure OpenAI access (reuses existing build-pipeline credential)

The AI-authored portion of each `README.AUTOGEN.md` is generated via
[`@typeagent/aiclient`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/aiclient/README.md), which
reads its endpoint + key from `ts/config.local.yaml` (loaded by
[`@typeagent/config`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/config/README.md)).

For CI, this workflow piggy-backs on the **existing federated
credential** that `smoke-tests.yml` already uses. The auth chain is:

> GitHub OIDC token → existing Entra App registration → Key Vault
> `build-pipeline-kv` → consolidated `typeagent-config` secret →
> `ts/config.local.yaml` → `aiclient` reads endpoint + key normally.

No new Azure resource, no new RBAC, no new secret to configure.
Concretely, the workflow:

1. Calls `azure/login@v2.2.0` with the existing repo secrets
   `AZUREAPPSERVICE_CLIENTID_*`, `AZUREAPPSERVICE_TENANTID_*`,
   `AZUREAPPSERVICE_SUBSCRIPTIONID_*` (auto-created when the build
   pipeline was first wired through the Azure portal). This performs
   the OIDC handshake and exports the standard Azure env vars.
2. Runs `node tools/scripts/getKeys.mjs --vault build-pipeline-kv --commit`,
   which uses `DefaultAzureCredential` to read the `typeagent-config`
   secret from `build-pipeline-kv` and writes it as
   `ts/config.local.yaml`.
3. Subsequent `pnpm` invocations (the regen step) read the YAML
   transparently — same code path that runs on a developer machine.

If your fork or organization does **not** already have those
secrets, you have two options:

- **Mirror the build pipeline:** in the Azure portal, configure
  GitHub Actions OIDC trust on an Entra App, and grant it Key Vault
  read access on the vault you want to source secrets from. Then
  copy `smoke-tests.yml`'s `Login to Azure` + `Get Keys` step
  pattern (and update `--vault` to your vault name).
- **API-key fallback:** drop the OIDC + Key Vault steps entirely
  and add a literal `AZURE_OPENAI_API_KEY` secret. See the
  [API-key fallback](#api-key-fallback-non-microsoft-installs)
  subsection below for the exact workflow edits.

### Local validation (optional)

To smoke-test from a developer machine, populate
`ts/config.local.yaml` either by running `getKeys.mjs` against the
same vault (requires you to be `az login`-ed with Key Vault read
permission) or by hand-editing per `ts/config.sample.yaml`:

```powershell
cd ts
az login --tenant <your-tenant-id>
node tools/scripts/getKeys.mjs --vault build-pipeline-kv --commit

pnpm install
pnpm --filter aiclient build
pnpm --filter @typeagent/docs-autogen build

# Single-package smoke test against the real LLM. Pick a small package.
node tools/docsAutogen/bin/docs-autogen.cjs `
  --package timer --render --write --llm
```

If the smoke test produces a sensible
`ts/packages/agents/timer/README.AUTOGEN.md`, the auth chain works
end-to-end.

### API-key fallback (non-Microsoft installs)

If you do not have a Microsoft tenant or cannot register an Entra
App — e.g., a personal fork or an external organization — set
`AZURE_OPENAI_API_KEY` to the actual key value as a repo secret
and edit the workflow:

- Remove the `Azure login (federated)` step.
- Remove the `Pull config from Key Vault` step.
- Drop the `id-token: write` permission.
- Add an `env:` block to the regen step exposing
  `AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}` and
  `AZURE_OPENAI_API_KEY: ${{ secrets.AZURE_OPENAI_API_KEY }}`.

`aiclient` reads those env vars when no `config.local.yaml` is
present.

## Step 3 — Configure repository secrets and variables

In the target repository, navigate to **Settings → Secrets and
variables → Actions** and add the following entries.

### Variables (Repository **variables** tab)

| Name              | Value                                      |
| ----------------- | ------------------------------------------ |
| `DOCS_BOT_APP_ID` | Numeric App ID from Step 1 (e.g. `123456`) |

### Secrets (Repository **secrets** tab or the `development-fork` **environment**)

The `docs-generate` job is bound to the `development-fork` GitHub
environment (the same environment used by `smoke-tests.yml`). The
three `AZUREAPPSERVICE_*` secrets listed below are
**environment-scoped** to `development-fork` —
that's what scopes the Entra federated-credential subject claim to
`repo:<org>/<repo>:environment:development-fork`, matching the
subject the build-pipeline App registration is already configured to
trust. If you provision new secrets, decide whether to put them at
the repository level (visible to every workflow) or at the
`development-fork` environment level (visible only to jobs that
declare `environment: development-fork`); the App private key works
equally well in either scope.

| Name                                                              | Value                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DOCS_BOT_APP_PRIVATE_KEY`                                        | Full contents of the `.pem` file from Step 1, including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines |
| `AZUREAPPSERVICE_CLIENTID_5B0D2D6BA40F4710B45721D2112356DD`       | **Already present** in the `development-fork` environment — created when the build pipeline was wired                         |
| `AZUREAPPSERVICE_TENANTID_39BB903136F14B6EAD8F53A8AB78E3AA`       | **Already present** — same source                                                                                             |
| `AZUREAPPSERVICE_SUBSCRIPTIONID_F36C1F2C4B2C49CA8DD5C52FAB98FA30` | **Already present** — same source                                                                                             |

When pasting the GitHub App private key, preserve newlines exactly —
GitHub strips trailing whitespace but newlines inside the field are
kept.

> The three `AZUREAPPSERVICE_*` secrets only need provisioning if
> this is a fresh fork without the existing build-pipeline wiring.
> On `microsoft/TypeAgent` they are already configured. If you fell
> back to the API-key path, add `AZURE_OPENAI_ENDPOINT` and
> `AZURE_OPENAI_API_KEY` here instead.

## Step 4 — Enable Actions to write to the repo

The workflow itself declares the `contents: write` and
`pull-requests: write` permissions it needs, but org-level policy
can still block them. Confirm:

1. **Settings → Actions → General → Workflow permissions.** Either
   - **Read and write permissions** (simplest), or
   - **Read repository contents permission**, with **Allow GitHub
     Actions to create and approve pull requests** explicitly
     enabled.
2. **Settings → Actions → General → Fork pull request workflows.**
   Leave at the default; the workflow only runs from the default
   branch via manual `workflow_dispatch`, never from forks.

If the repo lives inside an organization, the same toggles must also
be on at the **org level** (Org settings → Actions → General).
Otherwise the per-repo setting is ignored.

## Step 5 — Set the initial watermark (optional but recommended)

`docs-autogen` diffs against a lightweight git tag
(`docs-bot/last-run`) to decide which packages have changed since
the baseline commit. On the very first run no tag exists, and the
tool falls back to "regenerate everything" — for a repo with
~100 packages that's a 100-package PR.

To keep the first PR small, push the tag at the current HEAD before
the first dispatch:

```bash
git fetch origin
git tag -f docs-bot/last-run origin/main
git push origin docs-bot/last-run
```

The first dispatch (with `since` left blank) will then see no changes
and skip silently. Subsequent dispatches only touch packages whose
source files changed after that tag. The workflow does **not**
auto-advance the tag — operators move it forward by hand when they
want the next diff window to start from a newer baseline:

```bash
git tag -f docs-bot/last-run <sha-of-most-recently-regenerated-commit>
git push origin docs-bot/last-run --force
```

## Step 6 — First manual run

Validate end-to-end before relying on the workflow:

1. **Actions → docs-generate → Run workflow.**
2. Pick a small input to bound the blast radius:
   - **dry-run:** ✅ — analyse and render only, do not write or open
     a PR.
   - **packages:** a comma-separated list of one or two known
     packages, e.g. `timer-agent,list-agent`.
   - **llm:** ✅ — exercises the real Azure OpenAI call.
   - **max-packages:** `5`.
3. Click **Run workflow** and watch the job. Confirm:
   - The **Generate GitHub App token** step succeeds (App
     credentials valid).
   - The **Regenerate package README.AUTOGEN.md files** step prints
     per-package `verdict=…` lines and the LLM mode is logged.
   - The **Job summary** at the bottom of the run shows the
     truncated CLI log.

If anything fails, see [Troubleshooting](#troubleshooting) below.
Once the dry-run is clean, repeat without the `dry-run` checkbox and
with a single safe package to verify the PR open / supersede /
close-previous flow.

## Step 7 — Operate on demand

With Steps 1–6 complete, no further wiring is required. The pipeline
is **opt-in** — there is no cron and nothing happens until an
operator clicks **Run workflow**. When triggered, the workflow will:

1. Diff `ts/packages/**` against the supplied `since` ref (or the
   `docs-bot/last-run` watermark tag if `since` is left blank).
2. Regenerate the changed packages' `README.AUTOGEN.md` files.
3. Open a single PR titled
   `docs: regenerate package README.AUTOGEN.md files (YYYY-MM-DD)`
   on a branch like `automated/docs-readmes-YYYYMMDD-<run>`.
4. Close any prior open bot PR on a similar branch, with a
   "superseded" comment, and delete the prior branch.

Operators advance the `docs-bot/last-run` tag by hand when they want
the next dispatch's default diff window to start later — the
workflow itself never moves the tag.

Review checklist for each PR is included in the auto-generated PR
body; the most important assertion is that no hand-written
`README.md` has been modified.

## Troubleshooting

### "Generate GitHub App token" step fails with 401 / 404

- Confirm `DOCS_BOT_APP_ID` is the numeric App ID (not the App name).
- Confirm `DOCS_BOT_APP_PRIVATE_KEY` contains the full
  `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----` block
  with original newlines.
- Confirm the App is **installed** on the target repo
  (App → Install App → check the target repo is listed).

### Workflow runs but never opens a PR

- Inspect the **Detect changes** step. If it prints
  `No README.AUTOGEN.md changes after regeneration`, every package
  either was up-to-date or hit the "footer-only" diff guard. This is
  the correct behaviour when nothing has materially changed since
  the watermark.
- For a forced refresh, dispatch manually with
  `since: main~50` (or any older ref) to diff against an older
  point.

### "Resource not accessible by integration" when opening the PR

- The App's **Pull requests** permission is missing or set to
  read-only. Re-edit the App, set it to **Read & write**, then go
  to App → Install App → choose the repo → **Configure** and accept
  the new permission scope. GitHub does not auto-grant new
  permissions to existing installations.

### "Validate dispatch inputs" rejects a manual dispatch

The workflow allow-lists characters in `packages` / `since` /
`max-packages` inputs to block shell-metachar injection. Stick to
the patterns:

- `packages`: comma-separated package names matching
  `[A-Za-z0-9@/_.,-]+`.
- `since`: a git ref matching `[A-Za-z0-9._/-]+`.
- `max-packages`: digits only.

### LLM run completes but generated docs look like placeholders

The placeholder body fires when the LLM call short-circuits (no
endpoint, auth failure, or `--llm` not set). Walk down the list:

- **Federated login:** confirm the `Azure login (federated)` step
  reports `Login successful`. If it fails with
  `AADSTS70021: No matching federated identity record found`, the
  subject the runner is presenting does not match the FIC
  registered on the Entra App. (This is the same App that
  smoke-tests uses, so if smoke-tests passes the FIC is fine —
  most often the subject mismatch means you're running on a branch
  the FIC subject claim doesn't cover.)
- **Key Vault read:** confirm the `Pull config from Key Vault` step
  reports `Written ts/config.local.yaml from vault secret`. If it
  fails with `Forbidden`, the Entra App lost its read role on
  `build-pipeline-kv`; cross-check Access Control (IAM) on the
  vault. If it fails with `Secret 'typeagent-config' not found`,
  the secret was renamed or deleted in the vault.
- **Stale `config.local.yaml`:** the file is gitignored and freshly
  written each run, but if the regen step somehow ran before the
  `Get Keys` step (e.g., a step was reordered), there'd be no
  endpoint to call. Inspect the step ordering in the workflow file.
- **API-key fallback:** if you fell back to API-key auth, confirm
  the secrets are named exactly `AZURE_OPENAI_API_KEY` and
  `AZURE_OPENAI_ENDPOINT` and that the workflow was edited as
  described in Step 2's "API-key fallback" section.

### Dispatched PR contains hundreds of packages

The watermark tag was reset or deleted. Push it back to a recent
commit:

```bash
git tag -f docs-bot/last-run <sha>
git push origin docs-bot/last-run --force
```

## Hardening

Beyond the baseline setup above, the recommendations below tighten
the trust surface:

1. **Audit Key Vault access periodically.** The Entra App that
   `AZUREAPPSERVICE_CLIENTID_*` refers to has Key Vault read access
   on `build-pipeline-kv`. Verify in Azure Portal → vault → Access
   Control (IAM) that the App's role is the minimum needed
   (Key Vault Secrets User), and nothing more. Revoke any
   Contributor / Owner roles that crept in.
2. **Don't add `pull_request_target`.** The workflow only fires on
   `workflow_dispatch` today — keep it that way. A
   `pull_request_target` trigger lets fork PRs run with
   write-permission tokens, which would let an attacker impersonate
   the bot _and_ exfiltrate the Key Vault payload.
3. **Environment scoping is already in place.** The `regenerate` job
   declares `environment: development-fork`, which means GitHub
   restricts FIC token issuance to that subject claim and (if you
   configure required reviewers on the environment) gates dispatches
   on approval. To narrow further, fork a dedicated
   `docs-autogen` environment from `development-fork`, register a
   second FIC on the Entra App with subject
   `repo:<org>/<repo>:environment:docs-autogen`, and switch the job
   binding to that environment.
4. **Rotate the GitHub App private key annually.** The
   `DOCS_BOT_APP_PRIVATE_KEY` secret is the one durable credential
   in this workflow; everything else is short-lived. GitHub's App
   settings page supports rotation in-place — generate a new key,
   replace the repo secret, then delete the old key.

## Tearing it down

To pause the pipeline temporarily, **Actions → docs-generate →
Disable workflow**. To remove it permanently:

1. Disable / delete the workflow file.
2. Uninstall the docs-bot GitHub App from the repository.
3. Remove the `DOCS_BOT_APP_ID` variable and the
   `DOCS_BOT_APP_PRIVATE_KEY` secret. The `AZUREAPPSERVICE_*`
   secrets are shared with `smoke-tests.yml` — **do not delete
   them**.
4. (Optional) Delete the `docs-bot/last-run` tag: `git push origin
:refs/tags/docs-bot/last-run`.

The `README.AUTOGEN.md` files already in the repository remain
useful documentation; nothing depends on the workflow to keep
working after teardown.

## Related docs

- [`doc-autogen.md`](./doc-autogen.md) — architecture and design.
- [`ts/tools/docsAutogen/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/tools/docsAutogen/README.md)
  — CLI reference and local operations.
- [`.github/workflows/docs-generate.yml`](https://github.com/microsoft/TypeAgent/blob/main/.github/workflows/docs-generate.yml)
  — the workflow itself, including the inline comments describing
  why each step exists.
