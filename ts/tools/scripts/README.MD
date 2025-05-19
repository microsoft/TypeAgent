# Scripts

The scripts in this folder are primarily for the TypeAgent development team. These scripts may only apply to your development/fork if you need the functionality contained there.
This folder contains the following scripts:

- **elevate.js**: This script is used to activate/elevate [PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) roles prior to using TypeAgent. This script applies if you use [JIT (just in time access)](https://techcommunity.microsoft.com/t5/microsoft-entra-blog/just-in-time-access-to-groups-and-conditional-access-integration/ba-p/2466926) access control.

- **elevate.config.json**: This file contains the roles that the [elevate script](./elevate.js) will attempt to activate.

- **getKeys.mjs**: This script is responsible for connecting to a keyvault to dowload secret values for placement in the .env configuration file. This script is intended to be used in cases where there is frequent key rotation or in situations where you need to easily switch between various endpoints. This script also has the ability to elevate PIM roles for key vault access or use direct acccess for persistent RBAC configurations.

- **getKeys.config.json**: This file contains the names of the secret values to obtain from the named keyvault and to write to the .env configuration file. You can also specify secrets that are to be deprecated/removed from the .env configruation file.

- **install-shell.cmd**: Shell installation script for prebuilt TypeAgent Shell binaries for Windows.

- **install-shell.sh**: Shell installation script for prebuilt TypeAgent Shell binaries for Linux.

- **repo-policy-check.mjs**: Script used for running build gates during PRs.
