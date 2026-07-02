<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=6cb8615bdea040e6c52c3d85a3119d9efaef5e1516a05046913ac94a5a77f3b3 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent-studio — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent-studio` package is a TypeScript library that serves as the backbone for the TypeAgent developer experience within Visual Studio Code. It provides tools and interfaces for authoring, debugging, and optimizing TypeAgent agents. Key features include schema and grammar tuning, compare-and-replay regression detection, trace investigation, and live observation of agent behavior. This package is designed to streamline the development and validation of TypeAgent agents, making it an essential tool for developers working within the TypeAgent ecosystem.

## What it does

The `typeagent-studio` package integrates with Visual Studio Code to provide a rich set of features for working with TypeAgent agents. These features are organized into commands and views, which are accessible through the VS Code interface.

### Commands

The package offers a wide range of commands, accessible via the VS Code command palette, to support various stages of agent development and debugging. Some of the key commands include:

- **Onboarding and Sandbox Management**:

  - `TypeAgent Studio: Start onboarding session`
  - `TypeAgent Studio: Run onboarding phase`
  - `TypeAgent Studio: Start sandbox`
  - `TypeAgent Studio: Stop sandbox`
  - `TypeAgent Studio: Refresh sandboxes`

- **Agent and Corpus Management**:

  - `TypeAgent Studio: Install latest onboarding session to sandbox`
  - `TypeAgent Studio: Replay corpus`
  - `TypeAgent Studio: Refresh corpora`

- **Health and Diagnostics**:
  - `TypeAgent Studio: Check packaging health gate`
  - `TypeAgent Studio: Enforce packaging health gate`
  - `TypeAgent Studio: Export onboarding artifact...`

These commands enable developers to manage sandboxes, run onboarding sessions, replay corpora, and monitor the health of their agents.

### Views

The package provides several specialized views within the **TypeAgent Studio** activity-bar container:

1. **Sandboxes View**:

   - Displays running sandboxes and their loaded agents.
   - Provides inline actions for starting, stopping, restarting, and refreshing sandboxes.
   - Shows agent health badges derived from the `FileHealthService`.

2. **Corpora View**:

   - Lists corpus entries for agents, grouped by source (e.g., in-repo, captures, external, feedback).
   - Allows users to explore and manage corpora associated with loaded agents.

3. **Feedback Capture**:

   - Enables users to record feedback on agent performance, including ratings, comments, and categories.
   - Feedback is integrated into the Corpora view for further analysis.

4. **Event Log View**:

   - Displays a chronological list of recent events related to agent activity.
   - Provides a quick overview of events with timestamps, icons, and tooltips.

5. **Collisions View**:

   - Lists detected schema/grammar collisions, categorized by type (e.g., overlap, shadow, ambiguity).
   - Allows users to investigate and resolve conflicts in agent definitions.

6. **Health Status Bar**:
   - Summarizes the health of all agents loaded into running sandboxes.
   - Provides a quick visual indicator of the overall system health.

## Setup

To get started with the `typeagent-studio` package, follow these steps:

1. **Build the package**:
   Navigate to the package directory and run the build command:

   ```sh
   cd packages/typeagent-studio
   pnpm run build
   ```

   This will generate the `dist/extension.js` file.

2. **Run the local test loop**:
   To test and rebuild the package locally, use the following commands:

   ```sh
   cd packages/typeagent-studio
   pnpm run test:local
   pnpm run build
   ```

3. **Install dependencies**:
   Ensure all required dependencies are installed by running:
   ```sh
   pnpm install
   ```

For additional setup details, refer to the hand-written README or the relevant documentation in the repository.

## Key Files

The `typeagent-studio` package is organized into several key files and modules, each responsible for specific functionality:

- **[extension.ts](./src/extension.ts)**: The main entry point for the VS Code extension. It initializes the extension, registers commands, and sets up views.
- **[commands.ts](./src/commands.ts)**: Contains the implementation of all commands available in the VS Code command palette.
- **[sandboxTreePresentation.ts](./src/sandboxTreePresentation.ts)** and **[sandboxTreeProvider.ts](./src/sandboxTreeProvider.ts)**: Handle the presentation and data provisioning for the Sandboxes view.
- **[corpusTreePresentation.ts](./src/corpusTreePresentation.ts)** and **[corpusTreeProvider.ts](./src/corpusTreeProvider.ts)**: Manage the presentation and data provisioning for the Corpora view.
- **[eventLogPresentation.ts](./src/eventLogPresentation.ts)** and **[eventLogTreeProvider.ts](./src/eventLogTreeProvider.ts)**: Handle the Event Log view, summarizing and displaying recent events.
- **[collisionsPresentation.ts](./src/collisionsPresentation.ts)** and **[collisionsTreeProvider.ts](./src/collisionsTreeProvider.ts)**: Manage the Collisions view, including collision detection and presentation.
- **[healthStatusPresentation.ts](./src/healthStatusPresentation.ts)** and **[studioStatusBar.ts](./src/studioStatusBar.ts)**: Handle the health status bar, aggregating and displaying agent health information.

## How to extend

To contribute to or extend the `typeagent-studio` package, follow these guidelines:

1. **Understand the architecture**:

   - Start by reviewing the [extension.ts](./src/extension.ts) file to understand how the extension is initialized and how commands and views are registered.

2. **Add new commands**:

   - Implement new commands in the [commands.ts](./src/commands.ts) file.
   - Register the new commands in the `registerStudioCommands` function.

3. **Extend existing views**:

   - To modify or enhance a view, update its corresponding presentation and provider files. For example:
     - Sandboxes view: [sandboxTreePresentation.ts](./src/sandboxTreePresentation.ts) and [sandboxTreeProvider.ts](./src/sandboxTreeProvider.ts).
     - Corpora view: [corpusTreePresentation.ts](./src/corpusTreePresentation.ts) and [corpusTreeProvider.ts](./src/corpusTreeProvider.ts).

4. **Add new views**:

   - Create a new presentation module for the view's logic (e.g., `newViewPresentation.ts`).
   - Implement a `TreeDataProvider` adapter for the view (e.g., `newViewTreeProvider.ts`).
   - Register the new view in the `extension.ts` file.

5. **Write unit tests**:

   - Ensure that all new functionality is covered by unit tests.
   - Presentation logic is separated from VS Code-specific code to facilitate testing without the editor host.

6. **Test and build**:
   - Use the local test loop to verify your changes:
     ```sh
     cd packages/typeagent-studio
     pnpm run test:local
     pnpm run build
     ```

By following these steps, you can effectively contribute to the `typeagent-studio` package and enhance its capabilities. For more details, refer to the hand-written README or the source code.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/extension.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-rpc](../../packages/agentRpc/README.md)
- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/core](../../packages/typeagent-core/README.md)
- [@typeagent/websocket-utils](../../packages/utils/webSocketUtils/README.md)

External: `debug`, `ws`

### Files of interest

`./src/baseTreeProvider.ts`, `./src/collisionsPresentation.ts`, `./src/collisionsSource.ts`, …and 54 more under `./src/`.

---

_Auto-generated against commit `ff379b098decfab4eb45f78b6fa318358d7fbd75` on `2026-07-01T09:05:58.471Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent-studio docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
