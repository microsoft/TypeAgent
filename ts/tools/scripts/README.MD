# Scripts

The scripts in this folder are primarily for the TypeAgent development team. These scripts may only apply to your development/fork if you need the functionality contained therein.

## Dev scripts

### Repo Policy

- **[repo-policy-check.mjs](./repo-policy-check.mjs)**: Script to enforce some repo wide policy used in build gates during PRs.

### Setup

- **[azureDeploy.mjs](./azureDeploy.mjs)**: This script drives azure deploy process using the [ARM template](./armTemplates/template.json) that will create the services needed to run TypeAgent Shell.

  Require Azure CLI, that is already logged in with `az login` and default subscription set.

  In the tools/scripts directory:

  - Create: run `node azureDeploy.mjs create` to deploy the azure service.
  - Delete: run `node azureDeploy.mjs delete` to completely delete the deployed azure service.
  - Purge: run `node azureDeploy.mjs purge` to purge deleted services (if --purge false is specified in delete`)

  After deploy, it will automatically runs getKeys to populate .env file.

### Key vault

If you use key vault to store service settings and keys.

- **[getKeys.mjs](./getKeys.mjs)** This script is responsible for connecting to a keyvault to download secret values for placement in the .env configuration file. This script is intended to be used in cases where there is frequent key rotation or in situations where you need to easily switch between various endpoints. This script also has the ability to elevate PIM roles for key vault access or use direct access for persistent RBAC configurations.

- **[getKeys.config.json](./getKeys.config.json)** contains the names of the secret values to obtain from the named keyvault and to write to the .env configuration file. You can also specify secrets that are to be deprecated/removed from the .env configuration file.

### RBAC and PIM control

- **[elevate.js](./elevate.js)**: This script is used to activate/elevate [PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) roles prior to using TypeAgent. This script applies if you use [JIT (just in time access)](https://techcommunity.microsoft.com/t5/microsoft-entra-blog/just-in-time-access-to-groups-and-conditional-access-integration/ba-p/2466926) access control.
- **[elevate.config.json](./elevate.config.json)** contains the roles that the [elevate script](./elevate.js) will attempt to activate.

## Install scripts

Only if you have set up your own pipeline and azure blob storage for prebuilt TypeAgent Shell binaries. Currently, there are no publicly published binaries for TypeAgent Shell.

- **[install-shell.cmd](./install-shell.cmd)**: Shell installation script for prebuilt TypeAgent Shell binaries for Windows hosted in azure blob storage.
- **[install-shell.sh](./install-shell.sh)**: Shell installation script for prebuilt TypeAgent Shell binaries for Linux/MacOS hosted in azure blob storage.
