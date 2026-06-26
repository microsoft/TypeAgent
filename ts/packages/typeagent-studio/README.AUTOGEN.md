<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=9e8d23adffd1dc367237ed6e92ad2ed59090327a98aafd230f4adb5be64dc7ae -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent-studio — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent-studio` package is a TypeScript library that provides a developer experience for authoring, tuning, and validating TypeAgent agents. It includes features such as compare-and-replay regression detection, schema/grammar tuning, trace investigation, and live observation. This package is designed to be used as a VS Code extension, offering various views and commands to facilitate the development and debugging of TypeAgent agents.

## What it does

The `typeagent-studio` package offers a comprehensive set of tools and views to enhance the developer experience when working with TypeAgent agents. Key functionalities include:

- **Agent Authoring**: Provides commands and views to create and manage TypeAgent agents.
- **Schema/Grammar Tuning**: Tools for adjusting and validating agent schemas and grammars.
- **Compare-and-Replay Regression Detection**: Allows developers to replay corpora and compare results to detect regressions.
- **Trace Investigation**: Tools for investigating traces and debugging agent behavior.
- **Live Observation**: Real-time monitoring of agent activity and health.

### Commands

The package includes a variety of commands accessible via the VS Code command palette, such as:

- `TypeAgent Studio: Start onboarding session`
- `TypeAgent Studio: Install latest onboarding session to sandbox`
- `TypeAgent Studio: Check packaging health gate`
- `TypeAgent Studio: Run onboarding phase`
- `TypeAgent Studio: Start sandbox`
- `TypeAgent Studio: Refresh sandboxes`
- `TypeAgent Studio: Replay corpus`

### Views

The package provides several views within the **TypeAgent Studio** activity-bar container:

- **Sandboxes View**: Displays running sandboxes and their loaded agents, with options to start, stop, restart, and refresh sandboxes.
- **Corpora View**: Shows the corpus entries for agents, grouped by source (in-repo, captures, external, feedback).
- **Feedback Capture**: Allows users to record feedback on agent performance.
- **Event Log View**: Lists recent events related to agent activity.
- **Collisions View**: Displays detected schema/grammar collisions.

## Setup

To set up the `typeagent-studio` package, follow these steps:

1. **Build the package**:

   ```sh
   cd packages/typeagent-studio
   pnpm run build
   ```

   This command produces the `dist/extension.js` file.

2. **Local Test Loop**:
   ```sh
   cd packages/typeagent-studio
   pnpm run test:local
   pnpm run build
   ```
   This sequence runs local tests and rebuilds the package.

## Key Files

The package's source code is organized into several key files, each responsible for different aspects of the functionality:

- **[extension.ts](./src/extension.ts)**: The main entry point for the VS Code extension, responsible for registering commands and initializing the runtime.
- **[collisionsPresentation.ts](./src/collisionsPresentation.ts)**: Handles the presentation logic for collision events, mapping them to tree rows.
- **[collisionsSource.ts](./src/collisionsSource.ts)**: Defines the interface for collision sources and manages collision detection and scanning.
- **[collisionsTreeProvider.ts](./src/collisionsTreeProvider.ts)**: A thin VS Code adapter that provides collision data to the tree view.
- **[commands.ts](./src/commands.ts)**: Registers and implements the various commands available in the command palette.
- **[corpusTreePresentation.ts](./src/corpusTreePresentation.ts)**: Manages the presentation logic for corpus entries, grouping them into tree nodes.
- **[corpusTreeProvider.ts](./src/corpusTreeProvider.ts)**: A thin VS Code adapter that provides corpus data to the tree view.
- **[eventLogPresentation.ts](./src/eventLogPresentation.ts)**: Handles the presentation logic for event log entries, mapping them to tree rows.

## How to extend

To extend the `typeagent-studio` package, follow these steps:

1. **Start with the main entry point**: Open the [extension.ts](./src/extension.ts) file to understand how commands and views are registered and initialized.

2. **Add new commands**: Implement new commands in the [commands.ts](./src/commands.ts) file. Register them in the `registerStudioCommands` function.

3. **Extend views**: To add or modify views, update the corresponding presentation and provider files. For example, to extend the Sandboxes view, modify [sandboxTreePresentation.ts](./src/sandboxTreePresentation.ts) and [sandboxTreeProvider.ts](./src/sandboxTreeProvider.ts).

4. **Unit tests**: Ensure that new functionality is covered by unit tests. The presentation logic is separated from VS Code-specific code to facilitate testing without the editor host.

5. **Run tests**: Use the local test loop to run tests and build the package:
   ```sh
   cd packages/typeagent-studio
   pnpm run test:local
   pnpm run build
   ```

By following these steps, you can effectively extend the functionality of the `typeagent-studio` package and contribute to its development.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/extension.js](./dist/extension.js)

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)

External: `debug`, `ws`

### Files of interest

`./src/collisionsPresentation.ts`, `./src/collisionsSource.ts`, `./src/collisionsTreeProvider.ts`, …and 48 more under `./src/`.

---

_Auto-generated against commit `127a36a95a15e918be533d6eaaf08adebe9070d9` on `2026-06-26T03:01:52.873Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent-studio docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
