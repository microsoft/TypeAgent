<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=58b27be8563c63c5d4cc97d6b8b26866506d2f2085d8be3b983fe5df1705f70e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# typeagent-studio — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `typeagent-studio` package is a TypeScript library that powers the Visual Studio Code extension for working with TypeAgent agents. It provides a developer experience tailored to agent authoring, schema and grammar tuning, regression testing through compare-and-replay, trace investigation, and live observation. This package is a critical tool for developers building and refining TypeAgent agents, offering both command-based workflows and rich visual interfaces.

## What it does

The `typeagent-studio` package integrates deeply with Visual Studio Code to provide a suite of tools for managing and debugging TypeAgent agents. Its functionality is organized into commands, views, and status indicators, enabling developers to efficiently onboard, test, and optimize agents.

### Commands

The package exposes a comprehensive set of commands through the VS Code command palette. These commands are grouped into several categories:

- **Onboarding and Sandbox Management**:

  - Commands like `TypeAgent Studio: Start onboarding session`, `TypeAgent Studio: Run onboarding phase`, and `TypeAgent Studio: Advance onboarding phase` guide developers through the onboarding process for new agents.
  - Sandbox-related commands such as `TypeAgent Studio: Start sandbox`, `TypeAgent Studio: Stop sandbox`, and `TypeAgent Studio: Refresh sandboxes` allow developers to manage isolated environments for testing and debugging.

- **Agent and Corpus Management**:

  - Commands like `TypeAgent Studio: Install latest onboarding session to sandbox` and `TypeAgent Studio: Refresh corpora` help manage agents and their associated corpora.
  - The `TypeAgent Studio: Replay corpus` command enables regression testing by replaying a corpus through the `replayCorpus()` engine, comparing agent behavior across versions.

- **Health and Diagnostics**:
  - Commands such as `TypeAgent Studio: Check packaging health gate` and `TypeAgent Studio: Enforce packaging health gate` provide insights into the health and readiness of agents.
  - The `TypeAgent Studio: Export onboarding artifact...` command allows developers to export various artifacts, including summaries, health snapshots, and diagnostics bundles.

### Views

The package introduces several specialized views within the **TypeAgent Studio** activity-bar container in VS Code:

1. **Sandboxes View**:

   - Displays running sandboxes and their loaded agents, along with health badges for each agent.
   - Provides inline actions for starting, stopping, restarting, and refreshing sandboxes.

2. **Corpora View**:

   - Organizes and displays corpus entries for agents, grouped by source (e.g., in-repo, captures, external, feedback).
   - Allows users to explore and manage corpora associated with loaded agents.

3. **Event Log View**:

   - Displays a chronological list of recent events related to agent activity, with timestamps, icons, and tooltips for quick reference.

4. **Collisions View**:

   - Lists detected schema/grammar collisions, categorized by type (e.g., overlap, shadow, ambiguity).
   - Provides tools for investigating and resolving conflicts in agent definitions.

5. **Health Status Bar**:
   - Summarizes the health of all agents loaded into running sandboxes.
   - Offers a quick visual indicator of the overall system health.

### Replay and Compare

The package supports regression testing through its replay and compare functionality. Developers can replay a corpus through the `replayCorpus()` engine, which evaluates each utterance against two versions of an agent and produces a detailed comparison report. This feature is accessible via the Corpora view and provides actionable insights into changes in agent behavior.

## Setup

To set up and use the `typeagent-studio` package, follow these steps:

1. **Install dependencies**:
   Run the following command in the package directory to install all required dependencies:

   ```sh
   pnpm install
   ```

2. **Build the package**:
   Compile the TypeScript code into JavaScript by running:

   ```sh
   cd packages/typeagent-studio
   pnpm run build
   ```

   This will generate the `dist/extension.js` file.

3. **Run the local test loop**:
   To test and rebuild the package locally, use the following commands:
   ```sh
   cd packages/typeagent-studio
   pnpm run test:local
   pnpm run build
   ```

For additional setup details, refer to the hand-written README or other relevant documentation in the repository.

## Key Files

The `typeagent-studio` package is organized into several key files and modules, each responsible for specific functionalities:

- **[extension.ts](./src/extension.ts)**: The main entry point for the VS Code extension. It initializes the extension, registers commands, and sets up views.
- **[commands.ts](./src/commands.ts)**: Implements the commands available in the VS Code command palette, such as managing sandboxes, running onboarding sessions, and exporting artifacts.
- **[sandboxTreePresentation.ts](./src/sandboxTreePresentation.ts)** and **[sandboxTreeProvider.ts](./src/sandboxTreeProvider.ts)**: Handle the presentation and data provisioning for the Sandboxes view.
- **[corpusTreePresentation.ts](./src/corpusTreePresentation.ts)** and **[corpusTreeProvider.ts](./src/corpusTreeProvider.ts)**: Manage the presentation and data provisioning for the Corpora view.
- **[eventLogPresentation.ts](./src/eventLogPresentation.ts)** and **[eventLogTreeProvider.ts](./src/eventLogTreeProvider.ts)**: Handle the Event Log view, summarizing and displaying recent events.
- **[collisionsPresentation.ts](./src/collisionsPresentation.ts)** and **[collisionsTreeProvider.ts](./src/collisionsTreeProvider.ts)**: Manage the Collisions view, including collision detection and presentation.
- **[healthStatusPresentation.ts](./src/healthStatusPresentation.ts)** and **[studioStatusBar.ts](./src/studioStatusBar.ts)**: Handle the health status bar, aggregating and displaying agent health information.

## How to extend

To contribute to or extend the `typeagent-studio` package, follow these steps:

1. **Understand the architecture**:

   - Begin by reviewing the [extension.ts](./src/extension.ts) file to understand how the extension is initialized and how commands and views are registered.

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
- [default-agent-provider](../../packages/defaultAgentProvider/README.md)

External: `debug`, `ws`

### Files of interest

`./src/baseTreeProvider.ts`, `./src/collisionsPresentation.ts`, `./src/collisionsSource.ts`, …and 70 more under `./src/`.

---

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter typeagent-studio docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
