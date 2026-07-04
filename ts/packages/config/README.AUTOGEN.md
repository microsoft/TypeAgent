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

1. **Layered Configuration Loading**:

   - Loads configuration from multiple sources in a defined order of precedence:
     1. `.env` (legacy fallback, lowest precedence)
     2. `ts/config.defaults.yaml` (committed defaults)
     3. _Future_: Azure Key Vault YAML blob or encrypted cache
     4. `ts/config.local.yaml` (local overrides, gitignored)
     5. `process.env` (runtime overrides, highest precedence)

2. **Configuration Flattening**:

   - Converts nested YAML configuration trees into flat key-value pairs that align with the `EnvVars` convention used by other TypeAgent packages. For example:
     - `azure.openai.api_key` → `AZURE_OPENAI_API_KEY`
     - `azure.openai.deployments[].endpoint` (with suffix `foo`) → `AZURE_OPENAI_ENDPOINT_FOO`
   - This ensures compatibility with existing code that relies on `process.env`.

3. **Schema Validation**:

   - Uses `zod` to validate configuration settings, ensuring they conform to expected schemas and reducing the risk of misconfiguration.

4. **CLI Utilities**:

   - Includes commands for importing `.env` files into YAML format and displaying the merged configuration. These tools simplify the migration from legacy `.env` files to the new YAML-based configuration system.

5. **Sensitive Data Handling**:

   - Identifies and redacts sensitive values (e.g., API keys, secrets) in configuration data to prevent accidental exposure.

6. **Azure Key Vault Integration**:
   - While not yet fully implemented, future phases will include fetching configuration from Azure Key Vault and caching it locally in an encrypted format.

## Setup

To use the `@typeagent/config` package, you need to configure the following environment variables:

- `AZURE_OPENAI_`: Used for Azure OpenAI configuration. Refer to the hand-written README for details on how to set this.
- `JEST_WORKER_ID`: Utilized during Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: Enables the use of Key Vault during testing.
- `TYPEAGENT_CONFIG_DEFAULTS`: Specifies the path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: Defines the directory where configuration files are stored.
- `TYPEAGENT_CONFIG_LOCAL`: Specifies the path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: The secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: The name of the Azure Key Vault.
- `TYPEAGENT_DOTENV`: Path to the `.env` file for legacy fallback.
- `TYPEAGENT_USER_DATA_DIR`: Directory for user-specific data.

For detailed instructions on obtaining and setting these values, refer to the hand-written README.

## Key Files

The package is structured into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): Exports the main functions and types, such as `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [loader.ts](./src/loader.ts): Implements the logic for loading and merging configuration settings from various sources.
- [flatten.ts](./src/flatten.ts): Handles the transformation of nested YAML configuration trees into flat key-value pairs.
- [keyVault.ts](./src/keyVault.ts): Provides methods for fetching configuration settings from Azure Key Vault.
- [cli.ts](./src/cli.ts): Implements CLI commands for importing `.env` files and displaying the merged configuration.
- [import.ts](./src/import.ts): Manages the conversion of `.env` files into YAML format and ensures compatibility with the existing configuration structure.
- [redact.ts](./src/redact.ts): Contains logic for identifying and redacting sensitive values in configuration data.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` object from a flat environment variable map.

## How to extend

To extend the `@typeagent/config` package, follow these guidelines:

1. **Add New Configuration Sources**:

   - Modify [loader.ts](./src/loader.ts) to include the new source and update the merging logic to incorporate it.

2. **Customize Flattening Rules**:

   - Update [flatten.ts](./src/flatten.ts) to adjust how configuration settings are flattened. Ensure the changes align with the `EnvVars` convention used across the TypeAgent ecosystem.

3. **Enhance Schema Validation**:

   - Modify [schema.ts](./src/schema.ts) to add or update validation rules. Use `zod` to define the new schema and ensure it aligns with the expected configuration structure.

4. **Expand CLI Functionality**:

   - Add new commands to the CLI by extending [cli.ts](./src/cli.ts). Ensure the new commands integrate with the existing configuration logic.

5. **Improve Azure Key Vault Integration**:

   - Enhance the Azure Key Vault integration by updating [keyVault.ts](./src/keyVault.ts). You can add new methods for fetching, caching, or managing secrets.

6. **Redact Additional Sensitive Data**:
   - If new types of sensitive data need to be redacted, update the logic in [redact.ts](./src/redact.ts). Ensure the new patterns are comprehensive and tested.

When making changes, adhere to the existing patterns and conventions in the codebase to maintain consistency and ensure compatibility with other TypeAgent packages.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
