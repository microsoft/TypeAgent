<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=578d806e77aca9db610efea718fe695ac18498bf2972c45344db69e47f8fe641 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/config — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/config` package is a TypeScript library that provides a layered YAML configuration loader for the TypeAgent ecosystem. It enables the loading, merging, and validation of configuration settings from multiple sources, ensuring a consistent and structured approach to managing application configurations.

## What it does

The `@typeagent/config` package offers the following key features:

1. **Layered Configuration Loading**: The package supports loading configuration from multiple sources in a defined order of precedence:

   - `.env` file: Acts as a legacy fallback for backward compatibility.
   - `ts/config.defaults.yaml`: A committed default configuration file.
   - `ts/config.local.yaml`: A local, gitignored configuration file for environment-specific overrides.
   - Environment variables: These take the highest precedence and allow runtime overrides.
   - Azure Key Vault: Future phases will include fetching configuration from Key Vault and caching it locally in an encrypted format.

2. **Configuration Flattening**: The package flattens nested YAML configuration trees into flat key-value pairs. These pairs follow the `EnvVars` convention used by other TypeAgent packages, ensuring compatibility with existing code that relies on `process.env`.

3. **Schema Validation**: Using `zod`, the package validates configuration settings to ensure they conform to expected schemas, reducing the risk of misconfigurations.

4. **CLI Support**: The package includes a command-line interface (CLI) for tasks such as converting `.env` files to YAML format and displaying the merged configuration.

5. **Redaction of Sensitive Data**: The package can identify and redact sensitive values, such as API keys and secrets, from configuration data.

6. **Merge Precedence**: Configuration values are merged in the following order (from lowest to highest precedence):
   - `.env` (legacy fallback)
   - `ts/config.defaults.yaml`
   - _Future_: Key Vault YAML blob or encrypted cache
   - `ts/config.local.yaml`
   - `process.env` (runtime overrides)

## Setup

To use the `@typeagent/config` package, you need to configure the following environment variables:

- `AZURE_OPENAI_`: Used for Azure OpenAI configuration.
- `JEST_WORKER_ID`: Utilized during Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: Enables Key Vault integration during tests.
- `TYPEAGENT_CONFIG_DEFAULTS`: Specifies the path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: Defines the directory where configuration files are located.
- `TYPEAGENT_CONFIG_LOCAL`: Specifies the path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: The secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: The name of the Azure Key Vault.
- `TYPEAGENT_DOTENV`: Path to the `.env` file for legacy configuration.
- `TYPEAGENT_USER_DATA_DIR`: Directory for user-specific data.

Refer to the hand-written README for additional details on obtaining these values and setting up your environment.

## Key Files

The package is structured into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): The main entry point, exporting core functions and types such as `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [loader.ts](./src/loader.ts): Implements the logic for loading and merging configuration settings from various sources.
- [flatten.ts](./src/flatten.ts): Handles the transformation of nested YAML configuration trees into flat key-value pairs.
- [keyVault.ts](./src/keyVault.ts): Provides methods for fetching configuration settings from Azure Key Vault.
- [cli.ts](./src/cli.ts): Implements CLI commands for importing `.env` files, displaying merged configurations, and other tasks.
- [import.ts](./src/import.ts): Manages the conversion of `.env` files into YAML format and ensures compatibility with the existing configuration structure.
- [redact.ts](./src/redact.ts): Contains logic for identifying and redacting sensitive values in configuration data.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` object from a flat environment variable map.

## How to extend

To customize or extend the `@typeagent/config` package, you can follow these guidelines:

1. **Add New Configuration Sources**: To support additional configuration sources, modify [loader.ts](./src/loader.ts) to include the new source and update the merging logic accordingly.

2. **Modify Flattening Rules**: If you need to change how configuration settings are flattened, update the logic in [flatten.ts](./src/flatten.ts). Ensure that the changes align with the `EnvVars` convention used across the TypeAgent ecosystem.

3. **Enhance Schema Validation**: To add or modify validation rules, update [schema.ts](./src/schema.ts). Use `zod` to define new schemas or adjust existing ones.

4. **Expand CLI Functionality**: To introduce new CLI commands, extend [cli.ts](./src/cli.ts). Implement the desired functionality and ensure it integrates with the existing configuration logic.

5. **Improve Azure Key Vault Integration**: To enhance the package's interaction with Azure Key Vault, update [keyVault.ts](./src/keyVault.ts). You can add new methods for fetching, caching, or managing secrets.

6. **Redact Additional Sensitive Data**: If new types of sensitive data need to be redacted, update the logic in [redact.ts](./src/redact.ts). Ensure the new patterns are comprehensive and tested.

When making changes, follow the existing patterns and conventions in the codebase to maintain consistency and ensure compatibility with other TypeAgent packages.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
