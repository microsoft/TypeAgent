# docs-autogen — Pipeline Setup Guide

This guide walks an operator through provisioning the
[`docs-generate`](../../../.github/workflows/docs-generate.yml) GitHub
Action that regenerates `README.AUTOGEN.md` companion files daily.

For the _why_ — architecture, format spec, and design rationale — see
[`doc-autogen.md`](./doc-autogen.md). For the local CLI and operations
runbook see
[`ts/tools/docsAutogen/README.md`](../../tools/docsAutogen/README.md).

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

A scheduled workflow runs daily at 08:00 UTC, diffs `ts/packages/**`
against a watermark git tag (`docs-bot/last-run`), regenerates
`README.AUTOGEN.md` for every changed package, validates each link
resolves on disk, opens a single batched PR via a dedicated GitHub
App, and closes any previously-open bot PRs so only one is live at a
time. The hand-written `README.md` is never modified — `docs-autogen`
writes to a parallel `README.AUTOGEN.md` file only.

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
     and force-update the `docs-bot/last-run` tag.
   - **Pull requests:** **Read & write** — needed to open the daily
     PR and close superseded ones.
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
> open. That would prevent CI from running on the daily docs PR.
> Using a dedicated App identity sidesteps that limitation, gives
> the PRs a clearly attributed author, and lets you revoke App
> credentials independently of any human PAT.

## Step 2 — Provision Azure OpenAI access (federated credentials)

The AI-authored portion of each `README.AUTOGEN.md` is generated via
[`@typeagent/aiclient`](../../packages/aiclient/README.md), which
supports both API-key and federated-identity (OIDC) auth. The
recommended path is **federated credentials** — no long-lived secret
is stored in the repo, and access is gated by Entra RBAC plus the FIC
subject claim.

### Azure-side setup (one-time)

1. **Entra App Registration** (or User-Assigned Managed Identity) in
   the same tenant as the Azure OpenAI resource. Note the
   **Application (client) ID** and **Directory (tenant) ID**.
