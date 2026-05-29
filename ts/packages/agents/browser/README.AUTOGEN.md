<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=fb2ea14bbc3513682d42cfa748e749678f29b5ce5803da947f3498a7c78aa2ea -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# browser-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `browser-typeagent` package is a TypeAgent application agent designed to control and automate browser actions. It enables the manipulation of browser windows, tabs, and web pages through a set of defined actions. This package is part of the TypeAgent monorepo and integrates with other TypeAgent components to provide a comprehensive browser automation solution.

## What it does

The `browser-typeagent` package provides a range of actions for browser control and automation. These actions include `openWebPage`, `indexPage`, `clickOn`, `captureScreenshot`, `getHtmlFragments`, and more. The package allows for the opening, closing, and navigation of browser tabs, scrolling, zooming, and interacting with web pages. It also supports enhanced website indexing with knowledge extraction capabilities.

The package interacts with other parts of the TypeAgent system, such as the TypeAgent shell and CLI, to receive commands and execute browser actions. It uses WebSocket connections to communicate with clients, including browser extensions and the Electron shell.

## Setup

To set up the `browser-typeagent` package, you need to configure the following environment variables:

- `BROWSER_WEBSOCKET_PORT`: This variable allows you to pin the WebSocket server port for debugging. Set it to a specific port number before launching the host.
- `TYPEAGENT_BROWSER_FILES`: This variable should point to the directory containing the browser files required for the agent's operation.

Additionally, you need to enable developer mode in your browser and load the unpackaged extension. The steps are as follows:

1. Enable developer mode in your browser (Chrome or Edge):
   - Launch the browser.
   - Click on the extensions icon next to the address bar and select "Manage extensions."
   - Enable the developer mode toggle on the extensions page.

2. Build the extension by running `pnpm run build` in the package folder.

3. Load the unpackaged extension:
   - Go to the "Manage extensions" page.
   - Click on "Load unpackaged extension" and navigate to the `dist/extension` folder of the browser extension package.

For detailed setup instructions, see the hand-written README.

## Key Files

The `browser-typeagent` package is structured into several key components:

- **Agent WebSocket Server**: Exposes a WebSocket server (`AgentWebSocketServer`) on a dynamically assigned port, allowing clients to connect and communicate with the browser agent. Clients include the Chrome extension and the Electron shell.

- **Session Management**: Supports multiple concurrent sessions by registering handlers under unique `sessionId` keys. The session ID is stored in `BrowserActionContext.sessionId` and is set during context initialization.

- **Client Type Detection**: Differentiates between `extension` and `electron` clients based on their `clientId`. Commands are routed to the active client based on the `preferredClientType`.

- **Channel Multiplexing**: Uses `@typeagent/agent-rpc` to multiplex client connections into two logical channels: `agentService` for invoking browser agent actions and `browserControl` for controlling the browser.

- **Client Storage Model**: Stores connected clients in a nested `Map<sessionId, Map<clientId, BrowserClient>>`, allowing the same `clientId` to exist simultaneously in multiple sessions without collision.

Key files and their responsibilities include:

- browserActionHandler.ts: Handles browser actions such as opening web pages and capturing screenshots.
- agentWebSocketServer.ts: Manages WebSocket connections and client routing.
- [browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts): Provides AI-enhanced indexing with content summarization and quality assessment.
- [crossContextHtmlReducer.ts](./src/common/crossContextHtmlReducer.ts): Reduces HTML size by removing unnecessary elements and attributes.

## How to extend

To extend the `browser-typeagent` package, follow these steps:

1. Open the relevant file based on the functionality you want to add or modify. For example, to add a new browser action, start with browserActionHandler.ts.

2. Implement the new action or feature following the existing patterns. Ensure that the new functionality integrates with the WebSocket server and session management.

3. Update the action schema if necessary. The schema files are located in the `src/agent` directory, such as [browserActionSchema.json](./src/agent/browserActionSchema.json).

4. Test the new functionality by running the TypeAgent shell or CLI and issuing commands to verify the behavior.

5. Document the new actions and features in the package's README and ensure that the environment variables and setup instructions are updated accordingly.

By following these steps, you can extend the capabilities of the `browser-typeagent` package and integrate new browser automation features.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/manifest.json](./src/agent/manifest.json)
- `./agent/handlers` → [./dist/agent/browserActionHandler.mjs](./dist/agent/browserActionHandler.mjs)
- `./agent/types` → [./dist/common/browserControl.mjs](./dist/common/browserControl.mjs)
- `./agent/indexing` → [./dist/agent/indexing/browserIndexingService.js](./dist/agent/indexing/browserIndexingService.js)
- `./contentScriptRpc/types` → [./dist/common/contentScriptRpc/types.mjs](./dist/common/contentScriptRpc/types.mjs)
- `./contentScriptRpc/client` → [./dist/common/contentScriptRpc/client.mjs](./dist/common/contentScriptRpc/client.mjs)
- `./htmlReducer` → [./dist/common/crossContextHtmlReducer.js](./dist/common/crossContextHtmlReducer.js)

### Dependencies

Workspace:

- [@typeagent/action-schema](../../../packages/actionSchema/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [aiclient](../../../packages/aiclient/README.md)
- [azure-ai-foundry](../../../packages/azure-ai-foundry/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- taskflow-typeagent
- [textpro](../../../packages/textPro/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [website-memory](../../../packages/memory/website/README.md)
- [websocket-utils](../../../packages/utils/webSocketUtils/README.md)

External: `@anthropic-ai/claude-agent-sdk`, `@mozilla/readability`, `@popperjs/core`, `bootstrap`, `chalk`, `cheerio`, `cytoscape`, `cytoscape-dagre`, `dagre`, `debug`, `dompurify`, `express`, `express-rate-limit`, `graphology`, `graphology-communities-louvain`, `graphology-layout`, `graphology-layout-forceatlas2`, `graphology-layout-noverlap`, `graphology-types`, `html-to-text`

_…and 17 more not shown._

### Used by

- [agent-shell](../../../packages/shell/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)
- utility-typeagent

### Files of interest

- [./src/agent/manifest.json](./src/agent/manifest.json)
- [./src/agent/browserKnowledgeSchema.ts](./src/agent/browserKnowledgeSchema.ts)
- [./src/agent/browserSchema.agr](./src/agent/browserSchema.agr)
- [./src/agent/indexing/index.mts](./src/agent/indexing/index.mts)
- [./src/agent/webFlows/index.mts](./src/agent/webFlows/index.mts)
- [./src/extension/contentScript/continuationHandler.ts](./src/extension/contentScript/continuationHandler.ts)
- [./src/extension/contentScript/index.ts](./src/extension/contentScript/index.ts)
- [./src/extension/contentScript/recording/index.ts](./src/extension/contentScript/recording/index.ts)
- [./src/extension/serviceWorker/index.ts](./src/extension/serviceWorker/index.ts)
- [./src/extension/webagent/crossword/crosswordSchema.agr](./src/extension/webagent/crossword/crosswordSchema.agr)
- _…and 285 more under `./src/`._

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `BROWSER_WEBSOCKET_PORT`
- `TYPEAGENT_BROWSER_FILES`

---

_Auto-generated against commit `bc2dc7df084977bc3da24a9398fd3a08d55c3e7e` on `2026-05-29T04:54:39.413Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
