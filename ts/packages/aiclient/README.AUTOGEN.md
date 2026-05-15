<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a29f58c29d4535efa5ec09332082451db3e0db1e5254f5138625c36fd843059f -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# aiclient — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `aiclient` package is a TypeScript library designed to facilitate interactions with various AI APIs used by the Microsoft AI Systems team. It is primarily intended for sample agents and examples within the TypeAgent project.

## What it does

The `aiclient` package supports calling AI endpoints and other REST services, specifically:

- OpenAI model endpoints, both on Azure and OpenAI.
- Bing search APIs.

The library includes functionality for managing settings required to call these services, which are typically sourced from environment variables. It also features multi-region endpoint pools to handle API requests efficiently, rotating among endpoints to mitigate throttling and ensure high availability.

### Multi-region endpoint pools

The package includes a sophisticated mechanism for managing multi-region endpoint pools. Chat, embedding, and image factories resolve each model into an endpoint pool — a list of endpoints (one per region + variant) that the client rotates among on 429 / 5xx / timeout errors. This helps to survive single-region throttling without user-visible stalls and keeps a PTU reservation preferred when one is configured.

### Selection algorithm

Endpoints are grouped by priority tiers, with random selection within each tier. The lowest-priority tier that still has at least one healthy (non-cooling-down) member wins; within that tier, one member is picked uniformly at random. This ensures that multiple client processes spread across the regions in that tier instead of stampeding the same endpoint.

On failure:
- **429**: Parses `Retry-After`, marks the member as cooling for `max(Retry-After, base × 2^consecutive_429s)`, capped at 120 seconds, and rotates to the next healthy member.
- **5xx / timeout / network error**: Applies a floor cooldown of 5 seconds and rotates.
- **Non-transient 4xx** (e.g., 401): Returns immediately without rotating.

## Setup

To use the `aiclient` package, certain environment variables need to be set up. These include:

- `AZURE_OPENAI_ENDPOINT_<MODEL>_<REGION>`: Specifies the endpoint for a given model and region.
- `AZURE_OPENAI_API_KEY_<MODEL>_<REGION>`: Specifies the API key for a given model and region.
- `BING_API_KEY`: Specifies the API key for Bing search APIs.

For detailed setup instructions, including how to provision more endpoints and configure multi-region deploy and secret-sync tooling, see the hand-written README.

## Key Files
The `aiclient` package is organized into several key files, each responsible for different aspects of the library:

- [index.ts](./src/index.ts): The main entry point, exporting various modules and functions.
- [auth.ts](./src/auth.ts): Handles authentication, including token management and Azure credentials.
- [azureSettings.ts](./src/azureSettings.ts): Manages settings for Azure OpenAI services, loading them from environment variables.
- [bing.ts](./src/bing.ts): Contains functions and types for interacting with Bing search APIs.
- [common.ts](./src/common.ts): Utility functions for retrieving and managing environment settings.
- [endpointPool.ts](./src/endpointPool.ts): Manages endpoint pools, including selection algorithms and cooldown mechanisms.
- [modelResource.ts](./src/modelResource.ts): Functions for managing model resources, including concurrency settings.
- [models.ts](./src/models.ts): Types and settings for various AI models, including completion settings and JSON schema definitions.

## How to extend

To extend the `aiclient` package, follow these steps:

1. **Identify the area to extend**: Determine which part of the library you need to modify or add functionality to. For example, if you need to add support for a new AI model, you might start with [models.ts](./src/models.ts).

2. **Modify or add code**: Open the relevant file and implement your changes. Follow the existing patterns and structures to ensure consistency. For example, if adding a new model, define its settings and types similarly to existing models.

3. **Update environment variables**: If your changes require new environment variables, update the setup instructions and ensure they are correctly loaded in the relevant settings files.

4. **Test your changes**: Write tests to verify your modifications. You can find existing tests in the `./test` directory. Ensure your tests cover various scenarios and edge cases.

5. **Run tests**: Execute the tests to ensure everything works as expected. You can run the tests using the following command:
   ```bash
   pnpm test
   ```

By following these steps, you can effectively extend the functionality of the `aiclient` package while maintaining its integrity and consistency.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./test` → [./dist/test/testCore.js](./dist/test/testCore.js)

### Dependencies

Workspace: _None._

External: `@azure/identity`, `async`, `debug`, `typechat`

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
- _…and 38 more workspace consumers._

### Files of interest

`./src/index.ts`, `./src/auth.ts`, `./src/azureSettings.ts`, …and 12 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T09:27:49.365Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter aiclient docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
