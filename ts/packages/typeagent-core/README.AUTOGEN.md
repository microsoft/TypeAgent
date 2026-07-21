<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=cec32dc662d6b58433a15f2756a8cad32970f8a5aed4cad7b2ea9376a1457565 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/core — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/core` package is a foundational TypeScript library that provides shared functionality for the TypeAgent Studio ecosystem. It serves as the core engine for various extensions and subsystems, enabling features such as sandbox lifecycle management, federated corpus handling, structured event streaming, feedback collection, health monitoring, collision detection, corpus replay, and onboarding workflows. This package is a critical dependency for other components in the TypeAgent ecosystem, including `typeagent-studio`, `agr-language`, and `vscode-shell`.

## What it does

The `@typeagent/core` package is organized into modular subsystems, each of which provides specific functionality to support the broader TypeAgent Studio platform. These subsystems include:

- **Events**: Manages structured event streams, enabling the creation, logging, and dispatching of events. This is essential for tracking system activities and interactions.
- **Sandbox**: Handles the lifecycle of sandboxes, including their creation, destruction, and state management. Sandboxes are isolated environments used for executing agents and other processes.
- **Corpus**: Provides tools for managing federated corpora, including file-based corpus services, JSONL utilities, and unique identifier generation for corpus entries. This subsystem is crucial for organizing and accessing large datasets.
- **Feedback**: Implements mechanisms for collecting and processing user feedback, which can be used to improve system behavior and user experience.
- **Health**: Includes a rule engine for monitoring the health of the system, ensuring stability and identifying potential issues.
- **Collisions**: Detects and manages collision events, supporting both dispatcher-based and grammar-based collision detection. This is particularly useful for identifying and resolving conflicts in agent grammars.
- **Replay**: Facilitates the replay of corpus data for testing and debugging purposes, allowing developers to simulate and analyze past interactions.
- **Onboarding Bridge**: Manages snapshot and restore operations to support onboarding workflows, ensuring a smooth user experience during setup and transitions.

These subsystems are designed to be modular, lightweight, and reusable, making them easy to integrate into other parts of the TypeAgent ecosystem.

## Setup

To use the `@typeagent/core` package, you need to configure the following environment variable:

- `TYPEAGENT_USER_DATA_DIR`: This environment variable specifies the directory where user data is stored. Ensure that the directory exists and is accessible by the application. For more details on how to configure this variable, refer to the hand-written README.

No additional setup steps are required beyond setting this environment variable.

## Key Files

The `@typeagent/core` package is organized into several key directories and files, each responsible for specific functionalities. Below is an overview of the most important files and their roles:

### Core Modules

- **[src/index.ts](./src/index.ts)**: The main entry point for the package, exporting shared types and services across all subsystems.
- **[src/events/index.ts](./src/events/index.ts)**: Manages structured event streams, including event creation, logging, and dispatching.
- **[src/sandbox/index.ts](./src/sandbox/index.ts)**: Handles sandbox lifecycles, including creation, destruction, and state management.
- **[src/corpus/index.ts](./src/corpus/index.ts)**: Provides tools for managing federated corpora, including file-based corpus services, JSONL utilities, and unique identifier generation.
- **[src/feedback/index.ts](./src/feedback/index.ts)**: Implements feedback collection and processing mechanisms.
- **[src/health/index.ts](./src/health/index.ts)**: Contains the health rule engine for monitoring and maintaining system health.
- **[src/collisions/index.ts](./src/collisions/index.ts)**: Detects and manages collision events, supporting dispatcher and grammar-based collision detection.
- **[src/replay/index.ts](./src/replay/index.ts)**: Facilitates corpus replay functionalities for testing and debugging.
- **[src/onboardingBridge/index.ts](./src/onboardingBridge/index.ts)**: Manages snapshot and restore processes for onboarding workflows.

### Supporting Files

- **[src/collisions/scanner.ts](./src/collisions/scanner.ts)**: Implements a repository-backed grammar collision scanner that integrates with the `grammar-tools-core` library. This file is designed to be lightweight and modular, avoiding unnecessary dependencies when importing collision services.
- **[src/corpus/fileCorpusService.ts](./src/corpus/fileCorpusService.ts)**: Provides a filesystem-backed service for managing corpora, including support for multiple data sources.
- **[src/corpus/id.ts](./src/corpus/id.ts)**: Contains utilities for generating unique identifiers for corpus entries.
- **[src/corpus/jsonl.ts](./src/corpus/jsonl.ts)**: Includes utilities for parsing and formatting JSONL files, which are used to store corpus data.

## How to extend

To contribute to or extend the `@typeagent/core` package, follow these steps:

1. **Identify the subsystem**: Determine which subsystem (e.g., events, sandbox, corpus) you need to modify or extend.
2. **Locate the relevant files**: Navigate to the corresponding directory under `src/` (e.g., `src/events/` for event-related functionality).
3. **Understand the existing implementation**: Review the code in the relevant files to understand the structure, patterns, and conventions used.
4. **Implement new functionality**: Add your changes or new features in the appropriate files. Ensure your code is consistent with the existing implementation and adheres to the project's coding standards.
5. **Update exports**: If you add new functions, classes, or types, make sure to export them in the module's `index.ts` file.
6. **Write tests**: Create unit tests for your new functionality. Place the tests in the appropriate test directory, following the existing test structure.
7. **Run tests**: Execute the test suite to ensure that your changes do not introduce any regressions or break existing functionality.

By following these guidelines, you can effectively contribute to the `@typeagent/core` package and enhance its capabilities.

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
- _…and 44 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `d7d1b43eebfadec45d2f3199e628189b353920b9` on `2026-07-17T20:31:18.363Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/core docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
