<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=578d806e77aca9db610efea718fe695ac18498bf2972c45344db69e47f8fe641 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/config — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/config` package is a TypeScript library designed to manage configuration for the TypeAgent ecosystem. It provides a layered approach to loading and merging configuration from multiple sources, including YAML files, environment variables, and `.env` files. The package also supports schema validation, configuration flattening, and integration with Azure Key Vault for secure storage and retrieval of sensitive data. It ensures backward compatibility with existing `process.env` consumers in the TypeAgent ecosystem.

## What it does

The `@typeagent/config` package provides the following key features:

1. **Layered Configuration Loading**:

   - Loads configuration from multiple sources, including:
     - `ts/config.defaults.yaml`: A committed default configuration file.
     - `ts/config.local.yaml`: A local, gitignored file for environment-specific overrides.
     - `.env`: A legacy fallback for backward compatibility.
     - Environment variables: Runtime overrides with the highest precedence.
     - Azure Key Vault: Planned for future phases, with encrypted local caching.

2. **Merge Precedence**:
   Configuration values are merged in the following order (from lowest to highest precedence):

   1. `.env` (legacy fallback, lowest priority)
   2. `ts/config.defaults.yaml`
   3. _Future_: Key Vault YAML blob or encrypted cache
   4. `ts/config.local.yaml`
   5. `process.env` (runtime overrides)

3. **Flattening Nested Structures**:

   - Converts nested YAML structures into flat key-value pairs that align with the `EnvVars` convention used by other TypeAgent packages.
   - Example mappings:
     - `azure.openai.api_key` → `AZURE_OPENAI_API_KEY`
     - `azure.openai.deployments[].endpoint` (suffix=foo) → `AZURE_OPENAI_ENDPOINT_FOO`
     - `extra.<KEY>` → `<KEY>` (passthrough for unknown keys)

4. **Schema Validation**:

   - Uses `zod` to validate configuration settings, ensuring they conform to expected schemas.

5. **CLI Utilities**:

   - Provides commands for importing `.env` files into YAML format and displaying the merged configuration.

6. **Sensitive Data Handling**:

   - Identifies and redacts sensitive values (e.g., API keys, secrets) in configuration data to prevent accidental exposure.

7. **Backward Compatibility**:
   - Ensures that existing TypeAgent packages relying on `process.env` continue to function without modification.

## Setup

To use the `@typeagent/config` package, you need to configure the following environment variables:

- `AZURE_OPENAI_`: Used for Azure OpenAI configuration.
- `JEST_WORKER_ID`: Utilized during Jest testing.
- `TYPEAGENT_ALLOW_KEYVAULT_IN_TESTS`: Enables Key Vault integration during tests.
- `TYPEAGENT_CONFIG_DEFAULTS`: Path to the default configuration YAML file.
- `TYPEAGENT_CONFIG_DIR`: Directory where configuration files are located.
- `TYPEAGENT_CONFIG_LOCAL`: Path to the local configuration YAML file.
- `TYPEAGENT_CONFIG_SECRET`: Secret name for the configuration in Azure Key Vault.
- `TYPEAGENT_CONFIG_VAULT`: Azure Key Vault name.
- `TYPEAGENT_DOTENV`: Path to the `.env` file.
- `TYPEAGENT_USER_DATA_DIR`: Directory for user data.

Refer to the hand-written README for additional details on obtaining these values and configuring your environment.

## Key Files

The core functionality of the `@typeagent/config` package is implemented across the following key files:

- [index.ts](./src/index.ts): Exports the main functions and types, such as `loadConfig`, `flatten`, and `fetchKeyVaultConfig`.
- [loader.ts](./src/loader.ts): Implements the logic for loading and merging configuration settings from various sources.
- [flatten.ts](./src/flatten.ts): Handles the flattening of nested YAML structures into flat key-value pairs.
- [keyVault.ts](./src/keyVault.ts): Provides functions for fetching configuration settings from Azure Key Vault.
- [cli.ts](./src/cli.ts): Implements CLI commands for importing `.env` files and displaying the merged configuration.
- [import.ts](./src/import.ts): Manages the conversion of `.env` files into YAML format and ensures compatibility with the existing configuration structure.
- [redact.ts](./src/redact.ts): Contains logic for identifying and redacting sensitive values in configuration data.
- [runtime/build.ts](./src/runtime/build.ts): Builds a typed `Config` object from a flat environment variable map.

## How to extend

To extend the functionality of the `@typeagent/config` package, consider the following approaches:

1. **Adding New Configuration Sources**:

   - Update [loader.ts](./src/loader.ts) to include the new source and modify the merging logic to incorporate it.

2. **Customizing Flattening Rules**:

   - Modify [flatten.ts](./src/flatten.ts) to adjust how nested YAML structures are flattened into flat key-value pairs.

3. **Enhancing Schema Validation**:

   - Add or update validation rules in [schema.ts](./src/schema.ts) using `zod` to enforce new configuration constraints.

4. **Extending CLI Functionality**:

   - Add new commands to [cli.ts](./src/cli.ts) and ensure they integrate with the existing configuration logic.

5. **Improving Azure Key Vault Integration**:

   - Enhance the integration in [keyVault.ts](./src/keyVault.ts) by adding new methods for fetching, caching, or managing secrets.

6. **Redacting Additional Sensitive Data**:

   - Update [redact.ts](./src/redact.ts) to include new patterns for identifying sensitive data.

7. **Typed Configuration Enhancements**:
   - Modify [runtime/build.ts](./src/runtime/build.ts) to support additional typed configuration structures or conventions.

When making changes, ensure that new functionality adheres to the existing patterns and conventions to maintain consistency and compatibility across the TypeAgent ecosystem.

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

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/config docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
