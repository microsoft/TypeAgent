<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=df6d6d34383d262c4ee55858a51f70cef3ed33d8b5d8b89fe045c9dc85c910df -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# browser-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `browser-typeagent` package is a TypeAgent application agent designed for browser automation and control. It enables programmatic interaction with browser windows, tabs, and web pages through a defined set of actions. This package integrates with the TypeAgent shell and CLI, allowing users to perform browser-related tasks using commands or natural language. It also includes a browser extension for enhanced functionality and interaction.

## What it does

The `browser-typeagent` package provides a range of browser automation capabilities, allowing users to interact with web pages and manage browser sessions programmatically. Key features include:

- **Web Navigation**: Actions such as `openWebPage`, `goBack`, `goForward`, and `reloadPage` allow users to navigate between web pages and control browser tabs.
- **User Interaction**: Users can interact with web content using actions like `clickOn`, `followLinkByText`, `scrollDown`, and `scrollUp`.
- **Content Capture and Analysis**: Actions such as `captureScreenshot`, `getHtmlFragments`, and `indexPage` enable users to extract and analyze web content.
- **Tab Management**: Actions like `changeTabs`, `closeWebPage`, and `closeAllWebPages` provide control over browser tabs.
- **Custom Scripts and Search**: Execute custom scripts with `executeAdHocScript` and manage search providers with `changeSearchProvider`.

The package operates through a WebSocket server (`AgentWebSocketServer`) that facilitates communication between the browser agent and its clients. Supported clients include a Chrome extension and the Electron-based TypeAgent shell. These clients can send commands to the browser agent, which executes the requested actions and returns results.

Additionally, the package includes a chat panel for natural language interaction with the browser agent. This panel supports conversation management commands such as `new`, `list`, `info`, `switch`, and `delete`, enabling users to manage multiple conversations and view shared activity across connected clients.

## Setup

To set up the `browser-typeagent` package, follow these steps:

1. **Set Environment Variables**:

   - `BROWSER_WEBSOCKET_PORT`: (Optional) Specify the WebSocket server port for debugging. If not set, the port will be assigned dynamically.
   - `TYPEAGENT_BROWSER_FILES`: Set this variable to the directory containing the browser files required for the agent's operation.

2. **Enable Developer Mode in Your Browser**:

   - Open your browser (e.g., Chrome or Edge).
   - Click on the extensions icon near the address bar and select "Manage extensions."
   - Enable the "Developer mode" toggle on the extensions page.

3. **Build the Extension**:

   - Run `pnpm run build` in the package directory to build the browser extension.

4. **Load the Unpackaged Extension**:

   - Navigate to the "Manage extensions" page in your browser.
   - Click "Load unpackaged extension" and select the `dist/extension` folder in the package directory.

5. **Run the Extension**:
   - Launch the browser where the extension is installed.
   - Start the TypeAgent shell or CLI, which integrates with the extension to send commands.

For more detailed instructions, refer to the hand-written README.

## Key Files

The `browser-typeagent` package is organized into several key files, each responsible for specific functionality:

- **WebSocket Server**:

  - [agentWebSocketServer.mts](./src/agent/agentWebSocketServer.mts): Manages WebSocket connections and routes commands between clients and the browser agent. It supports session-based routing and multiplexing of logical channels (`agentService` and `browserControl`).

- **Action Handlers**:

  - [browserActionHandler.mts](./src/agent/browserActionHandler.mts): Implements the logic for browser actions such as `openWebPage`, `captureScreenshot`, and `indexPage`.
  - [agentServiceHandlers.mts](./src/agent/agentServiceHandlers.mts): Registers RPC handlers for client connections, enabling the execution of browser actions.

- **Session Management**:

  - [browserActions.mts](./src/agent/browserActions.mts): Manages session-specific configurations, such as `sessionId` and client preferences.

- **Indexing and Content Extraction**:

  - [browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts): Provides AI-enhanced indexing capabilities, including content summarization and quality assessment.
  - [browserContentExtractor.mts](./src/agent/browserContentExtractor.mts): Extends content extraction functionality with browser-based downloading.

- **Schemas**:

  - [browserActionSchema.mts](./src/agent/browserActionSchema.mts): Defines the schema for browser actions and their parameters.
  - [browserSchema.agr](./src/agent/browserSchema.agr): Contains the action grammar for the browser agent.

- **Extension Components**:
  - [contentScript/index.ts](./src/extension/contentScript/index.ts): Entry point for the browser extension's content script.
  - [serviceWorker/index.ts](./src/extension/serviceWorker/index.ts): Manages the service worker for the browser extension.

## How to extend

To extend the `browser-typeagent` package, follow these steps:

1. **Identify the Area to Extend**:

   - Determine the functionality you want to add or modify. For example, to add a new browser action, start with [browserActionHandler.mts](./src/agent/browserActionHandler.mts).

2. **Implement the New Feature**:

   - Add the new action logic in the appropriate handler file. Follow the existing patterns for defining actions and integrating them with the WebSocket server.

3. **Update the Schema**:

   - If the new feature requires changes to the action schema, update the relevant schema files in the `src/agent` directory, such as [browserActionSchema.mts](./src/agent/browserActionSchema.mts).

4. **Test the Changes**:

   - Run the TypeAgent shell or CLI and issue commands to verify the new functionality. Ensure that the changes work as expected in both the browser extension and the Electron shell.

5. **Document the Updates**:
   - Update the package documentation to include details about the new feature. Ensure that any new environment variables or setup steps are clearly described.

By following these steps, you can enhance the `browser-typeagent` package to support additional browser automation capabilities.

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
- _…and 291 more under `./src/`._

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `BROWSER_WEBSOCKET_PORT`
- `TYPEAGENT_BROWSER_FILES`

---

_Auto-generated against commit `c97eb42726a9196c7ac72138faa0777c5cbc1aab` on `2026-07-18T09:48:36.613Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
