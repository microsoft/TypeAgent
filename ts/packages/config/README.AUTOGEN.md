<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=62f86b02c1df683318b68803868dbc307b7cfe608c6a614df9f0063e32f6a7eb -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/config — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/config` package is a TypeScript library designed to provide a layered YAML configuration loader for the TypeAgent ecosystem. It enables the loading and merging of configuration settings from multiple sources, such as default YAML files, local overrides, environment variables, and Azure Key Vault. The package ensures that configuration settings are applied in a defined order of precedence and includes schema validation to maintain data integrity.

## What it does

The `@typeagent/config` package provides the following functionality:

1. **Layered Configuration Loading**: The package supports loading configuration from multiple sources, including:

   - `ts/config.defaults.yaml`: A committed default configuration file.
   - `ts/config.local.yaml`: A local, gitignored configuration file for overrides.
   - `.env`: A legacy fallback for backward compatibility.
   - Environment variables: These take the highest precedence and allow runtime overrides.
   - Azure Key Vault: Future phases will include fetching configuration from Key Vault and caching it locally in an encrypted format.

2. **Configuration Flattening**: Nested YAML configuration trees are flattened into flat key-value pairs that align with the `EnvVars` convention used by other TypeAgent packages. This ensures compatibility with existing code that relies on `process.env`.

3. **Schema Validation**: The package uses `zod` to validate configuration settings, ensuring they conform to expected schemas.

4. **CLI Commands**: A CLI is included for tasks such as importing `.env` files into YAML format and displaying the merged configuration.

5. **Merge Precedence**: Configuration values are merged in the following order (lowest to highest precedence):

   - `.env` (legacy fallback)
   - `ts/config.defaults.yaml`
   - _Future_: Key Vault YAML blob or encrypted cache
   - `ts/config.local.yaml`
   - `process.env` (runtime overrides)

6. **Redaction of Sensitive Data**: The package includes functionality to identify and redact sensitive values in configuration data, such as API keys and secrets.

## Setup

To use the `@typeagent/config` package, ensure the following environment variables are set:

- `AZURE_OPENAI_`: Used for Azure OpenAI configuration.
- `JEST_WORKER_ID`: Used during Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: Enables Key Vault integration during tests.
- `TYPEAGENT_CONFIG_DEFAULTS`: Path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: Directory where configuration files are located.
- `TYPEAGENT_CONFIG_LOCAL`: Path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: Secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: Azure Key Vault name.
- `TYPEAGENT_DOTENV`: Path to the `.env` file.
- `TYPEAGENT_USER_DATA_DIR`: Directory for user data.

Refer to the hand-written README for detailed instructions on obtaining these values and configuring your environment.

## Key Files

The package's source code is organized into the following key files:

- [index.ts](./src/index.ts): Exports the main functions and types, such as `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [loader.ts](./src/loader.ts): Implements the core logic for loading and merging configuration settings from various sources.
- [flatten.ts](./src/flatten.ts): Handles the flattening of nested YAML configuration trees into flat key-value pairs.
- [keyVault.ts](./src/keyVault.ts): Provides functions for fetching configuration settings from Azure Key Vault.
- [cli.ts](./src/cli.ts): Implements CLI commands for importing `.env` files and displaying the merged configuration.
- [import.ts](./src/import.ts): Manages the conversion of `.env` files into YAML format and ensures compatibility with the existing configuration structure.
- [redact.ts](./src/redact.ts): Contains logic for identifying and redacting sensitive values in configuration data.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` object from a flat environment variable map.

## How to extend

To extend the functionality of the `@typeagent/config` package, consider the following approaches:

1. **Adding New Configuration Sources**: To include additional configuration sources, modify [loader.ts](./src/loader.ts) to incorporate the new source and update the merging logic.

2. **Customizing Flattening Rules**: If you need to adjust how configuration settings are flattened, update the logic in [flatten.ts](./src/flatten.ts). Ensure the changes align with the `EnvVars` convention.

3. **Enhancing Schema Validation**: To add or modify validation rules, update [schema.ts](./src/schema.ts). Use `zod` to define the new schema and validation logic.

4. **Extending CLI Functionality**: To add new CLI commands, modify [cli.ts](./src/cli.ts). Implement the new commands and ensure they integrate with the existing configuration logic.

5. **Improving Azure Key Vault Integration**: To enhance the integration with Azure Key Vault, update [keyVault.ts](./src/keyVault.ts). You can add new methods for fetching, caching, or managing secrets.

6. **Redacting Additional Sensitive Data**: If new sensitive data types need to be redacted, update the logic in [redact.ts](./src/redact.ts). Ensure the new patterns are comprehensive and tested.

When extending the package, ensure that new functionality adheres to the existing patterns and conventions to maintain consistency and compatibility across the TypeAgent ecosystem.

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

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
