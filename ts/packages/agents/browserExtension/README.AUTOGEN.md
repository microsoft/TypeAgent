<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7360c8a69162ca29adfae283a00b78251c11ef4237c974de49e8a00ccf33e9a2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/browser-extension — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/browser-extension` package provides the browser extension for the TypeAgent system, supporting both Chrome/Edge and Electron environments. It enables browser-based agents to perform tasks such as content discovery, indexing, and interaction with web elements. This package is a critical component for integrating browser automation into the broader TypeAgent ecosystem.

## What it does

This package implements a browser extension that integrates with the TypeAgent framework to provide the following capabilities:

- **Content Discovery and Indexing**: Automates the discovery (`autoDiscovery`) and indexing (`autoIndexing`) of web content. These features can be configured to exclude sensitive sites, adjust indexing quality, and focus on specific content types.
- **Web Element Interaction**: Includes utilities for interacting with web elements, such as retrieving bounding boxes of interactive elements, matching elements against patterns, and checking visibility.
- **Agent Activation**: Manages the activation and deactivation of site-specific agents, ensuring the appropriate agent is enabled for the current context.
- **Cross-Environment Compatibility**: Supports both Chrome/Edge and Electron environments, with mechanisms to handle environment-specific differences, such as tab management and API availability.
- **Integration with TypeAgent Ecosystem**: Communicates with other TypeAgent components, such as the dispatcher and agent server, to coordinate actions and share data.

The extension supports a variety of actions, including `autoDiscovery`, `autoIndexing`, and `getInteractiveElementsBoundingBoxes`. These actions are implemented in the content scripts and are triggered based on user interaction or predefined rules.

## Setup

To use this package, follow these steps:

1. **Build the Extension**:

   - Run `pnpm run build` in the package directory to build the extension. The output will be located in the `dist/extension/` folder for Chrome/Edge and `dist/electron/` for Electron.
   - For development purposes, you can use `pnpm run dev` to build the extension in development mode.

2. **Install the Extension in Chrome/Edge**:

   - Enable developer mode in your browser:
     - Open the browser and navigate to the extensions page (e.g., "Manage extensions" in Chrome/Edge).
     - Enable the "Developer mode" toggle.
   - Load the unpacked extension:
     - Click "Load unpacked" on the extensions page.
     - Select the `dist/extension` folder from the package directory.

3. **Run the Extension**:
   - Launch the browser where the extension is installed.
   - Start the TypeAgent shell or CLI, which integrates with the extension to send commands such as opening tabs, navigating to specific pages, and interacting with web content.

For more detailed instructions, refer to the hand-written README.

## Key Files

The source code for this package is organized into several key areas:

### Content Scripts

1. **[autoDiscovery.ts](./src/extension/contentScript/autoDiscovery.ts)**:

   - Manages automatic discovery of web content.
   - Includes settings for discovery mode, sensitive site exclusion, and navigation listeners.

2. **[autoIndexing.ts](./src/extension/contentScript/autoIndexing.ts)**:

   - Handles automatic indexing of web content.
   - Provides configurable settings for indexing quality and scope.

3. **[continuationHandler.ts](./src/extension/contentScript/continuationHandler.ts)**:

   - Manages continuation states and tab-specific data for both Chrome and Electron environments.

4. **[domUtils.ts](./src/extension/contentScript/domUtils.ts)**:

   - Provides utility functions for DOM interaction, such as visibility checks and string matching.

5. **[elementInteraction.ts](./src/extension/contentScript/elementInteraction.ts)**:
   - Retrieves bounding boxes of interactive elements and facilitates interaction with web content.

### Electron-Specific Files

1. **[agentActivation.ts](./src/electron/agentActivation.ts)**:

   - Handles the activation and deactivation of site agents in the Electron environment.

2. **[manifest.json](./src/electron/manifest.json)**:
   - Defines the extension's manifest for Electron, including content scripts and permissions.

### Configuration

1. **[tsconfig.json](./src/electron/tsconfig.json)**:
   - TypeScript configuration for the Electron-specific code.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Identify the Area to Extend**:

   - For new content discovery or indexing features, start with [`autoDiscovery.ts`](./src/extension/contentScript/autoDiscovery.ts) or [`autoIndexing.ts`](./src/extension/contentScript/autoIndexing.ts).
   - For new DOM interaction utilities, add functions to [`domUtils.ts`](./src/extension/contentScript/domUtils.ts) or [`elementInteraction.ts`](./src/extension/contentScript/elementInteraction.ts).

2. **Follow Existing Patterns**:

   - Review the existing code to understand the structure and patterns used for settings management, event listeners, and API integration.
   - Use the `chrome.storage` API for managing settings and the `chrome.runtime` API for communication between content scripts and the background service.

3. **Test Your Changes**:

   - Add unit tests for new functionality where applicable.
   - Test the extension in both Chrome/Edge and Electron environments to ensure compatibility.

4. **Update Documentation**:
   - Document any new actions or features in the hand-written README or other relevant documentation files.
   - Ensure that the deterministic action reference table is updated to reflect new or modified actions.

By following these guidelines, you can effectively contribute to the `@typeagent/browser-extension` package and enhance its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

_No public exports declared in `package.json`._

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/agent-server-client](../../../packages/agentServer/client/README.md)
- [@typeagent/agent-server-protocol](../../../packages/agentServer/protocol/README.md)
- [@typeagent/browser-control-rpc](../../../packages/agents/browserControlRpc/README.md)
- [@typeagent/dispatcher-rpc](../../../packages/dispatcher/rpc/README.md)
- [@typeagent/dispatcher-types](../../../packages/dispatcher/types/README.md)
- [chat-ui](../../../packages/chat-ui/README.md)

External: `@mozilla/readability`, `@popperjs/core`, `bootstrap`, `cytoscape`, `cytoscape-dagre`, `dagre`, `debug`, `dompurify`, `html-to-text`, `markdown-it`, `prismjs`

### Used by

- [agent-shell](../../../packages/shell/README.md)

### Files of interest

`./src/extension/contentScript/continuationHandler.ts`, `./src/extension/contentScript/index.ts`, `./src/extension/contentScript/recording/index.ts`, …and 118 more under `./src/`.

---

_Auto-generated against commit `8f591da77983db53fd4a3e0ca12b58d80aaa3628` on `2026-07-22T20:55:48.144Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/browser-extension docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
