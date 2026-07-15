<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=fbf67311a5655ddd9bb173383f61dd40bc848df392aa9000b4658228e7df237d -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# default-agent-provider — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `default-agent-provider` package is a TypeScript library that serves as the default agent provider for the TypeAgent framework. It is a foundational component used by the shell and CLI to initialize and manage both built-in agents and external agent providers. This package ensures that the necessary agents and configurations are available to support the TypeAgent ecosystem, including test agents and dispatcher configurations.

## What it does

The `default-agent-provider` package provides a centralized mechanism for managing agents and their configurations. Its key responsibilities include:

- **Default Agent Providers**: Functions like `getDefaultAppAgentProviders` and `getDefaultConstructionProvider` supply pre-configured agent providers and construction mechanisms for initializing agents.
- **Agent Source Management**: The `getDefaultAppAgentSource` function manages the connected app-agent source, including the installed-agent record store and the host-owned `@package` agent.
- **Dispatcher Configuration**: The `getDefaultDispatcherOptions` function provides default settings for the dispatcher, which routes actions to the appropriate agents.
- **Indexing Service Registry**: The `getIndexingServiceRegistry` function organizes and retrieves agent-related data through an indexing service.

### Test Agents

The package includes test agents, such as the `vampire` agent, which are used to evaluate dispatcher subsystems like action collision detection. These agents are disabled by default in production but can be enabled for testing purposes via session configuration.

### Collision Testing

The package also includes operational scripts for testing dispatcher functionality and agent behavior under various scenarios, such as action collision detection and optimization pipelines. These scripts are located in the `collisions` directory and are primarily used for internal testing and debugging.

### Managing Non-Bundled Agents

Some agents, such as `androidMobile` and `vampire`, are not included in the default provider profile. These agents can be installed on demand using the `@package` commands. The catalog source entries for these agents are defined in [../agents/agents.catalog.json](../agents/agents.catalog.json).

## Setup

To set up and use the `default-agent-provider` package, follow these steps:

1. **Install dependencies**:

   - Navigate to the package directory: `cd ts/packages/defaultAgentProvider/`.
   - Run `pnpm install` to install the required dependencies.

2. **Set environment variables**:

   - `CS_BENCH_MAX_OLD_SPACE_MB`: Configure this variable to control the maximum old space memory allocation for the V8 engine.
   - `CS_NEGATION_GUARD`: Set this variable to enable or disable negation guard functionality.
   - `TYPEAGENT_FEED_REGISTRY`: Specifies the registry for the agent feed. This value should be set in your environment. Refer to the hand-written README for details on how to configure this variable.
   - `TYPEAGENT_FEED_SCOPES`: Defines the scopes for the agent feed. Ensure this variable is set appropriately for your environment.

3. **Optional setup for non-bundled agents**:
   - To install agents like `androidMobile` and `vampire`, use the following commands:
     ```text
     @package install androidMobile
     @package install vampire
     ```
   - If the installation fails due to a missing catalog source, run `@package source list` to verify the catalog source configuration.

## Key Files

The `default-agent-provider` package is organized into several key files, each with specific responsibilities:

- [index.ts](./src/index.ts): The main entry point of the package, exporting core functions for retrieving default providers and configurations.
- [defaultAgentProviders.ts](./src/defaultAgentProviders.ts): Contains logic for initializing and retrieving default agent providers, including `getDefaultAppAgentProviders`, `getDefaultAppAgentInstaller`, and `getDefaultDispatcherOptions`.
- [defaultConstructionProvider.ts](./src/defaultConstructionProvider.ts): Implements the default construction provider for agents.
- [mcpAgentProvider.ts](./src/mcpAgentProvider.ts): Defines the Model Context Protocol (MCP) agent provider.
- [mcpDefaultAgentProvider.ts](./src/mcpDefaultAgentProvider.ts): Initializes and retrieves the default MCP agent provider.
- [utils/config.ts](./src/utils/config.ts): Handles configuration logic, including reading and parsing configuration files.
- [utils/getPackageFilePath.ts](./src/utils/getPackageFilePath.ts): Utility function to resolve file paths relative to the package root.

### Collision Testing Scripts

The `collisions` directory contains scripts for testing dispatcher functionality and agent behavior under various scenarios. These include:

- [expandedCorpusRunner.ts](./src/collisions/expandedCorpusRunner.ts): Runs an end-to-end pipeline for generating, probing, reanalyzing, and translating corpora.
- [listModels.ts](./src/collisions/listModels.ts): Lists all chat models configured in the environment for multi-model phrase-corpus generation.
- [optimizationRunner.ts](./src/collisions/optimizationRunner.ts): Executes a five-step optimization pipeline for collision handling.
- [previewRunner.ts](./src/collisions/previewRunner.ts): Generates a preview of neighborhoods for a given corpus.
- [probeRunner.ts](./src/collisions/probeRunner.ts): Runs single-phrase probes to test the embedding map without executing actions.
- [smokeTest.ts](./src/collisions/smokeTest.ts): A smoke test for the `@collision` corpus handlers, ensuring proper wiring without invoking external services.

These scripts are primarily used for operational testing and are not part of the primary user interface.

## How to extend

To extend the `default-agent-provider` package, you can add custom agent providers or modify existing ones. Here’s how to get started:

1. **Understand the existing structure**:

   - Review [defaultAgentProviders.ts](./src/defaultAgentProviders.ts) to understand how default agent providers are initialized and managed.

2. **Add a new agent provider**:

   - Create a new file for your custom agent provider or modify an existing one.
   - Update the `getDefaultAppAgentProviders` function in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts) to include your new provider.

3. **Modify configurations**:

   - If your custom agent requires specific configurations, update the relevant configuration files in the `./data/` directory.

4. **Test your changes**:
   - Add new test cases in the `./test` directory to validate your changes.
   - Use the collision testing scripts in the `collisions` directory to ensure that your changes do not introduce any regressions or issues.

By following these steps, you can effectively extend the `default-agent-provider` package to meet your specific requirements while maintaining compatibility with the TypeAgent framework.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./test` → [./dist/test/index.js](./dist/test/index.js)

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
- [video-agent](../../packages/agents/video/README.md)
- [visualstudio-agent](../../packages/agents/visualStudio/README.md)
- weather-agent
- windowsclock-agent
- workflow-agent

External: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/server-filesystem`, `chalk`, `debug`, `exifreader`, `file-size`, `glob`, `proper-lockfile`, `semver`, `string-width`, `typechat`, `ws`, `zod`

### Used by

- [@typeagent/action-browser](../../tools/actionBrowser/README.md)
- [@typeagent/docs-autogen](../../tools/docsAutogen/README.md)
- [agent-api](../../packages/api/README.md)
- [agent-cli](../../packages/cli/README.md)
- [agent-server](../../packages/agentServer/server/README.md)
- [agent-shell](../../packages/shell/README.md)
- [cache-rest-endpoint](../../examples/cacheRESTEndpoint/README.md)
- schema-studio
- [typeagent-studio](../../packages/typeagent-studio/README.md)

### Files of interest

`./src/index.ts`, `./src/collisions/expandedCorpusRunner.ts`, `./src/collisions/listModels.ts`, …and 45 more under `./src/`.

### Environment variables

_4 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `CS_BENCH_MAX_OLD_SPACE_MB`
- `CS_NEGATION_GUARD`
- `TYPEAGENT_FEED_REGISTRY`
- `TYPEAGENT_FEED_SCOPES`

---

_Auto-generated against commit `27016facc11ab05d8556e8b89c421f6a0a90f2e2` on `2026-07-15T22:35:06.059Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter default-agent-provider docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
