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

The `browser-typeagent` package provides a variety of actions to control and automate browser behavior. These actions include:

- **Navigation and Interaction**: Actions like `openWebPage`, `goBack`, `goForward`, `scrollDown`, `scrollUp`, and `followLinkByText` allow for navigating and interacting with web pages.
- **Content Extraction**: Actions such as `getHtmlFragments` and `readPageContent` enable the extraction of content from web pages for further processing.
- **Browser Management**: Actions like `closeWebPage`, `closeAllWebPages`, `changeTabs`, and `reloadPage` allow for managing browser tabs and sessions.
- **Visual Operations**: Actions such as `captureScreenshot`, `zoomIn`, `zoomOut`, and `zoomReset` provide tools for visual manipulation of the browser interface.
- **Search and Indexing**: Actions like `SearchImageAction` and `indexPage` enable advanced search and indexing capabilities, including AI-enhanced content analysis.

The package communicates with clients, such as browser extensions and the Electron shell, via WebSocket connections. It supports multiple concurrent sessions, each with its own set of handlers and configurations, enabling flexible and isolated browser automation workflows.

## Setup

To set up the `browser-typeagent` package, follow these steps:

1. **Configure Environment Variables**:

   - `BROWSER_WEBSOCKET_PORT`: Set this variable to specify the port for the WebSocket server. This is useful for debugging or when a fixed port is required.
   - `TYPEAGENT_BROWSER_FILES`: Set this variable to the directory containing the browser files required for the agent's operation.

2. **Enable Developer Mode in Your Browser**:

   - For Chrome or Edge:
     - Open the browser.
     - Click on the extensions icon near the address bar and select "Manage extensions."
     - Enable the "Developer mode" toggle on the extensions page.

3. **Build the Extension**:

   - Run `pnpm run build` in the package directory to build the browser extension.

4. **Load the Unpackaged Extension**:

   - Navigate to the "Manage extensions" page in your browser.
   - Click "Load unpackaged extension" and select the `dist/extension` folder from the `browser-typeagent` package.

5. **Run the Extension**:
   - Launch the browser where the extension is installed.
   - Start the TypeAgent shell or CLI, which integrates with the extension to send commands for browser automation.

For additional details, refer to the hand-written README.

## Key Files

The `browser-typeagent` package is organized into several key files, each responsible for specific functionalities:

- **browserActionHandler.ts**: Implements handlers for browser actions such as `openWebPage`, `captureScreenshot`, and `clickOn`. This is a central file for defining and managing browser-related actions.
- **[agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts)**: Manages WebSocket connections and routes client requests to the appropriate session and handler. It supports multiple concurrent sessions and client types.
- **[browserIndexingService.ts](./src/agent/indexing/browserIndexingService.ts)**: Provides AI-enhanced indexing capabilities, including content summarization and quality assessment for web pages.
- **[browserActionSchema.mts](./src/agent/browserActionSchema.mts)**: Defines the schema for browser actions, including their parameters and expected behavior.
- **[browserActions.mts](./src/agent/browserActions.mts)**: Contains the core logic for browser actions, including session management, client type detection, and browser control.
- **[browserContentExtractor.mts](./src/agent/browserContentExtractor.mts)**: Extends content extraction capabilities with browser-based downloading and processing.

## How to extend

To extend the `browser-typeagent` package, follow these steps:

1. **Identify the Relevant File**:

   - Determine which file corresponds to the functionality you want to modify or extend. For example:
     - To add a new browser action, start with browserActionHandler.ts.
     - To modify WebSocket behavior, look into [agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts).

2. **Implement the New Feature**:

   - Follow the existing patterns in the codebase to implement your changes. For example:
     - Add new action handlers in browserActionHandler.ts.
     - Update the action schema in [browserActionSchema.mts](./src/agent/browserActionSchema.mts) to define new actions and their parameters.

3. **Update Session Management**:

   - If your changes involve session-specific behavior, ensure that the new functionality integrates with the session management system. This may involve updating `BrowserActionContext` or modifying session registration in [agentWebSocketServer.ts](./src/agent/agentWebSocketServer.mts).

4. **Test Your Changes**:

   - Use the TypeAgent shell or CLI to test the new functionality. Issue commands that trigger the new actions or features and verify their behavior.

5. **Document Your Changes**:
   - Update the package's documentation to include details about the new actions or features. Ensure that any new environment variables or setup steps are clearly documented.

By following these guidelines, you can effectively extend the `browser-typeagent` package to support additional browser automation capabilities.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter browser-typeagent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
