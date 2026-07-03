<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=51eeac4276bc5d41d8d8f8c2458c6081a58be8702259d9bd943a374144701c31 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# browser-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `browser-typeagent` package is a TypeAgent application agent designed for browser automation and control. It enables interaction with browser windows, tabs, and web pages through a defined set of actions. This package integrates with other components in the TypeAgent ecosystem, such as the TypeAgent shell and CLI, to provide a unified interface for browser-related tasks.

## What it does

The `browser-typeagent` package supports a variety of browser automation actions, including:

- Navigating to web pages (`openWebPage`, `goBack`, `goForward`, `reloadPage`).
- Interacting with web content (`clickOn`, `followLinkByText`, `scrollDown`, `scrollUp`).
- Capturing and extracting information (`captureScreenshot`, `getHtmlFragments`, `indexPage`).
- Managing browser tabs (`changeTabs`, `closeWebPage`, `closeAllWebPages`).
- Performing advanced tasks like executing scripts (`executeAdHocScript`) and indexing websites with AI-enhanced knowledge extraction.

The package communicates with clients, such as a browser extension or the Electron shell, via WebSocket connections. It uses `@typeagent/agent-rpc` to multiplex these connections into logical channels for invoking browser actions and controlling the browser.

## Setup

To set up the `browser-typeagent` package, follow these steps:

1. **Environment Variables**:

   - `BROWSER_WEBSOCKET_PORT`: Set this variable to specify the WebSocket server port for debugging. If not set, the port is dynamically assigned.
   - `TYPEAGENT_BROWSER_FILES`: This variable should point to the directory containing the browser files required for the agent's operation.

2. **Browser Extension**:

   - Enable developer mode in your browser:
     - For Chrome or Edge, go to the extensions page by clicking the extensions icon near the address bar and selecting "Manage extensions."
     - Enable the "Developer mode" toggle.
   - Build the extension by running `pnpm run build` in the package directory.
   - Load the unpackaged extension:
     - On the extensions page, click "Load unpackaged extension" and select the `dist/extension` folder.

3. **Running the Extension**:
   - Launch the browser where the extension is installed.
   - Start the TypeAgent shell or CLI, which integrates with the extension to send commands. You can issue commands such as `openWebPage`, `scrollDown`, or `captureScreenshot` to interact with the browser.

For additional details, refer to the hand-written README.

## Key Files

The `browser-typeagent` package is organized into several key files, each responsible for specific functionality:

- **browserActionHandler.ts**: Implements handlers for browser actions like `openWebPage`, `captureScreenshot`, and `indexPage`.
- **[agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts)**: Manages WebSocket connections, session routing, and client communication.
- **[browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts)**: Provides AI-enhanced website indexing and knowledge extraction.
- **[browserActionSchema.mts](./src/agent/browserActionSchema.mts)**: Defines the schema for browser actions, including their parameters and expected behavior.
- **[browserActions.mts](./src/agent/browserActions.mts)**: Contains the core logic for executing browser actions and managing browser state.
- **[browserContentExtractor.mts](./src/agent/browserContentExtractor.mts)**: Extends content extraction capabilities with browser-based downloading and processing.

## How to extend

To extend the `browser-typeagent` package, follow these steps:

1. **Identify the Area to Extend**:

   - For new browser actions, start with browserActionHandler.ts.
   - For changes to the WebSocket server or client communication, modify [agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts).
   - To update the action schema, edit [browserActionSchema.mts](./src/agent/browserActionSchema.mts).

2. **Implement the Changes**:

   - Follow the existing patterns in the codebase to ensure consistency.
   - For new actions, define the action schema and implement the corresponding handler.

3. **Update the Schema**:

   - If your changes involve new actions or parameters, update the schema files in the `src/agent` directory.

4. **Test Your Changes**:

   - Use the TypeAgent shell or CLI to test the new functionality. Issue commands to verify the behavior of the added or modified features.

5. **Document the Changes**:
   - Update the package's documentation to reflect the new functionality, including any changes to setup instructions or environment variables.

By following these steps, you can add new capabilities to the `browser-typeagent` package while maintaining compatibility with the existing system.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/agent/manifest.json](./src/agent/manifest.json)
- `./agent/handlers` → `./dist/agent/browserActionHandler.mjs` _(not found on disk)_
- `./agent/types` → `./dist/common/browserControl.mjs` _(not found on disk)_
- `./agent/indexing` → `./dist/agent/indexing/browserIndexingService.js` _(not found on disk)_
- `./contentScriptRpc/types` → `./dist/common/contentScriptRpc/types.mjs` _(not found on disk)_
- `./contentScriptRpc/client` → `./dist/common/contentScriptRpc/client.mjs` _(not found on disk)_
- `./htmlReducer` → `./dist/common/crossContextHtmlReducer.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema](../../../packages/actionSchema/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-flows](../../../packages/agent-flows/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/aiclient](../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../packages/utils/commonUtils/README.md)
- [@typeagent/config](../../../packages/config/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)
- [azure-ai-foundry](../../../packages/azure-ai-foundry/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)
- [conversation-memory](../../../packages/memory/conversation/README.md)
- [knowledge-processor](../../../packages/knowledgeProcessor/README.md)
- [knowpro](../../../packages/knowPro/README.md)
- taskflow-typeagent
- [textpro](../../../packages/textPro/README.md)
- [typeagent](../../../packages/typeagent/README.md)
- [website-memory](../../../packages/memory/website/README.md)
- [websocket-channel-server](../../../packages/utils/webSocketChannelServer/README.md)

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
- _…and 284 more under `./src/`._

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `BROWSER_WEBSOCKET_PORT`
- `TYPEAGENT_BROWSER_FILES`

---

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
