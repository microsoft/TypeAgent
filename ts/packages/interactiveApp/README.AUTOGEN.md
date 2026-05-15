<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f6baae4283fcd31afbadcda07fd42a0e606bdf995e850cf2c8068a012acedcf4 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# interactive-app — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `interactiveApp` package is a TypeScript library designed for writing console applications with terminal UI features. It is primarily used as sample code within the TypeAgent examples and is not intended for other uses.

## What it does

The `interactiveApp` package provides a set of tools and utilities to create interactive console applications. It includes features for handling command-line inputs, managing IO streams, and enhancing terminal UI with elements like spinners, separators, and structured layouts. The package supports actions such as `createMessage`, `deleteMessage`, `updateMessage`, and `listMessages`, which facilitate various interactive functionalities within the console applications.

## Setup

This package does not require any special setup beyond installing its dependencies. Simply run `pnpm install` to install the necessary packages. For detailed setup instructions, refer to the hand-written README.

## Key Files

The `interactiveApp` package is structured into several key modules:

- **[index.ts](./src/index.ts)**: The entry point of the package, exporting functionalities from other modules.
- **[core.ts](./src/core.ts)**: Contains core utilities such as the `StopWatch` class for performance measurements.
- **[interactiveApp.ts](./src/interactiveApp.ts)**: Defines the main interactive application settings and input handling mechanisms.
- **[InteractiveIo.ts](./src/InteractiveIo.ts)**: Manages standard IO streams and provides utility functions for interactive IO operations.
- **[terminalUI.ts](./src/terminalUI.ts)**: Enhances terminal UI with features like spinners, separators, and structured layouts.

### Detailed File Responsibilities

- **[index.ts](./src/index.ts)**: This file serves as the main entry point, re-exporting functionalities from other modules to provide a unified interface.
- **[core.ts](./src/core.ts)**: Implements core utilities, including the `StopWatch` class, which is used for performance measurements and timing operations within the console applications.
- **[interactiveApp.ts](./src/interactiveApp.ts)**: Contains the main settings and input handling mechanisms for interactive applications. It defines types such as `InputHandler` and `InteractiveAppSettings` to manage command-line inputs and application behavior.
- **[InteractiveIo.ts](./src/InteractiveIo.ts)**: Manages standard IO streams and provides utility functions for interactive IO operations. It includes the `InteractiveIo` type and functions like `getInteractiveIO` and `createInteractiveIO` to initialize and manage IO streams.
- **[terminalUI.ts](./src/terminalUI.ts)**: Enhances terminal UI with features like spinners, separators, and structured layouts. It includes utilities for handling ANSI escape codes and functions like `getDisplayWidth` and `padEndDisplay` to manage terminal output formatting.

## How to extend

To extend the `interactiveApp` package, follow these steps:

1. **Start with the entry point**: Open the [index.ts](./src/index.ts) file to understand the exported functionalities.
2. **Explore core utilities**: Check the [core.ts](./src/core.ts) file for essential utilities like the `StopWatch` class.
3. **Modify interactive settings**: Look into the [interactiveApp.ts](./src/interactiveApp.ts) file to customize the interactive application settings and input handlers.
4. **Enhance IO operations**: Review the [InteractiveIo.ts](./src/InteractiveIo.ts) file to manage IO streams and add new IO functionalities.
5. **Improve terminal UI**: Examine the [terminalUI.ts](./src/terminalUI.ts) file to add or modify terminal UI features.

To test your changes, run the existing tests or add new ones to ensure the extended functionalities work as expected.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace: _None._

External: `string-width`

### Used by

- [agent-cli](../../packages/cli/README.md)
- [chat-example](../../examples/chat/README.md)
- [document-processor](../../examples/docuProc/README.md)
- [examples-lib](../../examples/examplesLib/README.md)
- [knowpro-test](../../packages/knowProTest/README.md)
- [memory-mcp](../../examples/mcpMemory/README.md)
- [playground](../../examples/playground/README.md)
- [schema-studio](../../examples/schemaStudio/README.md)
- [search-action-test](../../examples/searchActionTest/README.md)
- [telemetry-query-example](../../examples/commandHistogram/README.md)

### Files of interest

`./src/index.ts`, `./src/core.ts`, `./src/interactiveApp.ts`, …and 3 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter interactive-app docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
