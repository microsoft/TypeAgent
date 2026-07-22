<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=3846c3ab0fbb0da60b9177daab779a1dd5667e6ecb0c5630531542065b3ad512 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/browser-extension — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/browser-extension` package provides the browser extension implementation for the TypeAgent system, supporting both Chrome and Electron environments. It enables automation of browser actions, interaction with web content, and integration with the broader TypeAgent ecosystem. This package is a key component for enabling browser-based agents to perform tasks such as content discovery, indexing, and interaction.

## What it does

This package implements a browser extension that integrates with the TypeAgent framework. It supports the following capabilities:

- **Content Discovery and Indexing**: The extension includes features for automatic discovery (`autoDiscovery`) and indexing (`autoIndexing`) of web content. These features can be configured to exclude sensitive sites, adjust indexing quality, and focus on specific content types.
- **Content Interaction**: The extension provides utilities for interacting with web elements, such as retrieving bounding boxes of interactive elements, matching elements against patterns, and checking visibility.
- **Agent Activation**: The extension manages the activation and deactivation of site-specific agents, ensuring that the appropriate agent is enabled for the current context.
- **Cross-Environment Support**: The extension is designed to work in both Chrome and Electron environments, with mechanisms to handle environment-specific differences, such as tab management and API availability.
- **Integration with TypeAgent Ecosystem**: The extension communicates with other TypeAgent components, such as the dispatcher and agent server, to coordinate actions and share data.

The extension supports a variety of actions, including `autoDiscovery`, `autoIndexing`, and `getInteractiveElementsBoundingBoxes`. These actions are implemented in the content scripts and are triggered based on user interaction or predefined rules.

## Setup

To use this package, ensure the following setup steps are completed:

1. **Environment Variables**: No specific environment variables are required for this package.
2. **Browser Extension Installation**: The extension must be built and installed in the target browser (e.g., Chrome or Electron). Refer to the build and installation instructions in the hand-written README for details.
3. **Dependencies**: The package relies on several internal and external dependencies, such as `@typeagent/agent-sdk`, `@mozilla/readability`, and `dompurify`. These dependencies are managed automatically during the build process.

## Key Files

The package's source code is organized into several key areas:

- **Content Scripts**:

  - [`autoDiscovery.ts`](./src/extension/contentScript/autoDiscovery.ts): Manages automatic discovery of web content, including settings management and navigation listeners.
  - [`autoIndexing.ts`](./src/extension/contentScript/autoIndexing.ts): Handles automatic indexing of web content, with configurable settings for quality and scope.
  - [`continuationHandler.ts`](./src/extension/contentScript/continuationHandler.ts): Manages continuation states and tab-specific data for both Chrome and Electron environments.
  - [`domUtils.ts`](./src/extension/contentScript/domUtils.ts): Provides utility functions for DOM interaction, such as visibility checks and string matching.
  - [`elementInteraction.ts`](./src/extension/contentScript/elementInteraction.ts): Retrieves bounding boxes of interactive elements and facilitates interaction with web content.

- **Electron-Specific Files**:

  - [`agentActivation.ts`](./src/electron/agentActivation.ts): Handles the activation and deactivation of site agents in the Electron environment.
  - [`manifest.json`](./src/electron/manifest.json): Defines the extension's manifest for Electron, including content scripts and permissions.

- **Configuration**:
  - [`tsconfig.json`](./src/electron/tsconfig.json): TypeScript configuration for the Electron-specific code.

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
   - Test the extension in both Chrome and Electron environments to ensure compatibility.

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

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/browser-extension docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
