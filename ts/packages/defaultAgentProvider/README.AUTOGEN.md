<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=29ead591eb371043439b48ab3de833f93958e420f5769d1685210aa67869a909 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# default-agent-provider — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `default-agent-provider` package is a TypeScript library that serves as the default agent provider for the TypeAgent ecosystem. It is a foundational component used by the shell and CLI to initialize and configure both built-in agents and external agent providers. This package ensures that the necessary agents and configurations are available for the proper functioning of the TypeAgent framework.

## What it does

This package provides default implementations for various agent-related functionalities, including agent providers, the connected app-agent source, dispatcher options, and indexing service registries. It includes functions to retrieve default configurations and providers for both built-in and external agents. Key functionalities include:

- `getDefaultAppAgentProviders`: Retrieves the default (static) application agent providers.
- `getDefaultAppAgentSource`: Provides the default connected app-agent source (owns the installed-agent record store and the host-owned `@package` agent).
- `getDefaultDispatcherOptions`: Returns the default dispatcher options.
- `getIndexingServiceRegistry`: Gets the indexing service registry.
- `getDefaultConstructionProvider`: Provides the default construction provider.

Additionally, the package includes operational scripts under the `collisions` directory. These scripts are used to test and validate the functionality of the dispatcher and agent providers. They include tools for running pipelines, generating and analyzing corpora, and testing collision detection mechanisms.

## Setup

To use the `default-agent-provider` package, follow these steps:

1. **Clone the repository**:

   ```sh
   git clone <repository-url>
   cd ts/packages/defaultAgentProvider/
   ```

2. **Install dependencies**:

   ```sh
   pnpm install
   ```

3. **Set environment variables**:
   - Define the `TYPEAGENT_FEED_REGISTRY` environment variable. This variable is required for the package to function correctly.
   - Refer to the hand-written README for detailed instructions on how to obtain and configure this value.

## Key Files

The `default-agent-provider` package is organized into several key files, each serving a specific purpose:

- [index.ts](./src/index.ts): The main entry point of the package, exporting core functions for retrieving default providers and configurations.
- [defaultAgentProviders.ts](./src/defaultAgentProviders.ts): Contains the logic for initializing and retrieving default agent providers, including `getDefaultAppAgentProviders`, `getDefaultAppAgentInstaller`, and `getDefaultDispatcherOptions`.
- [defaultConstructionProvider.ts](./src/defaultConstructionProvider.ts): Implements the default construction provider for agents.
- [mcpAgentProvider.ts](./src/mcpAgentProvider.ts): Defines the Model Context Protocol (MCP) agent provider.
- [mcpDefaultAgentProvider.ts](./src/mcpDefaultAgentProvider.ts): Initializes and retrieves the default MCP agent provider.
- [utils/config.ts](./src/utils/config.ts): Handles configuration logic, including reading and parsing configuration files.
- [utils/getPackageFilePath.ts](./src/utils/getPackageFilePath.ts): Utility function to resolve file paths relative to the package root.

### Collision Testing Scripts

The `collisions` directory contains TypeScript scripts designed to test the dispatcher's functionality and the behavior of agents under various scenarios. These scripts include:

- [expandedCorpusRunner.ts](./src/collisions/expandedCorpusRunner.ts): Runs an end-to-end pipeline for generating, probing, reanalyzing, and translating corpora.
- [listModels.ts](./src/collisions/listModels.ts): Lists all chat models configured in the environment for multi-model phrase-corpus generation.
- [optimizationRunner.ts](./src/collisions/optimizationRunner.ts): Executes a five-step optimization pipeline for collision handling.
- [previewRunner.ts](./src/collisions/previewRunner.ts): Generates a preview of neighborhoods for a given corpus.
- [probeRunner.ts](./src/collisions/probeRunner.ts): Runs single-phrase probes to test the embedding map without executing actions.
- [smokeTest.ts](./src/collisions/smokeTest.ts): A smoke test for the `@collision` corpus handlers, ensuring proper wiring without invoking external services.

These scripts are primarily used for operational testing and are not part of the primary user interface.

## How to extend

To extend the `default-agent-provider` package, you can add custom agent providers or modify existing ones. Here’s how to get started:

1. **Identify the relevant file**:

   - Most of the default agent provider logic is located in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts). Start by reviewing this file to understand the existing structure.

2. **Add a new agent provider**:

   - Define your custom agent provider in a new file or within an existing provider file, depending on your use case.
   - Update the `getDefaultAppAgentProviders` function in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts) to include your new provider.

3. **Update configurations**:

   - If your custom agent requires specific configurations, update the relevant configuration files in the `./data/` directory.

4. **Test your changes**:
   - Add new test cases in the `./test` directory to validate your changes.
   - Use the collision testing scripts in the `collisions` directory to ensure that your changes do not introduce any regressions or issues.

By following these steps, you can effectively extend the `default-agent-provider` package to meet your specific requirements while maintaining compatibility with the TypeAgent framework.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./test` → `./dist/test/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../packages/config/README.md)
- [agent-cache](../../packages/cache/README.md)
- [agent-dispatcher](../../packages/dispatcher/dispatcher/README.md)
- [android-mobile-agent](../../packages/agents/androidMobile/README.md)
- [browser-typeagent](../../packages/agents/browser/README.md)
- [calendar](../../packages/agents/calendar/README.md)
- [chat-agent](../../packages/agents/chat/README.md)
- [code-agent](../../packages/agents/code/README.md)
- [desktop-automation](../../packages/agents/desktop/README.md)
- [discord-agent](../../packages/agents/discord/README.md)
- [dispatcher-node-providers](../../packages/dispatcher/nodeProviders/README.md)
- [email](../../packages/agents/email/README.md)
- [github-cli-agent](../../packages/agents/github-cli/README.md)
- [greeting-agent](../../packages/agents/greeting/README.md)
- [image-agent](../../packages/agents/image/README.md)
- ipconfig-agent
- [knowledge-processor](../../packages/knowledgeProcessor/README.md)
- [list-agent](../../packages/agents/list/README.md)
- [markdown-agent](../../packages/agents/markdown/README.md)
- [montage-agent](../../packages/agents/montage/README.md)
- [music](../../packages/agents/player/README.md)
- [music-local](../../packages/agents/playerLocal/README.md)
- [onboarding-agent](../../packages/agents/onboarding/README.md)
- [os-notifications-agent](../../packages/agents/osNotifications/README.md)
- [photo-agent](../../packages/agents/photo/README.md)
- powershell-typeagent
- [screencapture-agent](../../packages/agents/screencapture/README.md)
- [settings-agent](../../packages/agents/settings/README.md)
- studio-agent
- taskflow-typeagent
- [telemetry](../../packages/telemetry/README.md)
- [timer-agent](../../packages/agents/timer/README.md)
- [typeagent](../../packages/typeagent/README.md)
- [typechat-utils](../../packages/utils/typechatUtils/README.md)
- utility-typeagent
- [vampire-agent](../../packages/agents/vampire/README.md)
- [video-agent](../../packages/agents/video/README.md)
- [visualstudio-agent](../../packages/agents/visualStudio/README.md)
- weather-agent
- windowsclock-agent
- workflow-agent

External: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/server-filesystem`, `chalk`, `debug`, `exifreader`, `file-size`, `glob`, `proper-lockfile`, `string-width`, `typechat`, `ws`, `zod`

### Used by

- [agent-api](../../packages/api/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- schema-studio

### Files of interest

`./src/index.ts`, `./src/collisions/expandedCorpusRunner.ts`, `./src/collisions/listModels.ts`, …and 16 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_FEED_REGISTRY`

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter default-agent-provider docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
