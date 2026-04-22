# Scripts

The scripts in this folder are primarily for the TypeAgent development team. These scripts may only apply to your development/fork if you need the functionality contained therein.

## Dev scripts

### Repo Policy

- **[repo-policy-check.mjs](./repo-policy-check.mjs)**: Script to enforce some repo wide policy used in build gates during PRs.

### Safety model: dry-run by default

Every script in this folder that mutates Azure, Key Vault, or `.env` is **dry-run by default**. They print what they would do and exit. Pass `--commit` to actually execute. This is intentional — each of these scripts can cost money, break live apps, or delete data, and accidentally running one without thinking about it is expensive.

```bash
# preview
node tools/scripts/syncPoolSecrets.mjs
# execute
node tools/scripts/syncPoolSecrets.mjs --commit
```

Inventory (`inventoryEndpoints.mjs`) is read-only and has no `--commit` flag.

### Setup

- **[azureDeploy.mjs](./azureDeploy.mjs)**: Drives the Azure deploy process using the [ARM template](./armTemplates/template.json) to create the services TypeAgent Shell needs.

  Requires Azure CLI, already logged in with `az login` and default subscription set. **Dry-run by default; pass `--commit` to execute.**

  In the tools/scripts directory:

  - Create (single region): `node azureDeploy.mjs create --commit` — deploys the full stack (OpenAI + Maps + Speech + Key Vault + AI Foundry) to the default location (`eastus`).
  - Create (multi-region pool): `node azureDeploy.mjs create --location eastus --regions swedencentral,westus,eastus2 --commit` — primary region gets the full stack; each extra region deploys only the OpenAI account + deployments (with `primaryRegion=false` ARM parameter). Follow up with `syncPoolSecrets.mjs --commit` to populate the shared vault.
  - Delete: `node azureDeploy.mjs delete --commit` to completely delete the deployed Azure service.
  - Purge: `node azureDeploy.mjs purge --commit` to purge deleted services (if `--purge false` was passed to delete).
  - Prefix: resource names default to `typeagent-*`. Override with `--prefix <name>` to match a different naming convention.

  After a successful create, it automatically runs getKeys to populate .env file.

### Multi-region endpoint pools

[`aiclient`](../../packages/aiclient/README.md) rotates among multiple Azure OpenAI endpoints on 429/5xx. These scripts provision, clean up, and wire them up:

- **[inventoryEndpoints.mjs](./inventoryEndpoints.mjs)**: Read-only. Lists every OpenAI / AIServices account in the subscription, their deployments (SKU + capacity), and the `AZURE-OPENAI-*` secrets in the shared vault. Writes a Markdown-style table to stdout plus `pools.inventory.json`. **Run this first** so you know what's already there.
- **[dedupeDeployments.mjs](./dedupeDeployments.mjs)**: Finds duplicate deployments within an account (same `(model, mode)` with >1 deployment) and plans their removal. Re-points any shared-vault secret that references a loser's URL to the winner **before** deleting. Dry-run by default.
- **[syncPoolSecrets.mjs](./syncPoolSecrets.mjs)**: Walks the cognitive-services deployments in your subscription and writes `AZURE-OPENAI-ENDPOINT-<MODEL>-<REGION>[-PTU]` and `AZURE-OPENAI-API-KEY-<MODEL>-<REGION>[-PTU]` secrets into the central vault. Also writes `AZURE-OPENAI-POOL-<MODEL>` JSON metadata with per-member mode/SKU/capacity so clients can override priorities without extra env config. De-dupes on `(region, model, mode)`; PTU deployments get a trailing `-PTU` suffix so they can coexist with PAYG of the same model in the same region. Dry-run by default.

Typical multi-region flow (all dry-run first, then repeat with `--commit`):

```bash
# 1. What do we have?
node tools/scripts/inventoryEndpoints.mjs

# 2. Clean up duplicate deployments (re-points KV secrets before deleting)
node tools/scripts/dedupeDeployments.mjs                # preview
node tools/scripts/dedupeDeployments.mjs --commit       # apply

# 3. (Optional) Add new regions
node tools/scripts/azureDeploy.mjs create --location eastus --regions swedencentral,westus3           # preview
node tools/scripts/azureDeploy.mjs create --location eastus --regions swedencentral,westus3 --commit  # apply

# 4. Aggregate all regional endpoints into the shared vault
node tools/scripts/syncPoolSecrets.mjs --vault aisystems              # preview
node tools/scripts/syncPoolSecrets.mjs --vault aisystems --commit     # apply

# 5. Pull the new secrets into .env
node tools/scripts/getKeys.mjs              # preview
node tools/scripts/getKeys.mjs --commit     # apply

# 6. Verify the pool is live
DEBUG=typeagent:pool,typeagent:rest:retry pnpm --filter shell start
```

### Key vault

If you use key vault to store service settings and keys.

- **[getKeys.mjs](./getKeys.mjs)** This script is responsible for connecting to a keyvault to download secret values for placement in the .env configuration file. This script is intended to be used in cases where there is frequent key rotation or in situations where you need to easily switch between various endpoints. This script also has the ability to elevate PIM roles for key vault access or use direct access for persistent RBAC configurations. **Dry-run by default** (both `pull` and `push`); pass `--commit` to actually write the .env (pull) or the vault (push).

- **[getKeys.config.json](./getKeys.config.json)** contains the names of the secret values to obtain from the named keyvault and to write to the .env configuration file. You can also specify secrets that are to be deprecated/removed from the .env configuration file. Regional pool secrets (`AZURE-OPENAI-*-<REGION>`, `AZURE-OPENAI-POOL-<MODEL>`) are admitted via the `sharedPatterns` regex list so new regions don't require editing this file.

### RBAC and PIM control

- **[elevate.js](./elevate.js)**: This script is used to activate/elevate [PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) roles prior to using TypeAgent. This script applies if you use [JIT (just in time access)](https://techcommunity.microsoft.com/t5/microsoft-entra-blog/just-in-time-access-to-groups-and-conditional-access-integration/ba-p/2466926) access control.
- **[elevate.config.json](./elevate.config.json)** contains the roles that the [elevate script](./elevate.js) will attempt to activate.

## Install scripts

Only if you have set up your own pipeline and azure blob storage for prebuilt TypeAgent Shell binaries. Currently, there are no publicly published binaries for TypeAgent Shell.

- **[install-shell.cmd](./install-shell.cmd)**: Shell installation script for prebuilt TypeAgent Shell binaries for Windows hosted in azure blob storage.
- **[install-shell.sh](./install-shell.sh)**: Shell installation script for prebuilt TypeAgent Shell binaries for Linux/MacOS hosted in azure blob storage.
