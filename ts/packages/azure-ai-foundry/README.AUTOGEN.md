<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=80bf197faca449d4d1ccde7575d473ee445d511c679506d8b2698d8715002773 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# azure-ai-foundry — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `azure-ai-foundry` package is a TypeScript library designed to interface with Azure AI Foundry agents, projects, and tools. It is primarily used for sample agents and examples within the TypeAgent project. This package provides functionalities to manage Azure AI Foundry agents, agent conversations, and agent tools.

## What it does

The `azure-ai-foundry` package offers a range of functionalities to manage Azure AI Foundry agents, agent conversations, and agent tools. It supports actions such as creating, updating, and deleting agents, managing threads, and handling tools like BingWithGrounding and Logic Apps. The package retrieves necessary settings from environment variables to facilitate these operations.

Key actions supported by this package include:

- `createAgent`: Create a new agent with specified configurations.
- `ensureAgent`: Retrieve an existing agent or create it if it does not exist.
- `flushAgent`: Clear agent data.
- `ensureOpenPhraseGeneratorAgent`: Manage the Open Phrase Generator agent.
- `ensureKeywordExtractorAgent`: Manage the Keyword Extractor agent.

## Setup

To use the `azure-ai-foundry` package, certain environment variables need to be set. These variables provide the necessary settings for the Bing with Grounding API and other tools. The required environment variables include:

- `BING_WITH_GROUNDING_ENDPOINT`
- `BING_WITH_GROUNDING_AGENT_ID`
- `BING_WITH_GROUNDING_URL_RESOLUTION_AGENT_ID`
- `BING_WITH_GROUNDING_URL_RESOLUTION_CONNECTION_ID`
- `AZURE_FOUNDRY_AGENT_ID_VALIDATOR`
- `LOGIC_APP_CONNECTION_ID_GET_HTTP_ENDPOINT`
- `AZURE_FOUNDRY_AGENT_ID_ALIAS_KEYWORD_EXTRACTOR`
- `AZURE_FOUNDRY_AGENT_ID_OPEN_PHRASE_GENERATOR`

For detailed setup instructions, including how to obtain these values, refer to the hand-written README.

## Key Files

The `azure-ai-foundry` package is organized into several key files, each responsible for different aspects of the library:

- [index.ts](./src/index.ts): Exports various modules including `bingWithGrounding`, `urlResolver`, `urlResolverCache`, `agents`, `websiteAliasExtraction`, and `openPhraseGeneratorAgent`.
- [agents.ts](./src/agents.ts): Contains functions to manage agents, including `createAgent` and `ensureAgent`.
- [bingWithGrounding.ts](./src/bingWithGrounding.ts): Manages settings and environment variables for the Bing with Grounding API.
- [openPhraseGeneratorAgent.ts](./src/openPhraseGeneratorAgent.ts): Manages the Open Phrase Generator agent.
- [urlResolver.ts](./src/urlResolver.ts): Handles URL resolution and related actions.
- [urlResolverCache.ts](./src/urlResolverCache.ts): Manages caching for URL resolution.
- [websiteAliasExtraction.ts](./src/websiteAliasExtraction.ts): Manages the Keyword Extractor agent.

## How to extend

To extend the `azure-ai-foundry` package, follow these steps:

1. **Identify the module to extend**: Determine which module or functionality you need to enhance. For example, if you need to add a new agent, start with [agents.ts](./src/agents.ts).

2. **Add new functionality**: Implement the new feature or enhancement in the appropriate file. Follow the existing patterns and structures used in the package.

3. **Update exports**: Ensure that your new functionality is exported in [index.ts](./src/index.ts) if it needs to be accessible from other parts of the package.

4. **Test your changes**: Write tests to verify your new functionality. Ensure that all existing tests pass and that your new tests cover the added features.

5. **Document your changes**: Update the documentation to reflect the new functionality. Include any new environment variables or setup steps if applicable.

By following these steps, you can effectively extend the `azure-ai-foundry` package to meet your specific needs.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

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
- [schema-studio](../../examples/schemaStudio/README.md)
- [website-aliases](../../examples/websiteAliases/README.md)

### Files of interest

`./src/index.ts`, `./src/agents.ts`, `./src/bingWithGrounding.ts`, …and 7 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter azure-ai-foundry docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
