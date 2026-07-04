<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=51eeac4276bc5d41d8d8f8c2458c6081a58be8702259d9bd943a374144701c31 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# browser-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `browser-typeagent` package is a TypeAgent application agent designed for browser automation and control. It enables interaction with browser windows, tabs, and web pages through a set of predefined actions. This package integrates with other components in the TypeAgent ecosystem, such as the TypeAgent shell and CLI, to provide a cohesive browser automation experience.

## What it does

The `browser-typeagent` package provides a comprehensive set of actions for controlling and automating browser behavior. These actions include:

- **Navigation and Tab Management**: Actions like `openWebPage`, `closeWebPage`, `goBack`, `goForward`, `scrollDown`, `scrollUp`, and `changeTabs` allow for opening, closing, and navigating between browser tabs and web pages.
- **Content Interaction**: Actions such as `clickOn`, `followLinkByText`, `followLinkByPosition`, and `readPageContent` enable interaction with web page elements and content.
- **Content Extraction and Analysis**: Actions like `captureScreenshot`, `getHtmlFragments`, and `indexPage` allow for capturing and analyzing web page content, including AI-enhanced indexing and knowledge extraction.
- **Browser Control**: Actions such as `zoomIn`, `zoomOut`, `zoomReset`, and `reloadPage` provide control over the browser's display and functionality.

The package uses a WebSocket server (`AgentWebSocketServer`) to facilitate communication between the browser agent and its clients. Supported clients include a Chrome extension and the Electron-based TypeAgent shell. The WebSocket server supports multiple concurrent sessions, with each session isolated by a unique `sessionId`.

## Setup

To set up the `browser-typeagent` package, follow these steps:

1. **Configure Environment Variables**:

   - `BROWSER_WEBSOCKET_PORT`: Set this variable to specify the port for the WebSocket server. If not set, the port will be assigned dynamically by the operating system.
   - `TYPEAGENT_BROWSER_FILES`: Set this variable to the directory containing the browser files required for the agent's operation.

2. **Enable Developer Mode in Your Browser**:

   - For Chrome or Edge:
     - Launch the browser.
     - Click on the extensions icon next to the address bar and select "Manage extensions."
     - Enable the "Developer mode" toggle on the extensions page.

3. **Build the Extension**:

   - Run `pnpm run build` in the package folder to build the browser extension.

4. **Load the Unpackaged Extension**:

   - Navigate to the "Manage extensions" page in your browser.
   - Click on "Load unpackaged extension" and select the `dist/extension` folder of the browser extension package.

5. **Run the Extension**:
   - Launch the browser where the extension is installed.
   - Start the TypeAgent shell or CLI, which integrates with the extension to send commands. You can issue commands such as `openWebPage`, `scrollDown`, or `captureScreenshot` from the shell or CLI.

For additional details, refer to the hand-written README.

## Key Files

The `browser-typeagent` package is organized into several key files, each responsible for specific functionality:

- **browserActionHandler.ts**: Implements the core browser actions, such as `openWebPage`, `clickOn`, and `captureScreenshot`. This file is central to defining and handling browser-related commands.
- **[agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts)**: Manages WebSocket connections and routes client requests to the appropriate session and handlers. It supports multiple concurrent sessions and client types.
- **[browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts)**: Provides AI-enhanced indexing capabilities, including content summarization and quality assessment for web pages.
- **[browserActionSchema.mts](./src/agent/browserActionSchema.mts)**: Defines the schema for browser actions, including their parameters and expected behavior.
- **[browserContentExtractor.mts](./src/agent/browserContentExtractor.mts)**: Handles content extraction from web pages, supporting both standard HTML extraction and browser-based downloading.
- **[crossContextHtmlReducer.ts](./src/common/crossContextHtmlReducer.ts)**: Optimizes HTML content by removing unnecessary elements and attributes, reducing its size for efficient processing.

## How to extend

To extend the functionality of the `browser-typeagent` package, follow these steps:

1. **Identify the Relevant File**:

   - Determine which file corresponds to the functionality you want to modify or extend. For example:
     - To add a new browser action, start with browserActionHandler.ts.
     - To modify WebSocket behavior, refer to [agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts).

2. **Implement the New Feature**:

   - Follow the existing patterns in the codebase to implement your changes. For example:
     - Add a new action handler in browserActionHandler.ts.
     - Update the action schema in [browserActionSchema.mts](./src/agent/browserActionSchema.mts) to define the parameters and behavior of the new action.

3. **Update Session and Client Management**:

   - If your changes involve session-specific behavior, ensure that the `sessionId` is properly handled in the `AgentWebSocketServer` and related files.
   - If your changes involve new client types or roles, update the client type detection logic in [agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts).

4. **Test Your Changes**:

   - Use the TypeAgent shell or CLI to test the new functionality. Issue commands to verify that the new feature works as expected.

5. **Document Your Changes**:
   - Update the package's documentation to include details about the new feature or action. Ensure that any new environment variables or setup steps are clearly described.

By following these steps, you can effectively extend the `browser-typeagent` package to support additional browser automation capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-04T08:54:09.388Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
