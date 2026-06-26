<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f4c5fbc036f62e65d4f8684cbbbae2139dba1fc25e11a6649c6feac614f54db1 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# @typeagent/core — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `@typeagent/core` package is a shared engine library for TypeAgent Studio extensions. It provides core functionalities and services that are used across various TypeAgent subsystems. This package is essential for managing the sandbox lifecycle, federating corpora, handling structured event streams, providing feedback mechanisms, ensuring health rules, detecting collisions, replaying corpora, and bridging onboarding processes.

## What it does

The `@typeagent/core` package offers a variety of features that are grouped into different modules:

- **Events**: Manages structured event streams (`createEventStream`, `logEvent`).
- **Sandbox**: Handles sandbox lifecycle management (`createSandbox`, `destroySandbox`).
- **Corpus**: Manages federated corpora (`createCorpus`, `addDocumentToCorpus`).
- **Feedback**: Provides feedback mechanisms (`sendFeedback`, `getFeedback`).
- **Health**: Implements health rule engines (`checkHealth`, `updateHealthStatus`).
- **Collisions**: Detects and manages collision events (`scanCollisions`, `resolveCollision`).
- **Replay**: Facilitates corpus replay functionalities (`replayCorpus`, `pauseReplay`).
- **Onboarding Bridge**: Manages snapshot and restore processes (`createSnapshot`, `restoreSnapshot`).

These modules are consumed by other packages such as `typeagent-studio`, `agr-language`, and `vscode-shell`.

## Setup

To set up the `@typeagent/core` package, you need to configure the following environment variable:

- `TYPEAGENT_USER_DATA_DIR`: This variable specifies the directory where user data is stored. Ensure that this directory exists and is accessible by the application.

Refer to the hand-written README for detailed instructions on obtaining and setting up this environment variable.

## Key Files

The package is organized into several key files and directories, each responsible for different functionalities:

- **[src/index.ts](./src/index.ts)**: The main entry point that exports core type definitions and services shared across TypeAgent subsystems.
- **[src/events/index.ts](./src/events/index.ts)**: Manages structured event streams.
- **[src/sandbox/index.ts](./src/sandbox/index.ts)**: Handles sandbox lifecycle management.
- **[src/corpus/index.ts](./src/corpus/index.ts)**: Manages federated corpora.
- **[src/feedback/index.ts](./src/feedback/index.ts)**: Provides feedback mechanisms.
- **[src/health/index.ts](./src/health/index.ts)**: Implements health rule engines.
- **[src/collisions/index.ts](./src/collisions/index.ts)**: Detects and manages collision events.
- **[src/collisions/scanner.ts](./src/collisions/scanner.ts)**: Repository-backed grammar collision scanner.
- **[src/replay/index.ts](./src/replay/index.ts)**: Facilitates corpus replay functionalities.
- **[src/onboardingBridge/index.ts](./src/onboardingBridge/index.ts)**: Manages snapshot and restore processes.

## How to extend

To extend the `@typeagent/core` package, follow these steps:

1. **Identify the module**: Determine which module you need to extend (e.g., events, sandbox, corpus).
2. **Open the relevant file**: Navigate to the corresponding directory and open the relevant file (e.g., [src/events/index.ts](./src/events/index.ts)).
3. **Add new functionality**: Implement the new functionality by following the existing patterns and structures. Ensure that your code adheres to the project's coding standards.
4. **Update exports**: If you add new functions or classes, make sure to export them in the module's index file.
5. **Write tests**: Add tests for your new functionality to ensure it works as expected. Place your tests in the appropriate test directory.
6. **Run tests**: Execute the test suite to verify that your changes do not break existing functionality.

By following these steps, you can effectively extend the capabilities of the `@typeagent/core` package and contribute to its development.

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
- `./replayResolver` → `./dist/replay/grammarResolver.js` _(not found on disk)_
- `./onboardingBridge` → [./dist/onboardingBridge/index.js](./dist/onboardingBridge/index.js)
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
- _…and 36 more under `./src/`._

### Environment variables

_1 environment variable referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `TYPEAGENT_USER_DATA_DIR`

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter @typeagent/core docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
