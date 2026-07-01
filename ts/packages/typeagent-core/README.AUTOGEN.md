<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=690c04e65ae16f5fde447aa1901a12a2c2347f4f8d3e3e77b2b07e84e845ba92 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/core — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/core` package is a foundational TypeScript library that provides shared functionality for TypeAgent Studio extensions. It serves as the engine for managing key subsystems such as sandbox lifecycles, federated corpora, structured event streams, feedback mechanisms, health rule engines, collision detection, corpus replay, and onboarding processes. This package is consumed by other components in the TypeAgent ecosystem, including `typeagent-studio`, `agr-language`, and `vscode-shell`.

## What it does

The package is organized into modular subsystems, each addressing a specific aspect of the TypeAgent Studio's functionality. These subsystems include:

- **Events**: Provides tools for managing structured event streams, such as creating and logging events.
- **Sandbox**: Manages the lifecycle of sandboxes, including creation and destruction.
- **Corpus**: Handles federated corpora, enabling the creation and management of corpora and their associated documents.
- **Feedback**: Implements feedback mechanisms for collecting and processing user feedback.
- **Health**: Provides a rule engine for monitoring and maintaining the health of the system.
- **Collisions**: Detects and manages collision events, including grammar-based and dispatcher-based collisions.
- **Replay**: Supports replaying corpora for testing and debugging purposes.
- **Onboarding Bridge**: Facilitates snapshot and restore operations for onboarding workflows.

Each subsystem is implemented in its own directory under `src/`, with a clear separation of concerns. These modules are designed to be lightweight and reusable across the TypeAgent ecosystem.

## Setup

To use the `@typeagent/core` package, you need to configure the following environment variable:

- `TYPEAGENT_USER_DATA_DIR`: This environment variable specifies the directory where user data is stored. Ensure that the directory exists and is accessible by the application. For more details on how to configure this variable, refer to the hand-written README.

No additional setup steps are required beyond setting this environment variable.

## Key Files

The `@typeagent/core` package is structured into several key directories and files, each responsible for specific functionalities:

### Core Modules

- **[src/index.ts](./src/index.ts)**: The main entry point for the package, exporting shared types and services.
- **[src/events/index.ts](./src/events/index.ts)**: Manages structured event streams, including event creation and logging.
- **[src/sandbox/index.ts](./src/sandbox/index.ts)**: Handles the lifecycle of sandboxes, such as creation and destruction.
- **[src/corpus/index.ts](./src/corpus/index.ts)**: Provides tools for managing federated corpora, including file-based corpus services and utilities for handling JSONL data.
- **[src/feedback/index.ts](./src/feedback/index.ts)**: Implements feedback mechanisms for collecting and processing user input.
- **[src/health/index.ts](./src/health/index.ts)**: Contains the health rule engine for monitoring system health and status.
- **[src/collisions/index.ts](./src/collisions/index.ts)**: Detects and manages collision events, with support for both dispatcher and grammar-based collisions.
- **[src/replay/index.ts](./src/replay/index.ts)**: Facilitates corpus replay functionalities for testing and debugging.
- **[src/onboardingBridge/index.ts](./src/onboardingBridge/index.ts)**: Manages snapshot and restore processes for onboarding workflows.

### Supporting Files

- **[src/collisions/scanner.ts](./src/collisions/scanner.ts)**: Implements a repository-backed grammar collision scanner that integrates with the `grammar-tools-core` library.
- **[src/corpus/fileCorpusService.ts](./src/corpus/fileCorpusService.ts)**: Provides a filesystem-backed service for managing corpora, including support for multiple data sources.
- **[src/corpus/id.ts](./src/corpus/id.ts)**: Contains utilities for generating unique identifiers for corpus entries.
- **[src/corpus/jsonl.ts](./src/corpus/jsonl.ts)**: Includes utilities for parsing and formatting JSONL files, which are used to store corpus data.

## How to extend

To extend the functionality of the `@typeagent/core` package, follow these steps:

1. **Identify the subsystem**: Determine which subsystem (e.g., events, sandbox, corpus) you need to modify or extend.
2. **Locate the relevant files**: Navigate to the corresponding directory under `src/` (e.g., `src/events/` for event-related functionality).
3. **Follow existing patterns**: Review the existing code to understand the structure and conventions used in the package. For example, most subsystems have a clear separation between types, services, and utility functions.
4. **Add new functionality**: Implement your changes or new features in the appropriate files. Ensure that your code adheres to the project's coding standards and is consistent with the existing implementation.
5. **Update exports**: If you add new functions, classes, or types, make sure to export them in the module's `index.ts` file.
6. **Write tests**: Add unit tests for your new functionality. Place the tests in the appropriate test directory, following the existing test structure.
7. **Run the test suite**: Execute the test suite to ensure that your changes do not introduce any regressions or break existing functionality.

By following these steps, you can effectively contribute to the development of the `@typeagent/core` package and extend its capabilities.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_
- `./events` → `./dist/events/index.js` _(not found on disk)_
- `./sandbox` → `./dist/sandbox/index.js` _(not found on disk)_
- `./corpus` → `./dist/corpus/index.js` _(not found on disk)_
- `./feedback` → `./dist/feedback/index.js` _(not found on disk)_
- `./health` → `./dist/health/index.js` _(not found on disk)_
- `./collisions` → `./dist/collisions/index.js` _(not found on disk)_
- `./collisionScanner` → `./dist/collisions/scanner.js` _(not found on disk)_
- `./replay` → `./dist/replay/index.js` _(not found on disk)_
- `./replayResolver` → `./dist/replay/grammarResolver.js` _(not found on disk)_
- `./onboardingBridge` → `./dist/onboardingBridge/index.js` _(not found on disk)_
- `./webview` → `./dist/webview/index.js` _(not found on disk)_
- `./runtime` → `./dist/runtime/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar](../../packages/actionGrammar/README.md)
- [@typeagent/action-schema](../../packages/actionSchema/README.md)
- [agent-cache](../../packages/cache/README.md)
- grammar-tools-core

External: `debug`

### Used by

- [agr-language](../../extensions/agr-language/README.md)
- studio-agent
- [studio-service](../../packages/studio-service/README.md)
- [typeagent-studio](../../packages/typeagent-studio/README.md)
- [vscode-shell](../../packages/vscode-shell/README.md)

### Files of interest

- [./src/collisions/index.ts](./src/collisions/index.ts)
- [./src/corpus/index.ts](./src/corpus/index.ts)
- [./src/events/index.ts](./src/events/index.ts)
- [./src/feedback/index.ts](./src/feedback/index.ts)
- [./src/health/index.ts](./src/health/index.ts)
- [./src/index.ts](./src/index.ts)
- [./src/onboardingBridge/index.ts](./src/onboardingBridge/index.ts)
- [./src/replay/index.ts](./src/replay/index.ts)
- [./src/runtime/index.ts](./src/runtime/index.ts)
- [./src/sandbox/index.ts](./src/sandbox/index.ts)
- _…and 38 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/core docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
