<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=1c5c690537822d117af7416aa6b839756b6578a5940f868a7b29f52746ede2c3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/aiclient` package is a TypeScript library designed to interact with various AI APIs used by the Microsoft AI Systems team. It is primarily intended for use in sample agents and examples within the TypeAgent project.

## What it does

The `aiclient` package provides functionality for calling AI endpoints and other REST services. It supports:

- **OpenAI model endpoints**: Works with both Azure-hosted and OpenAI-hosted models.
- **Bing APIs**: Includes support for Bing search services.

The library is designed to simplify the process of configuring and managing API calls by leveraging environment variables for settings. It also includes advanced features like multi-region endpoint pools to improve reliability and performance when interacting with AI services.

### Multi-region endpoint pools

The package includes a mechanism for managing multi-region endpoint pools. These pools allow the client to rotate among multiple endpoints for a given AI model, ensuring high availability and mitigating issues like throttling or regional outages.

- **Endpoint discovery**: Endpoints are automatically discovered based on environment variable naming conventions. For example, for a model `GPT_4_O`, the library scans for variables like `AZURE_OPENAI_ENDPOINT_GPT_4_O_<REGION>` and `AZURE_OPENAI_API_KEY_GPT_4_O_<REGION>`.
- **Selection algorithm**: Endpoints are grouped into priority tiers. The client selects an endpoint from the lowest-priority tier that has at least one healthy member. Within a tier, endpoints are chosen randomly to distribute load.
- **Failure handling**: The client handles errors like `429` (rate limiting), `5xx` (server errors), and timeouts by marking endpoints as temporarily unavailable and rotating to the next available endpoint. Non-recoverable errors like `401` (unauthorized) are returned immediately without rotation.

### Debugging and customization

- **Debug logging**: Developers can enable the `typeagent:pool` namespace to monitor endpoint selection, rotation, and cooldown events.
- **Custom endpoint pools**: Users can override the default endpoint discovery and selection behavior by defining custom pools using the `AZURE_OPENAI_POOL_<MODEL>` environment variable. This allows for explicit control over endpoint priorities and configurations.

## Setup

To use the `aiclient` package, you need to configure several environment variables. These variables provide the necessary settings for connecting to AI services:

1. **Azure OpenAI endpoints and keys**:

   - `AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>`: Specifies the endpoint for a given model and region.
   - `AZURE_OPENAI_API_KEY_<MODEL>_<REGION>`: Specifies the API key for a given model and region.

   If only the legacy environment variables (`AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_API_KEY`) are set, the library will default to using a single endpoint.

2. **Bing API key**:
   - `BING_API_KEY`: Specifies the API key for accessing Bing search APIs.

For detailed instructions on provisioning endpoints and setting up multi-region configurations, refer to the hand-written README.

## Key Files

The `aiclient` package is organized into several key files, each responsible for specific functionality:

- [index.ts](./src/index.ts): The main entry point, exporting the library's public API, including functions for creating models and managing settings.
- [auth.ts](./src/auth.ts): Handles authentication, including token management and Azure credentials.
- [azureSettings.ts](./src/azureSettings.ts): Manages settings for Azure OpenAI services, including loading configurations from environment variables.
- [bing.ts](./src/bing.ts): Provides functions and types for interacting with Bing search APIs.
- [common.ts](./src/common.ts): Contains utility functions for retrieving and managing environment settings.
- [endpointPool.ts](./src/endpointPool.ts): Implements the logic for managing endpoint pools, including selection algorithms and cooldown mechanisms.
- [modelResource.ts](./src/modelResource.ts): Manages model resources, including concurrency settings.
- [models.ts](./src/models.ts): Defines types and settings for various AI models, including completion settings and JSON schema definitions.

## How to extend

To extend the `aiclient` package, follow these steps:

1. **Identify the area to extend**: Determine which part of the library you need to modify or enhance. For example, to add support for a new AI model, start with [models.ts](./src/models.ts).

2. **Implement changes**: Modify or add code in the relevant file. For instance, if adding a new model, define its settings and types in a manner consistent with the existing models.

3. **Update environment variables**: If your changes require new environment variables, update the setup instructions and ensure they are correctly loaded in the relevant settings files.

4. **Write tests**: Add tests to validate your changes. Use the existing tests in the `./test` directory as a reference. Ensure your tests cover various scenarios and edge cases.

5. **Run tests**: Execute the tests to verify that your changes work as expected. Use the following command to run the tests:
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

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
