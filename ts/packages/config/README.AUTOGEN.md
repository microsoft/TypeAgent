<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=506c1c0759e780de43b590b1bef1f062fc943f73c9097f1db149e22713dbc4bc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/config — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/config` package is a TypeScript library that provides a layered YAML configuration loader for the TypeAgent ecosystem. It enables the loading, merging, and validation of configuration settings from multiple sources, ensuring a consistent and structured approach to managing application configurations.

## What it does

The primary purpose of `@typeagent/config` is to manage configuration data for the TypeAgent ecosystem. It achieves this by combining configuration values from various sources in a defined order of precedence. The package supports the following features:

1. **Layered Configuration Sources**:

   - **Default YAML Configuration**: Reads from `ts/config.defaults.yaml`, a committed file containing default settings.
   - **Local Overrides**: Reads from `ts/config.local.yaml`, a gitignored file for local customizations.
   - **Environment Variables**: Allows runtime overrides with the highest precedence.
   - **.env Fallback**: Supports legacy `.env` files as a fallback mechanism.
   - **Azure Key Vault**: Future phases will include fetching configuration from Azure Key Vault and caching it locally in an encrypted format.

2. **Flattening Configuration**: Converts nested YAML structures into flat key-value pairs that align with the `EnvVars` convention used by other TypeAgent packages. This ensures compatibility with existing code that relies on `process.env`.

3. **Schema Validation**: Uses `zod` to validate configuration data, ensuring it adheres to predefined schemas and reducing the risk of misconfiguration.

4. **Command-Line Interface (CLI)**: Provides commands for tasks such as converting `.env` files to YAML format and displaying the merged configuration.

5. **Merge Precedence**: Configuration values are merged in the following order, from lowest to highest precedence:

   - `.env` (legacy fallback)
   - `ts/config.defaults.yaml`
   - _Future_: Key Vault YAML blob or encrypted cache
   - `ts/config.local.yaml`
   - `process.env` (runtime overrides)

6. **Sensitive Data Handling**: Includes functionality to identify and redact sensitive information, such as API keys and secrets, from configuration data.

## Setup

To use the `@typeagent/config` package, you need to configure the following environment variables:

- `AZURE_OPENAI_`: Used for Azure OpenAI configuration.
- `JEST_WORKER_ID`: Utilized during Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: Enables Key Vault integration during tests.
- `TYPEAGENT_CONFIG_DEFAULTS`: Specifies the path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: Defines the directory where configuration files are located.
- `TYPEAGENT_CONFIG_LOCAL`: Specifies the path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: Indicates the secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: Specifies the Azure Key Vault name.
- `TYPEAGENT_DOTENV`: Points to the `.env` file for legacy fallback.
- `TYPEAGENT_USER_DATA_DIR`: Specifies the directory for user data.

Refer to the hand-written README for detailed instructions on obtaining these values and configuring your environment.

## Key Files

The package's source code is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): Exports the main functions and types, such as `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [loader.ts](./src/loader.ts): Implements the core logic for loading and merging configuration settings from various sources.
- [flatten.ts](./src/flatten.ts): Handles the flattening of nested YAML configuration trees into flat key-value pairs.
- [keyVault.ts](./src/keyVault.ts): Provides functions for fetching configuration settings from Azure Key Vault.
- [cli.ts](./src/cli.ts): Implements CLI commands for importing `.env` files and displaying the merged configuration.
- [import.ts](./src/import.ts): Manages the conversion of `.env` files into YAML format and ensures compatibility with the existing configuration structure.
- [redact.ts](./src/redact.ts): Contains logic for identifying and redacting sensitive values in configuration data.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` object from a flat environment variable map.

## How to extend

To extend the `@typeagent/config` package, follow these guidelines:

1. **Adding New Configuration Sources**: To support additional configuration sources, modify [loader.ts](./src/loader.ts) to include the new source and update the merging logic.

2. **Customizing Flattening Rules**: If you need to change how configuration settings are flattened, update the logic in [flatten.ts](./src/flatten.ts). Ensure the changes are consistent with the `EnvVars` convention.

3. **Enhancing Schema Validation**: To add or modify validation rules, update [schema.ts](./src/schema.ts). Use `zod` to define the new schema and validation logic.

4. **Extending CLI Functionality**: To introduce new CLI commands, modify [cli.ts](./src/cli.ts). Implement the new commands and ensure they integrate with the existing configuration logic.

5. **Improving Azure Key Vault Integration**: To enhance Azure Key Vault functionality, update [keyVault.ts](./src/keyVault.ts). You can add new methods for fetching, caching, or managing secrets.

6. **Redacting Additional Sensitive Data**: If new sensitive data types need to be redacted, update the logic in [redact.ts](./src/redact.ts). Ensure the new patterns are comprehensive and tested.

When making changes, adhere to the existing patterns and conventions to maintain consistency and compatibility with the rest of the TypeAgent ecosystem.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./cli` → [./dist/cli.js](./dist/cli.js)

### Dependencies

Workspace: _None._

External: `@azure/identity`, `@azure/keyvault-secrets`, `debug`, `dotenv`, `js-yaml`, `zod`

### Used by

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/thoughts](../../packages/mcp/thoughts/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- [azure-ai-foundry](../../packages/azure-ai-foundry/README.md)
- _…and 20 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/cli.ts`, `./src/flatten.ts`, …and 13 more under `./src/`.

### Environment variables

_10 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `AZURE_OPENAI_`
- `JEST_WORKER_ID`
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`
- `TYPEAGENT_CONFIG_DEFAULTS`
- `TYPEAGENT_CONFIG_DIR`
- `TYPEAGENT_CONFIG_LOCAL`
- `TYPEAGENT_CONFIG_SECRET`
- `TYPEAGENT_CONFIG_VAULT`
- `TYPEAGENT_DOTENV`
- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