2. **Federated credential** on that App, trusting GitHub Actions:
   - **Issuer:** `https://token.actions.githubusercontent.com`
   - **Audience:** `api://AzureADTokenExchange`
   - **Subject identifier:** `repo:<org>/<repo>:ref:refs/heads/main`
     for a branch-scoped credential, or
     `repo:<org>/<repo>:environment:<env-name>` if you wrap the
     workflow in a GitHub environment (more secure — see
     [Hardening](#hardening)).
3. **RBAC** on the Azure OpenAI resource: assign the App the
   **`Cognitive Services OpenAI User`** role. This is read-only
   inference access; the docs-bot does not need to create or modify
   deployments.
4. **Network access:** if the AzOpenAI resource has public network
   access disabled, GitHub-hosted runners cannot reach it. Either
   enable public access (and rely on Entra + RBAC as the security
   boundary), allowlist the GitHub Actions IP ranges from
   <https://api.github.com/meta>, or run on a self-hosted runner
   inside the same VNet as the private endpoint.

### Sentinel value: `AZURE_OPENAI_API_KEY=identity`

`@typeagent/aiclient` treats the literal string `"identity"` in
`AZURE_OPENAI_API_KEY` as a switch to `DefaultAzureCredential` from
`@azure/identity`, which in turn picks up the
`AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_FEDERATED_TOKEN_FILE`
env vars that `azure/login@v2` exports after a successful OIDC
exchange. The workflow already wires this — no code change is
required.

### Local validation (optional)

To smoke-test from a developer machine instead of CI you'll need to
log in interactively (or via a service principal) so
`DefaultAzureCredential` can find a token:

```powershell
cd ts
az login --tenant <your-tenant-id>
# Make sure your user identity has the Cognitive Services OpenAI User
# role on the resource, or impersonate the App registration.

"AZURE_OPENAI_ENDPOINT=...`nAZURE_OPENAI_API_KEY=identity" | Out-File -Encoding ascii .env

pnpm install
pnpm --filter aiclient build
pnpm --filter @typeagent/docs-autogen build

# Single-package smoke test against the real LLM. Pick a small package.
node tools/docsAutogen/bin/docs-autogen.cjs `
  --package timer --render --write --llm
```

If the smoke test produces a sensible
`ts/packages/agents/timer/README.AUTOGEN.md`, federated auth works
end-to-end and you can proceed.

### API-key fallback (non-Microsoft installs)

If you do not have a Microsoft tenant or cannot register an Entra
App — e.g., a personal fork or an external organization — set
`AZURE_OPENAI_API_KEY` to the actual key value as a repo secret and
edit the workflow:

- Remove the `Azure login (federated)` step.
- Change `AZURE_OPENAI_API_KEY: identity` to
  `AZURE_OPENAI_API_KEY: ${{ secrets.AZURE_OPENAI_API_KEY }}`.
- Drop the `id-token: write` permission and the three `AZURE_*`
  variables.

Everything else is identical.

## Step 3 — Configure repository secrets and variables

In the target repository, navigate to **Settings → Secrets and
variables → Actions** and add the following entries.

### Variables (Repository **variables** tab)

| Name                    | Value                                               |
| ----------------------- | --------------------------------------------------- |
| `DOCS_BOT_APP_ID`       | Numeric App ID from Step 1 (e.g. `123456`)          |
| `AZURE_CLIENT_ID`       | Application (client) ID of the Entra App / MI       |
| `AZURE_TENANT_ID`       | Directory (tenant) ID of the same App               |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID that contains the AzOpenAI resource |

> The `AZURE_*` IDs are not secrets — they are identifiers, and
> registering them as **variables** instead of secrets makes the
> workflow easier to debug. The actual security boundary is the
> federated-credential subject claim on the Entra side, plus the
> RBAC role on the AzOpenAI resource.

### Secrets (Repository **secrets** tab)

| Name                       | Value                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DOCS_BOT_APP_PRIVATE_KEY` | Full contents of the `.pem` file from Step 1, including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines |
| `AZURE_OPENAI_ENDPOINT`    | Same endpoint URL you used locally                                                                                            |

When pasting the GitHub App private key, preserve newlines exactly —
GitHub strips trailing whitespace but newlines inside the field are
kept.

> If you fell back to the API-key path, also add an
> `AZURE_OPENAI_API_KEY` secret here and apply the workflow edits
> from that section.

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
   Leave at the default; the daily workflow only runs from the
   default branch, never from forks.

If the repo lives inside an organization, the same toggles must also
be on at the **org level** (Org settings → Actions → General).
Otherwise the per-repo setting is ignored.

## Step 5 — Set the initial watermark (optional but recommended)

`docs-autogen` diffs against a lightweight git tag
(`docs-bot/last-run`) to decide which packages have changed since
the last successful run. On the very first run no tag exists, and
the tool falls back to "regenerate everything" — for a repo with
~100 packages that's a 100-package PR.

To keep the first scheduled PR small, push the tag at the current
HEAD before the first scheduled run:

```bash
git fetch origin
git tag -f docs-bot/last-run origin/main
git push origin docs-bot/last-run
```

The first scheduled run will then see no changes and skip silently.
Subsequent runs only touch packages whose source files changed after
that tag. The workflow auto-advances the tag on every successful
scheduled run with a non-empty PR.

## Step 6 — First manual run

Validate end-to-end before relying on the daily schedule:

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

## Step 7 — Let the schedule take over

With Steps 1–6 complete, no further action is required. The daily
cron at `0 8 * * *` UTC will:

1. Diff `ts/packages/**` against the watermark tag.
2. Regenerate the changed packages' `README.AUTOGEN.md` files.
3. Open a single PR titled
   `docs: regenerate package README.AUTOGEN.md files (YYYY-MM-DD)`
   on a branch like `automated/docs-readmes-YYYYMMDD-<run>`.
4. Close any prior open bot PR on a similar branch, with a
   "superseded" comment, and delete the prior branch.
5. Advance the `docs-bot/last-run` tag to the regenerated commit
   only after the PR is opened successfully.

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

- **Federated path:** confirm the `Azure login (federated)` step
  reports `Login successful`. If it fails, the FIC subject claim
  registered on the Entra App does not match the runner's actual
  subject — see the next bullet.
- **OIDC subject mismatch:** if `azure/login` fails with
  `AADSTS70021: No matching federated identity record found`, the
  subject the runner is presenting does not match what's registered
  in Entra. Add a debugging step that prints
  `${{ steps.app-token.outputs.token == '' }}` plus
  `echo "${ACTIONS_ID_TOKEN_REQUEST_URL+set}"` to confirm OIDC is
  being issued; cross-check the registered subject pattern (must
  match the workflow's branch / environment / event exactly).
- **RBAC missing:** if `azure/login` succeeds but the LLM call
  returns 401 / 403, the App registration does not have the
  `Cognitive Services OpenAI User` role on the AzOpenAI resource.
- **Endpoint mismatch:** confirm `AZURE_OPENAI_ENDPOINT` is set on
  the **repository** (not on an environment the workflow doesn't
  reference) and matches the resource you granted RBAC against.
- **API-key path:** if you fell back to API-key auth, confirm the
  secret is named exactly `AZURE_OPENAI_API_KEY` and the workflow
  was edited as described in Step 2's "API-key fallback" section.

### Daily PR contains hundreds of packages

The watermark tag was reset or deleted. Push it back to a recent
commit:

```bash
git tag -f docs-bot/last-run <sha>
git push origin docs-bot/last-run --force
```

## Hardening

Beyond the baseline setup above, three additional steps tighten the
trust surface:

1. **Scope the federated credential to a GitHub environment.**
   Create an `azure-openai` environment under **Settings →
   Environments**, optionally with required reviewers, and gate the
   workflow on it by adding `environment: azure-openai` under the
   `regenerate` job. Then change the FIC subject on the Entra App
   from `repo:<org>/<repo>:ref:refs/heads/main` to
   `repo:<org>/<repo>:environment:azure-openai`. This blocks any
   other workflow file or branch in the repo from minting tokens
   for the same App, even if they have `id-token: write`.
2. **Don't add `pull_request_target`.** The workflow only fires on
   `schedule` and `workflow_dispatch` today — keep it that way. A
   `pull_request_target` trigger lets fork PRs run with
   write-permission tokens, which would let an attacker impersonate
   the bot.
3. **Audit the App registration's permissions periodically.** The
   App should _only_ have the `Cognitive Services OpenAI User` role
   on the AzOpenAI resource — nothing else. If you see additional
   roles on the same SP (Contributor, Owner, Storage roles), revoke
   them.

## Tearing it down

To pause the pipeline temporarily, **Actions → docs-generate →
Disable workflow**. To remove it permanently:

1. Disable / delete the workflow file.
2. Uninstall the docs-bot GitHub App from the repository.
3. Remove the `DOCS_BOT_APP_ID` variable and the
   `DOCS_BOT_APP_PRIVATE_KEY` / `AZURE_OPENAI_*` secrets.
4. (Optional) Delete the `docs-bot/last-run` tag: `git push origin
:refs/tags/docs-bot/last-run`.

The `README.AUTOGEN.md` files already in the repository remain
useful documentation; nothing depends on the workflow to keep
working after teardown.

## Related docs

- [`doc-autogen.md`](./doc-autogen.md) — architecture and design.
- [`ts/tools/docsAutogen/README.md`](../../tools/docsAutogen/README.md)
  — CLI reference and local operations.
- [`.github/workflows/docs-generate.yml`](../../../.github/workflows/docs-generate.yml)
  — the workflow itself, including the inline comments describing
  why each step exists.
