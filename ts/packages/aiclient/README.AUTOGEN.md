<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=460c00288db1689212dbb9bfba3e09ce7cbf4a072bf0f4e995a26c8aa285a565 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/aiclient` package is a TypeScript library designed to interact with AI APIs, including OpenAI (both Azure-hosted and OpenAI-hosted) and Bing. It is primarily used within the TypeAgent project for sample agents and examples. The library provides tools for API settings management, authentication, and multi-region endpoint pooling to ensure high availability and resilience.

## What it does

The `aiclient` package offers the following capabilities:

- **OpenAI API Integration**: Supports GPT-4, embeddings, and image generation models hosted on Azure and OpenAI.
- **Bing API Integration**: Provides tools for querying Bing search APIs.
- **Multi-region Endpoint Pools**: Implements a mechanism to distribute requests across multiple endpoints, handling throttling and regional outages.
- **Environment-based Configuration**: Automatically discovers API settings, such as endpoints and API keys, from environment variables.
- **Authentication**: Supports Azure identity-based authentication and API key-based authentication.
- **Debug Logging**: Offers detailed logging for endpoint selection, rotation, and retry behavior.

### Multi-region Endpoint Pools

The package's endpoint pooling mechanism ensures reliability and performance by:

- **Endpoint Discovery**: Scanning environment variables to build pools of endpoints for each model and region.
- **Priority-based Selection**: Grouping endpoints into priority tiers and selecting the lowest-priority tier with healthy endpoints.
- **Cooldown Mechanism**: Temporarily marking endpoints as unavailable after transient errors (e.g., 429, 5xx).
- **Custom Pool Configuration**: Allowing users to override default endpoint discovery and priority settings using JSON-based environment variables.

### Debugging and Logging

Debug logging can be enabled for monitoring endpoint selection, rotation, and retry behavior. Use the `typeagent:pool` namespace for detailed logs.

## Setup

To use the `@typeagent/aiclient` package, configure the following environment variables:

- **`COPILOT_ALLOW_GET_PROVIDER_ENDPOINT`**: Determines whether the Copilot SDK can dynamically retrieve provider endpoints.
- **`TYPEAGENT_COPILOT_SDK_LOG_LEVEL`**: Sets the log level for the Copilot SDK. Valid values include `none`, `error`, `warning`, `info`, `debug`, and `all`.

Additionally, the package relies on dynamically discovered environment variables for endpoint pools and API keys. Examples include:

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

- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
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

`./src/index.ts`, `./src/apiSettingsFromConfig.ts`, `./src/apiTypes.ts`, …and 22 more under `./src/`.

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `COPILOT_ALLOW_GET_PROVIDER_ENDPOINT`
- `TYPEAGENT_COPILOT_SDK_LOG_LEVEL`

---

_Auto-generated against commit `3849e13a69115bff7c01ea3995c20bb2cf23343f` on `2026-07-22T05:45:45.787Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
