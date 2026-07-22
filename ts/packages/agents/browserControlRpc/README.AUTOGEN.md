<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=a14dcbb34117af81cd40819bc4f14538ec9bd4d0ff394eef9408cbe674f140b2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/browser-control-rpc — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/browser-control-rpc` package provides browser control types and a content script RPC client for the TypeAgent framework. It facilitates communication between browser agents and other components, enabling actions such as controlling browser tabs, extracting knowledge from web pages, and managing browser settings.

This package is a core part of the TypeAgent ecosystem, supporting browser-related operations and interactions. It is used by other packages like `@typeagent/browser-extension` and `agent-shell` to implement browser automation and data extraction workflows.

## What it does

The package defines a set of types, interfaces, and RPC mechanisms to control browser behavior and facilitate communication between browser agents and other system components. Key capabilities include:

- **Browser Control**: Actions such as `openWebPage`, `closeWebPage`, `goBack`, `goForward`, `reload`, and `zoomIn` allow for programmatic control of browser tabs and navigation.
- **Knowledge Extraction**: Functions like `extractKnowledgeFromPage` and `searchWebMemories` enable the extraction and querying of knowledge from web pages.
- **Content Script RPC**: Provides a client for communicating with content scripts, enabling cross-context messaging between browser extensions and agents.
- **Event Handling**: Defines events such as `connectionStatusChanged` and `knowledgeExtractionProgress` to track the state of browser operations and workflows.
- **HTML Reduction**: Includes utilities for reducing HTML size by removing unnecessary elements and attributes, ensuring compatibility across browser and Node.js contexts.
- **PDF Support**: Defines types and interfaces for managing PDF documents, including annotations, viewer state, and search results.

This package integrates with other TypeAgent components to provide a unified interface for browser-related tasks.

## Setup

No special setup is required for this package beyond installing it as part of the TypeAgent monorepo. Dependencies are managed within the workspace, and the package relies on `@typeagent/agent-rpc` and the external library `dompurify`.

If you are working with this package in isolation, ensure that all workspace dependencies are installed using `pnpm install` from the root of the monorepo.

## Key Files

The package is organized into several key files, each responsible for specific functionality:

- **[browserControl.ts](./src/browserControl.ts)**: Defines the main browser control functions, such as `openWebPage`, `closeWebPage`, and navigation-related actions like `goBack` and `goForward`.
- **[webAgentMessageTypes.ts](./src/webAgentMessageTypes.ts)**: Contains type definitions for messages exchanged between web agents and the dispatcher, including registration, RPC, and disconnection messages.
- **[serviceTypes.ts](./src/serviceTypes.ts)**: Defines agent-side operations for knowledge extraction and querying, such as `extractKnowledgeFromPage` and `searchWebMemories`.
- **[extensionEvents.ts](./src/extensionEvents.ts)**: Specifies the structure of events emitted by the browser extension, such as `connectionStatusChanged` and `settingsUpdated`.
- **[platformServices.ts](./src/platformServices.ts)**: Provides interfaces for platform-specific services like storage, tab management, and WebSocket connection checks.
- **[crossContextHtmlReducer.ts](./src/crossContextHtmlReducer.ts)**: Implements a utility for reducing HTML size, compatible with both browser and Node.js environments.
- **[pdfTypes.ts](./src/pdfTypes.ts)**: Defines types for managing PDF documents, including viewer state, annotations, and search results.
- **[answerEnhancement.ts](./src/answerEnhancement.ts)**: Contains types for answer enhancement, including dynamic summaries and follow-up suggestions.

These files collectively define the package's functionality and serve as the foundation for browser-related operations in the TypeAgent ecosystem.

## How to extend

To extend the functionality of this package, follow these steps:

1. **Understand the Existing Structure**: Start by reviewing the key files mentioned above to understand the current capabilities and patterns used in the package.
2. **Add New Browser Actions**: If you need to add new browser control actions, modify or extend the [browserControl.ts](./src/browserControl.ts) file. Ensure that new actions are well-documented and tested.
3. **Extend Message Types**: To introduce new message types for communication, update [webAgentMessageTypes.ts](./src/webAgentMessageTypes.ts) and ensure compatibility with existing message handlers.
4. **Enhance Knowledge Extraction**: If your changes involve knowledge extraction or querying, extend the relevant functions in [serviceTypes.ts](./src/serviceTypes.ts).
5. **Update Event Handling**: For new events, add definitions to [extensionEvents.ts](./src/extensionEvents.ts) and ensure they are emitted and handled appropriately.
6. **Test Your Changes**: Write unit tests for any new functionality and run the existing test suite to ensure that your changes do not introduce regressions.

By following these steps, you can contribute new features or enhancements to the `@typeagent/browser-control-rpc` package while maintaining consistency with its existing design.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./types` → [./dist/browserControl.js](./dist/browserControl.js)
- `./webAgentMessageTypes` → [./dist/webAgentMessageTypes.js](./dist/webAgentMessageTypes.js)
- `./serviceTypes` → [./dist/serviceTypes.js](./dist/serviceTypes.js)
- `./extensionEvents` → [./dist/extensionEvents.js](./dist/extensionEvents.js)
- `./platformServices` → [./dist/platformServices.js](./dist/platformServices.js)
- `./htmlReducer` → [./dist/crossContextHtmlReducer.js](./dist/crossContextHtmlReducer.js)
- `./pdfTypes` → [./dist/pdfTypes.js](./dist/pdfTypes.js)
- `./answerEnhancement` → [./dist/answerEnhancement.js](./dist/answerEnhancement.js)
- `./contentScriptRpc/types` → [./dist/contentScriptRpc/types.js](./dist/contentScriptRpc/types.js)
- `./contentScriptRpc/client` → [./dist/contentScriptRpc/client.js](./dist/contentScriptRpc/client.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../../packages/agentRpc/README.md)

External: `dompurify`

### Used by

- [@typeagent/browser-extension](../../../packages/agents/browserExtension/README.md)
- [agent-shell](../../../packages/shell/README.md)
- [browser-typeagent](../../../packages/agents/browser/README.md)
- utility-typeagent

### Files of interest

- [./src/answerEnhancement.ts](./src/answerEnhancement.ts)
- [./src/browserControl.ts](./src/browserControl.ts)
- [./src/contentScriptRpc/client.ts](./src/contentScriptRpc/client.ts)
- [./src/contentScriptRpc/types.ts](./src/contentScriptRpc/types.ts)
- [./src/crossContextHtmlReducer.ts](./src/crossContextHtmlReducer.ts)
- [./src/extensionEvents.ts](./src/extensionEvents.ts)
- [./src/pdfTypes.ts](./src/pdfTypes.ts)
- [./src/platformServices.ts](./src/platformServices.ts)
- [./src/serviceTypes.ts](./src/serviceTypes.ts)
- [./src/tsconfig.json](./src/tsconfig.json)
- _…and 1 more under `./src/`._

---

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/browser-control-rpc docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
