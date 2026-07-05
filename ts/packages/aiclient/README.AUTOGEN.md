<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6cf63dd38c433bfb10a4c7dc0f0080e4b060febddc940586f7a6613c1f23accc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/aiclient` package is a TypeScript library designed to interact with various AI APIs, including OpenAI and Bing services. It is primarily used within the TypeAgent project to support sample agents and examples. The library provides tools for managing API settings, authentication, and efficient handling of multi-region endpoint pools to ensure high availability and resilience against throttling.

## What it does

The `aiclient` package provides a set of utilities and abstractions to simplify interactions with AI services. Its key features include:

- **Support for AI Services**: The library supports OpenAI model endpoints (both Azure-hosted and OpenAI-hosted) and Bing search APIs.
- **Multi-region Endpoint Pools**: The package includes a mechanism to manage endpoint pools for chat, embedding, and image models. These pools allow the client to rotate among multiple endpoints to handle throttling (HTTP 429), server errors (5xx), and timeouts. This ensures high availability and minimizes user-visible disruptions.
- **Dynamic Endpoint Discovery**: Endpoints are dynamically discovered based on environment variable naming conventions. For example, endpoints for a model like `GPT_4_O` are identified using variables such as `AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>` and `AZURE_OPENAI_API_KEY_GPT_4_O_<REGION>`.
- **Selection Algorithm**: The library uses a priority-based selection algorithm to choose endpoints. It groups endpoints into priority tiers and selects a healthy endpoint from the lowest-priority tier with available members. Failures trigger cooldowns and rotation to other endpoints.
- **Debug Logging**: The library supports detailed debug logging for endpoint selection, rotation, and cooldown events, as well as retry logic for API calls.

The package is designed to be backward-compatible, ensuring that existing configurations and code continue to work without modification. Users can opt into advanced features, such as multi-region endpoint pools, by setting additional environment variables.

## Setup

To use the `@typeagent/aiclient` package, you need to configure the following environment variables:

- **`TYPEAGENT_COPILOT_SDK_LOG_LEVEL`**: Specifies the log level for the Copilot SDK. Valid values include `none`, `error`, `warning`, `info`, `debug`, and `all`.

Additionally, to enable multi-region endpoint pools for OpenAI models, you can set the following environment variables:

- **`AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>`**: Specifies the endpoint for a given model and region.
- **`AZURE_OPENAI_API_KEY_<MODEL>_<REGION>`**: Specifies the API key for a given model and region.

For Bing search APIs, you need to set:

- **`BING_API_KEY`**: Specifies the API key for Bing search APIs.

Refer to the hand-written README for detailed instructions on obtaining these values and configuring the environment variables. It also includes guidance on provisioning additional endpoints and using the multi-region deploy and secret-sync tooling.

## Key Files

The `aiclient` package is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): The main entry point, exporting the library's public API, including modules for OpenAI, Bing, and Copilot SDK integrations.
- [auth.ts](./src/auth.ts): Handles authentication, including token management and Azure credentials.
- [azureSettings.ts](./src/azureSettings.ts): Manages settings for Azure OpenAI services, including API keys and endpoint configurations.
- [bing.ts](./src/bing.ts): Provides functions and types for interacting with Bing search APIs.
- [common.ts](./src/common.ts): Contains utility functions for managing environment variables and settings.
- [endpointPool.ts](./src/endpointPool.ts): Implements the multi-region endpoint pool logic, including selection algorithms and cooldown mechanisms.
- [modelResource.ts](./src/modelResource.ts): Manages model resources, including concurrency settings and resource allocation.
- [models.ts](./src/models.ts): Defines types and settings for various AI models, including completion settings and JSON schema definitions.
- [apiSettingsFromConfig.ts](./src/apiSettingsFromConfig.ts): Provides functions for resolving API settings from a typed configuration object, supporting both legacy and new configuration methods.
- [copilotModels.ts](./src/copilotModels.ts): Contains utilities for interacting with the Copilot SDK, including client initialization and session management.
- [copilotSettings.ts](./src/copilotSettings.ts): Manages settings specific to the Copilot SDK, including model configurations and reasoning effort levels.

## How to extend

To extend the `@typeagent/aiclient` package, follow these steps:

1. **Identify the area to extend**: Determine which functionality you need to modify or add. For example, to support a new AI model, you might start with [models.ts](./src/models.ts) or [modelResource.ts](./src/modelResource.ts).

2. **Modify or add code**: Open the relevant file and implement your changes. Follow the existing patterns and structures to maintain consistency. For example:

   - To add a new AI model, define its settings and types in [models.ts](./src/models.ts).
   - To add a new endpoint pool, modify [endpointPool.ts](./src/endpointPool.ts) and update the selection algorithm if necessary.

3. **Update environment variables**: If your changes require new environment variables, update the setup instructions and ensure they are correctly loaded in the relevant settings files, such as [common.ts](./src/common.ts) or [azureSettings.ts](./src/azureSettings.ts).

4. **Write tests**: Add tests to verify your changes. Tests should cover various scenarios, including edge cases. Place your tests in the `./test` directory.

5. **Run tests**: Use the following command to run the tests and ensure your changes work as expected:

   ```bash
   pnpm test
   ```

6. **Document your changes**: Update the hand-written README or other relevant documentation to reflect your modifications.

By following these steps, you can extend the `aiclient` package to support additional AI services, models, or custom functionality while maintaining compatibility with the existing codebase.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
