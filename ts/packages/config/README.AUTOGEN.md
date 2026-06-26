<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=54e996f4a4941ad55485d095dc1a8759769a93ee816470beb24ed4c317fdc567 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/config — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/config` package is a layered YAML configuration loader for TypeAgent. It provides a mechanism to load configuration settings from various sources, including default YAML files, local overrides, environment variables, and Azure Key Vault. This package ensures that configuration settings are merged in a specific order of precedence and supports schema validation using `zod`.

## What it does

The `@typeagent/config` package offers several key features:

1. **Layered Configuration Loading**: It reads configuration settings from multiple sources, including `ts/config.defaults.yaml`, `ts/config.local.yaml`, environment variables, and optionally Azure Key Vault. The settings are merged in a specific order of precedence to ensure the correct values are used.

2. **Flattening Configuration**: The package flattens nested YAML configuration trees into flat key-value pairs that match the existing `EnvVars` convention used by other TypeAgent packages. This allows existing code that relies on `process.env` to continue working without changes.

3. **Schema Validation**: Lightweight schema validation is performed using `zod` to ensure the configuration settings are valid.

4. **CLI Support**: The package includes a CLI for importing `.env` files into YAML format and for displaying the merged configuration.

5. **Azure Key Vault Integration**: Future phases will include support for fetching configuration settings from Azure Key Vault and caching them locally in an encrypted format.

## Setup

To use the `@typeagent/config` package, you need to set up the following environment variables:

- `AZURE_OPENAI_`: This variable is used to configure Azure OpenAI settings.
- `JEST_WORKER_ID`: This variable is used for Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: This variable allows Key Vault integration during tests.
- `TYPEAGENT_CONFIG_DEFAULTS`: This variable specifies the path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: This variable specifies the directory where configuration files are located.
- `TYPEAGENT_CONFIG_LOCAL`: This variable specifies the path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: This variable specifies the secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: This variable specifies the Azure Key Vault name.
- `TYPEAGENT_DOTENV`: This variable specifies the path to the `.env` file.
- `TYPEAGENT_USER_DATA_DIR`: This variable specifies the directory for user data.

Refer to the hand-written README for detailed instructions on obtaining these values.

## Key Files

The package's source code is organized into several key files:

- [index.ts](./src/index.ts): Exports the main functions and types used by the package, including `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [cli.ts](./src/cli.ts): Implements the CLI commands for importing `.env` files and displaying the merged configuration.
- [flatten.ts](./src/flatten.ts): Contains the logic for flattening nested YAML configuration trees into flat key-value pairs.
- [import.ts](./src/import.ts): Handles the import of `.env` files and their conversion to YAML format.
- [keyVault.ts](./src/keyVault.ts): Provides functions for fetching configuration settings from Azure Key Vault.
- [loader.ts](./src/loader.ts): Implements the main configuration loading logic, including merging settings from various sources.
- [redact.ts](./src/redact.ts): Contains functions for redacting sensitive values in the configuration.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` from a flat env-var map.

## How to extend

To extend the `@typeagent/config` package, follow these steps:

1. **Add New Configuration Sources**: If you need to add new sources for configuration settings, modify the [loader.ts](./src/loader.ts) file to include the new source and update the merge logic accordingly.

2. **Update Flattening Rules**: If you need to change how configuration settings are flattened, update the [flatten.ts](./src/flatten.ts) file. Ensure that the new rules are consistent with the existing `EnvVars` convention.

3. **Enhance Schema Validation**: To add new validation rules or update existing ones, modify the [schema.ts](./src/schema.ts) file. Use `zod` to define the new schema and validation logic.

4. **Extend CLI Commands**: If you need to add new CLI commands, update the [cli.ts](./src/cli.ts) file. Implement the new commands and ensure they integrate with the existing configuration loading and merging logic.

5. **Integrate with Azure Key Vault**: To enhance the Azure Key Vault integration, update the [keyVault.ts](./src/keyVault.ts) file. Add new functions for fetching and caching configuration settings from Key Vault.

6. **Redact Sensitive Values**: If you need to update the redaction logic for sensitive values, modify the [redact.ts](./src/redact.ts) file. Ensure that the new logic correctly identifies and redacts sensitive values.

By following these steps, you can extend the functionality of the `@typeagent/config` package to meet your specific requirements.

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

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
