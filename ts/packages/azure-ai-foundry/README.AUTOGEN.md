<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8b5f836daf6daab994a7408f3320f719c9bc835e8ca7a2b9ba954001cbc7c766 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# azure-ai-foundry — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `azure-ai-foundry` package is a TypeScript library designed to interface with Azure AI Foundry agents, projects, and tools. It is primarily intended for use in sample agents and examples within the TypeAgent project. The library provides a set of utilities and abstractions to manage Azure AI Foundry agents, handle agent conversations, and integrate with tools like BingWithGrounding and Logic Apps.

## What it does

This package provides a range of functionalities to interact with Azure AI Foundry services. It supports the management of agents, conversations, and tools, enabling developers to create, update, and delete agents, manage threads, and work with specific tools. The library also includes utilities for handling environment-specific configurations required to interact with these services.

### Key Capabilities

- **Agent Management**: Actions like `createAgent`, `ensureAgent`, and `flushAgent` allow for creating, updating, and managing agents in the Azure AI Foundry ecosystem.
- **Tool Integration**: The package supports tools such as BingWithGrounding, Logic Apps, and others. For example:
  - `ensureOpenPhraseGeneratorAgent` manages the Open Phrase Generator agent.
  - `ensureKeywordExtractorAgent` manages the Keyword Extractor agent.
- **Conversation Management**: The package includes utilities for managing agent conversations, such as creating and deleting threads.
- **URL Resolution and Caching**: The `urlResolver` and `urlResolverCache` modules provide functionality for resolving URLs and caching results for efficient reuse.

The package relies on environment variables to configure access to Azure AI Foundry services and tools. These variables include API endpoints, agent IDs, and connection IDs.

## Setup

To use the `azure-ai-foundry` package, you need to configure several environment variables. These variables provide the necessary settings for interacting with Azure AI Foundry services and tools. Below is a list of required environment variables:

- `BING_WITH_GROUNDING_ENDPOINT`: The endpoint for the Bing with Grounding API.
- `BING_WITH_GROUNDING_AGENT_ID`: The ID of the Bing with Grounding agent.
- `BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID`: The ID of the URL resolution agent for Bing with Grounding.
- `BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID`: The connection ID for the URL resolution agent.
- `AZURE_FOUNDRY_AGENT_ID_VALIDATOR`: The ID of the agent used for validation.
- `LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT`: The connection ID for the Logic App HTTP endpoint.
- `AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR`: The ID of the Keyword Extractor agent.
- `AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR`: The ID of the Open Phrase Generator agent.

To obtain these values, refer to the hand-written README, which provides detailed instructions for setting up the environment and acquiring the necessary credentials.

## Key Files

The `azure-ai-foundry` package is organized into several key files, each responsible for specific functionalities:

- **[index.ts](./src/index.ts)**: Serves as the main entry point for the package. It exports modules for agents, tools, and utilities, including `bingWithGrounding`, `urlResolver`, `urlResolverCache`, `agents`, `websiteAliasExtraction`, and `openPhraseGeneratorAgent`.

- **[agents.ts](./src/agents.ts)**: Contains core functions for managing agents, such as `createAgent`, `ensureAgent`, and `flushAgent`. It also provides utilities for creating AI project clients and defining tools like Bing Grounding.

- **[bingWithGrounding.ts](./src/bingWithGrounding.ts)**: Manages settings and environment variables for the Bing with Grounding API. It includes utilities to retrieve API settings from environment variables.

- **[openPhraseGeneratorAgent.ts](./src/openPhraseGeneratorAgent.ts)**: Handles the Open Phrase Generator agent, including the `ensureOpenPhraseGeneratorAgent` function for managing its lifecycle.

- **[urlResolver.ts](./src/urlResolver.ts)**: Provides functionality for resolving URLs and managing related actions, such as `flushAgent` and `deleteThreads`.

- **[urlResolverCache.ts](./src/urlResolverCache.ts)**: Implements a caching mechanism for URL resolution, including support for domain, URL, and phrase caching.

- **[websiteAliasExtraction.ts](./src/websiteAliasExtraction.ts)**: Manages the Keyword Extractor agent and includes the `ensureKeywordExtractorAgent` function for its lifecycle management.

## How to extend

To extend the `azure-ai-foundry` package, follow these steps:

1. **Understand the existing structure**: Familiarize yourself with the key files and their responsibilities. For example, if you want to add a new agent, start by reviewing [agents.ts](./src/agents.ts).

2. **Add new functionality**:

   - If you're adding a new agent, define its configuration and lifecycle management functions in [agents.ts](./src/agents.ts) or a new file.
   - For new tools or APIs, create a dedicated module similar to [bingWithGrounding.ts](./src/bingWithGrounding.ts).

3. **Update exports**: Add your new module or functionality to [index.ts](./src/index.ts) to make it accessible to other parts of the package.

4. **Write tests**: Ensure your changes are well-tested. Add unit tests for new functions and verify that existing tests still pass.

5. **Update documentation**: Document your changes, including any new environment variables or setup steps, in the appropriate sections of the documentation.

6. **Follow coding standards**: Maintain consistency with the existing codebase by adhering to its patterns and conventions.

By following these steps, you can effectively extend the `azure-ai-foundry` package to support additional agents, tools, or functionalities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [telemetry](../../packages/telemetry/README.md)
- [typeagent](../../packages/typeagent/README.md)

External: `@azure/ai-projects`, `@azure/identity`, `async`, `debug`, `openai`, `typechat`

### Used by

- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- schema-studio
- [website-aliases](../../examples/websiteAliases/README.md)

### Files of interest

`./src/index.ts`, `./src/agents.ts`, `./src/bingWithGrounding.ts`, …and 7 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter azure-ai-foundry docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
