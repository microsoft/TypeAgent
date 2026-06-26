<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d734e2d04f0211bc3edf459edba467cb782cdc6a04296349258f294f74e00d72 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# default-agent-provider — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `default-agent-provider` package is a TypeScript library that serves as the default agent provider for the TypeAgent ecosystem. It is utilized by the shell and CLI to include both built-in agents and external agent providers, facilitating the initialization and configuration of agents within the framework.

## What it does

This package provides default implementations for various agent-related functionalities, including agent providers, agent installers, dispatcher options, and indexing service registries. It includes functions to retrieve default configurations and providers for both built-in and external agents. Key functionalities include:

- `getDefaultAppAgentProviders`: Retrieves the default application agent providers.
- `getDefaultAppAgentInstaller`: Provides the default application agent installer.
- `getDefaultDispatcherOptions`: Returns the default dispatcher options.
- `getIndexingServiceRegistry`: Gets the indexing service registry.
- `getDefaultConstructionProvider`: Provides the default construction provider.

These functions are essential for initializing and configuring agents within the TypeAgent framework, ensuring that the necessary components are available for agent operations.

Additionally, the package registers a small set of test agents whose purpose is to exercise dispatcher subsystems. These test agents are disabled by default in production sessions but can be enabled via session config when evaluating collision-resolution strategies. For example, the `vampire` agent deliberately collides with other agents to test the dispatcher's action collision detection subsystem.

## Setup

To set up the `default-agent-provider` package, follow these steps:

1. Clone the repository and navigate to the package directory:

   ```sh
   git clone <repository-url>
   cd ts/packages/defaultAgentProvider/
   ```

2. Install the dependencies:

   ```sh
   pnpm install
   ```

3. Set the `TYPEAGENT_FEED_REGISTRY` environment variable. This variable is required for the package to function correctly. Refer to the hand-written README for detailed instructions on how to obtain and set this value.

For detailed setup instructions, refer to the hand-written README.

## Key Files

The package is structured into several key files, each responsible for different aspects of the agent provider functionality:

- [index.ts](./src/index.ts): Exports the main functions for retrieving default providers and configurations.
- [defaultAgentProviders.ts](./src/defaultAgentProviders.ts): Contains the logic for initializing and retrieving default agent providers.
- [defaultConstructionProvider.ts](./src/defaultConstructionProvider.ts): Provides the default construction provider.
- [mcpAgentProvider.ts](./src/mcpAgentProvider.ts): Defines the MCP (Model Context Protocol) agent provider.
- [mcpDefaultAgentProvider.ts](./src/mcpDefaultAgentProvider.ts): Initializes and retrieves the default MCP agent provider.
- [utils/config.ts](./src/utils/config.ts): Handles the configuration logic, including reading and parsing configuration files.
- [utils/getPackageFilePath.ts](./src/utils/getPackageFilePath.ts): Utility function to get the file path relative to the package root.

### Key Functions and Their Responsibilities

- `getDefaultAppAgentProviders`: Located in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts), this function initializes and retrieves the default application agent providers.
- `getDefaultAppAgentInstaller`: Also in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts), this function provides the default application agent installer.
- `getDefaultDispatcherOptions`: Found in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts), this function returns the default dispatcher options.
- `getIndexingServiceRegistry`: Located in [defaultAgentProviders.ts](./src/defaultAgentProviders.ts), this function gets the indexing service registry.
- `getDefaultConstructionProvider`: Defined in [defaultConstructionProvider.ts](./src/defaultConstructionProvider.ts), this function provides the default construction provider.

## How to extend

To extend the `default-agent-provider` package, follow these steps:

1. Open the [defaultAgentProviders.ts](./src/defaultAgentProviders.ts) file. This is where the default agent providers are defined and initialized.
2. Add your custom agent provider logic within the appropriate functions. For example, you can modify the `getDefaultNpmAppAgentProvider` function to include additional agents.
3. Update the configuration files in the `./data/` directory to include your new agents and servers.
4. Ensure your changes are tested by running the existing test suite or adding new tests in the `./test` directory.

By following these steps, you can customize and extend the default agent provider to suit your specific needs. This allows for the integration of new agents and configurations, enhancing the functionality of the TypeAgent framework.

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
- [schema-studio](../../examples/schemaStudio/README.md)

### Files of interest

`./src/index.ts`, `./src/collisions/expandedCorpusRunner.ts`, `./src/collisions/listModels.ts`, …and 16 more under `./src/`.

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_FEED_REGISTRY`

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter default-agent-provider docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
