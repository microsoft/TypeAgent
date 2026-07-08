<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6cf63dd38c433bfb10a4c7dc0f0080e4b060febddc940586f7a6613c1f23accc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/aiclient` package is a TypeScript library designed to interact with AI APIs, including OpenAI endpoints (both Azure-hosted and OpenAI-hosted) and Bing search APIs. It is primarily used within the TypeAgent project for sample agents and examples, providing tools to manage API settings, authentication, and multi-region endpoint pools.

## What it does

The `aiclient` package provides a range of capabilities for interacting with AI services:

- **OpenAI API Support**: Includes functionality for accessing OpenAI models hosted on Azure and OpenAI, such as GPT-4 and embedding models.
- **Bing API Support**: Provides tools for interacting with Bing search APIs.
- **Multi-region Endpoint Pools**: Implements a mechanism to distribute requests across multiple endpoints, mitigating throttling and ensuring high availability.
- **Environment-based Configuration**: Reads settings such as API keys and endpoints from environment variables, simplifying integration with existing infrastructure.
- **Authentication**: Supports Azure identity-based authentication and API key-based authentication.

### Multi-region Endpoint Pools

The package's endpoint pool mechanism is designed to handle throttling and regional failures gracefully. It rotates requests among endpoints based on priority tiers and health status. Key features include:

- **Priority-based Selection**: Endpoints are grouped into priority tiers, with the lowest-priority tier containing healthy endpoints being selected.
- **Cooldown Mechanism**: Endpoints that return transient errors (e.g., 429, 5xx) are temporarily marked as unavailable and excluded from selection.
- **Custom Pool Configuration**: Users can override the default endpoint discovery and priority settings using environment variables.

### Debugging and Logging

The package includes debug logging capabilities for monitoring endpoint selection, rotation, and retry behavior. Enabling the `typeagent:pool` namespace provides detailed logs for troubleshooting.

## Setup

To use the `@typeagent/aiclient` package, you need to configure the following environment variables:

- **`TYPEAGENT_COPILOT_SDK_LOG_LEVEL`**: Sets the log level for the Copilot SDK. Valid values include `none`, `error`, `warning`, `info`, `debug`, and `all`.

Additionally, the package relies on a set of environment variables for endpoint pools and API keys. These are dynamically discovered based on the model and region. For example:

- `AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>`: Specifies the endpoint for a given model and region.
- `AZURE_OPENAI_API_KEY_<MODEL>_<REGION>`: Specifies the API key for a given model and region.
- `BING_API_KEY`: Specifies the API key for Bing search APIs.

Refer to the hand-written README for detailed instructions on provisioning endpoints and configuring multi-region deployments.

## Key Files

The `aiclient` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point, exporting core modules and functions.
- **[auth.ts](./src/auth.ts)**: Handles authentication, including Azure identity and token management.
- **[azureSettings.ts](./src/azureSettings.ts)**: Manages settings for Azure-hosted OpenAI services, including API keys and endpoint configurations.
- **[bing.ts](./src/bing.ts)**: Provides tools for interacting with Bing search APIs.
- **[common.ts](./src/common.ts)**: Contains utility functions for managing environment variables and settings.
- **[endpointPool.ts](./src/endpointPool.ts)**: Implements the multi-region endpoint pool mechanism, including selection and cooldown logic.
- **[modelResource.ts](./src/modelResource.ts)**: Manages model-specific resources, such as concurrency limits.
- **[models.ts](./src/models.ts)**: Defines types and settings for AI models, including completion settings and JSON schema definitions.
- **[apiSettingsFromConfig.ts](./src/apiSettingsFromConfig.ts)**: Provides typed-config entry points for resolving API settings from a structured configuration.

## How to extend

To extend the `@typeagent/aiclient` package, follow these steps:

1. **Identify the Area to Extend**:

   - Determine which part of the library you need to modify or enhance. For example, to add support for a new AI model, start with [models.ts](./src/models.ts).

2. **Modify or Add Code**:

   - Open the relevant file and implement your changes. Follow the existing patterns and conventions to maintain consistency. For example, when adding a new model, define its settings and types similarly to existing models.

3. **Update Environment Variables**:

   - If your changes require new environment variables, update the setup instructions and ensure they are correctly loaded in the relevant settings files.

4. **Write Tests**:

   - Add tests to verify your changes. Place them in the `./test` directory, and ensure they cover various scenarios and edge cases.

5. **Run Tests**:

   - Execute the tests to ensure everything works as expected. Use the following command:
     ```bash
     pnpm test
     ```

6. **Document Your Changes**:
   - Update the documentation to reflect your modifications, including any new environment variables or configuration options.

By following these steps, you can effectively extend the functionality of the `aiclient` package while maintaining its reliability and consistency.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./test` → [./dist/test/testCore.js](./dist/test/testCore.js)

### Dependencies

Workspace:

- [@typeagent/config](../../packages/config/README.md)

External: `@azure/identity`, `@github/copilot-sdk`, `@huggingface/transformers`, `async`, `debug`, `typechat`

### Used by

- [@typeagent/docs-autogen](../../tools/docsAutogen/README.md)
- [@typeagent/thoughts](../../packages/mcp/thoughts/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)
- [agent-shell](../../packages/shell/README.md)
- [azure-ai-foundry](../../packages/azure-ai-foundry/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- _…and 40 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/apiSettingsFromConfig.ts`, `./src/auth.ts`, …and 20 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_COPILOT_SDK_LOG_LEVEL`

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
