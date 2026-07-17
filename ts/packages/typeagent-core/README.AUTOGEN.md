<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9612f6d1d787790653d13636a634218efa1db2ba180759b3d53485d9db437911 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/core — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/core` package is a foundational TypeScript library that provides shared functionality for various TypeAgent Studio extensions. It serves as the backbone for managing critical subsystems such as sandbox lifecycles, federated corpora, structured event streams, feedback mechanisms, health monitoring, collision detection, corpus replay, and onboarding workflows. This package is consumed by other components in the TypeAgent ecosystem, including `typeagent-studio`, `agr-language`, and `vscode-shell`.

## What it does

The `@typeagent/core` package is organized into modular subsystems, each responsible for a specific aspect of the TypeAgent Studio's functionality. These subsystems include:

- **Events**: Provides tools for managing structured event streams, including event creation, logging, and dispatching. This is essential for tracking and analyzing system activities.
- **Sandbox**: Manages the lifecycle of sandboxes, including their creation, destruction, and state management. This is critical for isolating and managing execution environments.
- **Corpus**: Offers utilities for handling federated corpora, such as file-based corpus services, JSONL utilities, and unique identifier generation for corpus entries.
- **Feedback**: Implements mechanisms for collecting, processing, and managing user feedback, enabling better user experience and system improvement.
- **Health**: Features a rule engine for monitoring and maintaining the health of the system, ensuring stability and reliability.
- **Collisions**: Detects and manages collision events, supporting both dispatcher-based and grammar-based collision detection. This is particularly useful for identifying and resolving conflicts in agent interactions.
- **Replay**: Facilitates corpus replay for testing and debugging, allowing developers to simulate and analyze system behavior under various scenarios.
- **Onboarding Bridge**: Manages snapshot and restore operations to support onboarding workflows, ensuring a smooth user experience during setup and configuration.

Each subsystem is implemented in its own directory under `src/`, making the package modular and easy to navigate.

## Setup

To use the `@typeagent/core` package, you need to configure the following environment variable:

- `TYPEAGENT_USER_DATA_DIR`: This variable specifies the directory where user data is stored. Ensure that the directory exists and is accessible by the application. If additional details are needed on how to configure this variable, refer to the hand-written README.

No other setup steps are required beyond setting this environment variable.

## Key Files

The `@typeagent/core` package is organized into several key directories and files, each responsible for specific functionalities. Below is an overview of the main components:

### Core Modules

- **[src/index.ts](./src/index.ts)**: The primary entry point for the package, exporting shared types and services across all subsystems.
- **[src/events/index.ts](./src/events/index.ts)**: Manages structured event streams, including event creation, logging, and dispatching.
- **[src/sandbox/index.ts](./src/sandbox/index.ts)**: Handles sandbox lifecycle management, including creation, destruction, and state handling.
- **[src/corpus/index.ts](./src/corpus/index.ts)**: Provides tools for managing federated corpora, including file-based corpus services, JSONL utilities, and unique identifier generation.
- **[src/feedback/index.ts](./src/feedback/index.ts)**: Implements feedback collection and processing mechanisms.
- **[src/health/index.ts](./src/health/index.ts)**: Contains a rule engine for monitoring and maintaining system health.
- **[src/collisions/index.ts](./src/collisions/index.ts)**: Detects and manages collision events, supporting dispatcher-based and grammar-based collision detection.
- **[src/replay/index.ts](./src/replay/index.ts)**: Facilitates corpus replay for testing and debugging purposes.
- **[src/onboardingBridge/index.ts](./src/onboardingBridge/index.ts)**: Manages snapshot and restore operations for onboarding workflows.

### Supporting Files

- **[src/collisions/scanner.ts](./src/collisions/scanner.ts)**: Implements a repository-backed grammar collision scanner that integrates with the `grammar-tools-core` library. This file is kept separate to avoid unnecessary dependencies when importing lightweight collision services or types.
- **[src/corpus/fileCorpusService.ts](./src/corpus/fileCorpusService.ts)**: Provides a filesystem-backed service for managing corpora, including support for multiple data sources.
- **[src/corpus/id.ts](./src/corpus/id.ts)**: Contains utilities for generating unique identifiers for corpus entries.
- **[src/corpus/jsonl.ts](./src/corpus/jsonl.ts)**: Includes utilities for parsing and formatting JSONL files, which are used to store corpus data.

## How to extend

To contribute to or extend the `@typeagent/core` package, follow these steps:

1. **Identify the subsystem**: Determine which subsystem (e.g., events, sandbox, corpus) you need to modify or extend.
2. **Locate the relevant files**: Navigate to the corresponding directory under `src/` (e.g., `src/events/` for event-related functionality).
3. **Understand the existing structure**: Review the existing code to understand the architecture and coding conventions. Each subsystem typically separates types, services, and utility functions into distinct files.
4. **Implement new functionality**: Add your changes or new features in the appropriate files. Ensure your code is consistent with the existing implementation and adheres to the project's coding standards.
5. **Update exports**: If you add new functions, classes, or types, make sure to export them in the module's `index.ts` file.
6. **Write and run tests**: Add unit tests for your new functionality. Place the tests in the appropriate test directory, following the existing test structure. Run the test suite to ensure your changes do not introduce regressions or break existing functionality.

By following these guidelines, you can effectively extend the `@typeagent/core` package while maintaining its modularity and consistency.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)
- `./events` → [./dist/events/index.js](./dist/events/index.js)
- `./sandbox` → [./dist/sandbox/index.js](./dist/sandbox/index.js)
- `./corpus` → [./dist/corpus/index.js](./dist/corpus/index.js)
- `./feedback` → [./dist/feedback/index.js](./dist/feedback/index.js)
- `./health` → [./dist/health/index.js](./dist/health/index.js)
- `./collisions` → [./dist/collisions/index.js](./dist/collisions/index.js)
- `./collisionScanner` → [./dist/collisions/scanner.js](./dist/collisions/scanner.js)
- `./replay` → [./dist/replay/index.js](./dist/replay/index.js)
- `./replayResolver` → [./dist/replay/grammarResolver.js](./dist/replay/grammarResolver.js)
- `./onboardingBridge` → [./dist/onboardingBridge/index.js](./dist/onboardingBridge/index.js)
- `./webview` → [./dist/webview/index.js](./dist/webview/index.js)
- `./runtime` → [./dist/runtime/index.js](./dist/runtime/index.js)

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
- _…and 42 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `ee4eba45bcb87911335cb938a0ced6a001aa3882` on `2026-07-17T22:05:48.260Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/core docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
