<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4ef4e951234553ff94ac76964297bae10ec20ec4b35c9f0d7ec8502f00dbea61 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# browser-typeagent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `browser-typeagent` package is a TypeAgent application agent designed to enable browser automation, web content interaction, and knowledge extraction. It serves as the core browser agent in the TypeAgent ecosystem, facilitating tasks such as web navigation, content indexing, and search-based answer generation. The package integrates with the TypeAgent shell, CLI, and browser extensions, providing a unified interface for browser-related actions.

## What it does

The `browser-typeagent` package provides a comprehensive set of browser automation and interaction capabilities. These include:

- **Web Navigation**: Actions like `openWebPage`, `goBack`, `goForward`, and `reloadPage` allow users to navigate web pages and control browser tabs.
- **User Interaction**: Perform actions such as `clickOn`, `followLinkByText`, `scrollDown`, and `scrollUp` to interact with web content.
- **Content Capture and Analysis**: Extract and analyze web content using actions like `captureScreenshot`, `getHtmlFragments`, and `indexPage`.
- **Tab Management**: Manage browser tabs with actions such as `changeTabs`, `closeWebPage`, and `closeAllWebPages`.
- **Custom Scripts and Search**: Execute custom scripts with `executeAdHocScript` and manage search providers using `changeSearchProvider`.
- **Internet Lookup**: The `lookupAndAnswerInternet` action enables users to answer general web queries by either driving a real browser or leveraging Azure AI Search for server-side knowledge retrieval.

The agent operates through a WebSocket server (`AgentWebSocketServer`) that facilitates communication between the browser agent and its clients. Supported clients include a Chrome/Edge extension and the Electron-based TypeAgent shell. These clients send commands to the browser agent, which executes the requested actions and returns results.

The package also supports natural language interaction through a chat panel, enabling users to manage conversations and perform browser-related tasks using conversational commands.

## Setup

To set up the `browser-typeagent` package, follow these steps:

1. **Set Environment Variables**:

   - `BROWSER_WEBSOCKET_PORT`: (Optional) Specify the WebSocket server port for debugging. If not set, the port will be assigned dynamically.
   - `TYPEAGENT_BROWSER_FILES`: Set this variable to the directory containing the browser files required for the agent's operation.

2. **Build the Package**:

   - Run `pnpm run build` in the package directory. This will build the agent, including the browser extension, Puppeteer helpers, and other components.

3. **Browser Extension Setup**:

   - Open your browser (e.g., Chrome or Edge).
   - Enable "Developer mode" in the browser's extensions settings.
   - Load the unpackaged extension by selecting the `dist/extension` folder in the package directory.

4. **Run the Agent**:
   - Start the TypeAgent shell or CLI, which integrates with the browser agent to send commands.

For additional details, refer to the hand-written README.

## Key Files

The `browser-typeagent` package is organized into several key files, each responsible for specific functionalities:

- **WebSocket Server**:

  - [src/agent/agentWebSocketServer.mts](./src/agent/agentWebSocketServer.mts): Manages WebSocket connections and routes commands between clients and the browser agent. It supports session-based routing and multiplexing of logical channels (`agentService` and `browserControl`).

- **Action Handlers**:

  - [src/agent/browserActionHandler.mts](./src/agent/browserActionHandler.mts): Implements the logic for browser actions such as `openWebPage`, `captureScreenshot`, and `indexPage`.
  - [src/agent/agentServiceHandlers.mts](./src/agent/agentServiceHandlers.mts): Registers RPC handlers for client connections, enabling the execution of browser actions.

- **Session Management**:

  - [src/agent/browserActions.mts](./src/agent/browserActions.mts): Manages session-specific configurations, such as `sessionId` and client preferences.

- **Indexing and Content Extraction**:

  - [src/agent/indexing/browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts): Provides AI-enhanced indexing capabilities, including content summarization and quality assessment.
  - [src/agent/browserContentExtractor.mts](./src/agent/browserContentExtractor.mts): Extends content extraction functionality with browser-based downloading.

- **Schemas**:

  - [src/agent/browserActionSchema.mts](./src/agent/browserActionSchema.mts): Defines the schema for browser actions and their parameters.
  - [src/agent/browserSchema.agr](./src/agent/browserSchema.agr): Contains the action grammar for the browser agent.

- **Extension Components**:
  - `src/extension/contentScript/index.ts`: Entry point for the browser extension's content script.
  - `src/extension/serviceWorker/index.ts`: Manages the service worker for the browser extension.

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
- `./agent/indexing` → [./dist/agent/indexing/browserIndexingService.js](./dist/agent/indexing/browserIndexingService.js)

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
- [@typeagent/browser-control-rpc](../../../packages/agents/browserControlRpc/README.md)
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

External: `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `chalk`, `cheerio`, `debug`, `dompurify`, `express`, `express-rate-limit`, `graphology`, `graphology-communities-louvain`, `graphology-layout`, `graphology-layout-forceatlas2`, `graphology-layout-noverlap`, `graphology-types`, `html-to-text`, `jsdom`, `jsonpath`, `pdfjs-dist`, `puppeteer`, `puppeteer-extra`

_…and 10 more not shown._

### Used by

- [agent-shell](../../../packages/shell/README.md)
- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

- [./src/agent/manifest.json](./src/agent/manifest.json)
- [./src/agent/browserKnowledgeSchema.ts](./src/agent/browserKnowledgeSchema.ts)
- [./src/agent/browserSchema.agr](./src/agent/browserSchema.agr)
- [./src/agent/indexing/index.mts](./src/agent/indexing/index.mts)
- [./src/agent/webFlows/index.mts](./src/agent/webFlows/index.mts)
- [./src/puppeteer/index.mts](./src/puppeteer/index.mts)
- [./src/agent/agentServiceHandlers.mts](./src/agent/agentServiceHandlers.mts)
- [./src/agent/agentWebSocketServer.mts](./src/agent/agentWebSocketServer.mts)
- [./src/agent/browserActionHandler.mts](./src/agent/browserActionHandler.mts)
- [./src/agent/browserActions.mts](./src/agent/browserActions.mts)
- _…and 161 more under `./src/`._

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `BROWSER_WEBSOCKET_PORT`
- `TYPEAGENT_BROWSER_FILES`

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
