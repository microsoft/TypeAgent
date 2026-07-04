<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6cf63dd38c433bfb10a4c7dc0f0080e4b060febddc940586f7a6613c1f23accc -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/aiclient` package is a TypeScript library designed to interact with various AI APIs utilized by the Microsoft AI Systems team. It is primarily intended for use in sample agents and examples within the TypeAgent project.

## What it does

The `aiclient` package provides functionality for interacting with AI services, including:

- **OpenAI model endpoints**: Supports both Azure-hosted and OpenAI-hosted models.
- **Bing search APIs**: Enables integration with Bing for search capabilities.

### Multi-region Endpoint Pools

A key feature of this package is its ability to manage multi-region endpoint pools. These pools allow the client to distribute requests across multiple endpoints, each corresponding to a specific region or variant of a model. This approach helps mitigate issues such as throttling, timeouts, or regional outages by rotating requests among available endpoints.

#### Endpoint Pool Discovery

The library automatically discovers endpoints for a given model by scanning environment variables. For example, for a model named `GPT_4_O`, it looks for variables like:

- `AZURE_OPENAI_ENDPOINT_GPT_4_O`
- `AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>` (e.g., `_EASTUS`, `_SWEDENCENTRAL`)
- `AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>_PTU` (indicating a provisioned-throughput reservation)

Matching API keys are also discovered using similar patterns, such as `AZURE_OPENAI_API_KEY_GPT_4_O_<REGION>`.

#### Endpoint Selection and Rotation

The selection algorithm groups endpoints into priority tiers. The client selects an endpoint from the lowest-priority tier that has at least one healthy member, choosing randomly within the tier. This ensures that requests are distributed across available endpoints, reducing the risk of overloading a single endpoint.

When an endpoint fails, the client applies cooldowns and rotates to the next healthy endpoint. The cooldown duration depends on the type of failure:

- **429 (Too Many Requests)**: The client parses the `Retry-After` header and applies a cooldown based on the retry interval, with a maximum of 120 seconds.
- **5xx errors, timeouts, or network errors**: A minimum cooldown of 5 seconds is applied.
- **Non-transient 4xx errors (e.g., 401)**: The client does not rotate and returns the error immediately.

The library also allows users to override the default priority and mode of endpoints by setting a JSON array in environment variables, such as `AZURE_OPENAI_POOL_<MODEL>`.

### Debug Logging

The package supports debug logging for endpoint pool operations, including selection, rotation, and cooldown events. To enable logging, set the `DEBUG` environment variable to include the `typeagent:pool` namespace:

```bash
DEBUG=typeagent:pool,typeagent:rest:retry node your-app.js
```

## Setup

To use the `@typeagent/aiclient` package, you need to configure the following environment variables:

- `TYPEAGENT_COPILOT_SDK_LOG_LEVEL`: Specifies the log level for the Copilot SDK. Valid values include `none`, `error`, `warning`, `info`, `debug`, and `all`.

Additionally, the library relies on a set of environment variables for endpoint pool discovery and API key management. These include:

- `AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>`: Specifies the endpoint for a given model and region.
- `AZURE_OPENAI_API_KEY_<MODEL>_<REGION>`: Specifies the API key for a given model and region.
- `BING_API_KEY`: Specifies the API key for Bing search APIs.

For detailed instructions on setting up these environment variables, refer to the hand-written README. It also provides guidance on provisioning additional endpoints and using the multi-region deployment and secret-sync tooling.

## Key Files

The `aiclient` package is structured into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): The main entry point, exporting the library's primary modules and functions.
- [auth.ts](./src/auth.ts): Manages authentication, including token retrieval and Azure credentials.
- [azureSettings.ts](./src/azureSettings.ts): Handles configuration for Azure OpenAI services, including loading settings from environment variables.
- [bing.ts](./src/bing.ts): Provides functions and types for interacting with Bing search APIs.
- [common.ts](./src/common.ts): Contains utility functions for managing environment variables and settings.
- [endpointPool.ts](./src/endpointPool.ts): Implements the logic for managing endpoint pools, including selection and rotation algorithms.
- [modelResource.ts](./src/modelResource.ts): Manages model resources, including concurrency settings.
- [models.ts](./src/models.ts): Defines types and settings for various AI models, such as completion settings and JSON schema definitions.

## How to extend

To extend the `@typeagent/aiclient` package, follow these steps:

1. **Identify the area to extend**: Determine the specific functionality you want to add or modify. For example, to support a new AI model, you might start by examining [models.ts](./src/models.ts).

2. **Modify or add code**: Implement your changes in the relevant file. For instance, if you're adding a new model, define its settings and types in a manner consistent with the existing codebase.

3. **Update environment variables**: If your changes require new environment variables, update the setup instructions and ensure they are correctly loaded in the appropriate settings files.

4. **Write tests**: Add tests to validate your changes. Use the existing tests in the `./test` directory as a reference for writing new test cases.

5. **Run tests**: Execute the tests to ensure your changes work as expected. Use the following command to run the tests:
   ```bash
   pnpm test
   ```

By following these steps, you can extend the `aiclient` package while maintaining its functionality and compatibility with the rest of the TypeAgent project.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
