<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=583b72ed4f29705d8ce0f43932d5b055194784d53b11e22ad33cc1da4639deae -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# interactive-app — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `interactiveApp` package is a TypeScript library for building console applications with terminal UI features. It is primarily used as sample code in the TypeAgent examples and is not intended for general-purpose use. The library provides utilities for handling command-line inputs, managing IO streams, and enhancing terminal interfaces with features like spinners, separators, and structured layouts.

## What it does

The `interactiveApp` package enables the creation of interactive console applications by providing:

- **Input Handling**: Tools for managing command-line inputs, including support for commands, multi-line input, and custom input handlers.
- **Interactive IO Management**: Utilities for managing standard input/output streams and providing a higher-level interface for console interactions.
- **Terminal UI Enhancements**: Features for improving the user experience in terminal-based applications, such as spinners, separators, and formatted text output.
- **Performance Measurement**: A `StopWatch` utility for tracking and displaying elapsed time during application execution.

These features are implemented across several modules, which are re-exported through the main entry point, [index.ts](./src/index.ts).

## Setup

No special setup is required for this package. To get started, simply install the package dependencies using:

```bash
pnpm install
```

For additional details, refer to the hand-written README.

## Key Files

The `interactiveApp` package is organized into several key files, each responsible for specific functionality:

- **[index.ts](./src/index.ts)**: The main entry point of the library, re-exporting all core functionalities.
- **[core.ts](./src/core.ts)**: Provides core utilities, including the `StopWatch` class for performance measurement.
- **[interactiveApp.ts](./src/interactiveApp.ts)**: Defines the main settings and input handling mechanisms for interactive applications.
- **[InteractiveIo.ts](./src/InteractiveIo.ts)**: Manages standard IO streams and provides utility functions for interactive input and output.
- **[terminalUI.ts](./src/terminalUI.ts)**: Contains utilities for enhancing terminal UI, such as spinners, separators, and text formatting.

### Detailed File Responsibilities

1. **[index.ts](./src/index.ts)**:

   - Serves as the main entry point for the library.
   - Re-exports functionalities from other modules to provide a unified interface.

2. **[core.ts](./src/core.ts)**:

   - Implements the `StopWatch` class for measuring and displaying elapsed time.
   - Includes utility functions like `millisecondsToString` for formatting time.

3. **[interactiveApp.ts](./src/interactiveApp.ts)**:

   - Defines the `InteractiveAppSettings` type, which allows customization of application behavior, such as input handling, command prefixes, and stop commands.
   - Provides the `InputHandler` type for managing command-line inputs.

4. **[InteractiveIo.ts](./src/InteractiveIo.ts)**:

   - Manages standard IO streams through the `InteractiveIo` type.
   - Includes functions like `getInteractiveIO` and `createInteractiveIO` for initializing and managing IO streams.
   - Implements the `ConsoleWriter` class for simplified console output operations.

5. **[terminalUI.ts](./src/terminalUI.ts)**:
   - Enhances terminal UI with utilities for handling ANSI escape codes, managing display widths, and formatting text.
   - Provides features like spinners, separators, and structured layouts for terminal-based applications.

## How to extend

To extend the `interactiveApp` package, follow these steps:

1. **Understand the entry point**:

   - Start with [index.ts](./src/index.ts) to see the exported functionalities and how the modules are integrated.

2. **Explore core utilities**:

   - Review [core.ts](./src/core.ts) for foundational utilities like the `StopWatch` class, which can be extended or reused in your application.

3. **Customize interactive settings**:

   - Modify [interactiveApp.ts](./src/interactiveApp.ts) to adjust application settings, such as input handlers, command prefixes, and stop commands. You can also add new types or handlers to extend the application's capabilities.

4. **Enhance IO operations**:

   - Use [InteractiveIo.ts](./src/InteractiveIo.ts) to manage IO streams. You can extend the `InteractiveIo` type or add new methods to the `ConsoleWriter` class for custom output formatting.

5. **Improve terminal UI**:

   - Extend [terminalUI.ts](./src/terminalUI.ts) to add new terminal UI features or customize existing ones. For example, you can create new utilities for advanced text formatting or additional UI elements.

6. **Test your changes**:
   - Ensure your extensions work as expected by running the existing test suite or adding new tests. This will help maintain the reliability of the library.

By following these steps, you can effectively extend the `interactiveApp` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

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
- schema-studio
- [search-action-test](../../examples/searchActionTest/README.md)
- [telemetry-query-example](../../examples/commandHistogram/README.md)

### Files of interest

`./src/index.ts`, `./src/core.ts`, `./src/interactiveApp.ts`, …and 3 more under `./src/`.

---

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter interactive-app docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
