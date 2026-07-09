<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=676a72b6c56b7189c65a16f12a236be540ebc2ede9cce94a56c321a368fb1a3e -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# visualstudio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `visualstudio-agent` package integrates TypeAgent with Visual Studio using the EnvDTE automation API. It acts as the Node-side agent, enabling communication between TypeAgent and Visual Studio for actions related to editing, debugging, building, and managing solutions. The corresponding host-side VSIX, which runs inside Visual Studio, is located in the `host/` directory.

This package facilitates a wide range of actions, such as managing breakpoints, controlling the debugger, performing file operations, building and running solutions, searching and navigating code, executing commands, and performing edit actions.

## What it does

The `visualstudio-agent` provides a bridge between the TypeAgent system and Visual Studio, enabling the execution of various actions grouped into the following categories:

- **Breakpoints Management**: Actions like `addBreakpoint` and `removeBreakpoint` allow users to manage breakpoints in their code.
- **Debugging Control**: Actions such as `break`, `go`, `stepInto`, `stepOut`, `stepOver`, `stop`, and `debug` provide control over the debugging process.
- **File Operations**: Includes actions like `openFile`, `closeAll`, and `saveAll` for managing files in the editor.
- **Build and Run**: Actions like `build`, `clean`, and `run` enable solution-wide build and execution.
- **Search and Navigation**: Actions such as `findInFiles`, `findText`, and `gotoLine` help users search and navigate through their codebase.
- **Command Execution**: The `executeCommand` action allows users to run Visual Studio commands via the EnvDTE API.
- **Edit Actions**: Includes `redo` and `undo` for basic editing operations.

The agent communicates with Visual Studio through two WebSocket channels:

1. **Chat channel**: Used by the WebView2 inside the VSIX to communicate with the TypeAgent dispatcher.
2. **Action bridge**: A WebSocket server owned by the agent, which the C# host connects to for dispatching actions through EnvDTE.

## Setup

To set up the `visualstudio-agent`, follow these steps:

1. **Prerequisites**:

   - Install Visual Studio 2022 (or later) with the **Visual Studio extension development** workload.
   - Install Node.js (version 20 or later) and pnpm (version 10 or later).

2. **Environment Variables**:

   - `VISUALSTUDIO_BRIDGE_PORT`: (Optional) Set this variable to pin the agent's bridge to a specific port for debugging purposes. If unset, the port will be assigned by the operating system.
   - `VISUALSTUDIO_BRIDGE_SEND_TIMEOUT_MS`: Configure the timeout (in milliseconds) for sending messages through the bridge.

3. **Build**:

   - Build the agent using the monorepo's build command:
     ```sh
     pnpm run build visualStudio
     ```
   - For the host-side VSIX, follow the build instructions in the `host/README.md`.

4. **Run**:
   - Start the TypeAgent agent-server.
   - Ensure the `visualstudio-agent` is enabled in the dispatcher configuration.
   - Launch Visual Studio with the VSIX installed.
   - Open the **TypeAgent Chat** panel in Visual Studio via **View → Other Windows → TypeAgent Chat**.

## Key Files

The `visualstudio-agent` package is organized as follows:

- **[src/visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts)**: Implements the WebSocket bridge server and action handlers. This is the core of the agent's functionality.
- **[src/visualStudioSchema.ts](./src/visualStudioSchema.ts)**: Defines the types for all supported actions.
- **[src/visualStudioSchema.agr](./src/visualStudioSchema.agr)**: Contains the grammar rules for parsing and mapping user intents to actions.
- **[src/visualStudioManifest.json](./src/visualStudioManifest.json)**: Defines the agent's metadata, including its schema and default configuration.

The `host/` directory contains the Visual Studio extension (VSIX) project:

- **host/csharp/**: The .NET/WPF project for the VSIX.
- **host/webview/**: The WebView2-based chat interface, implemented in TypeScript and built with Vite.

## How to extend

To add new functionality to the `visualstudio-agent`, follow these steps:

1. **Define new actions**:

   - Add new action types to [visualStudioSchema.ts](./src/visualStudioSchema.ts).
   - Update the grammar rules in [visualStudioSchema.agr](./src/visualStudioSchema.agr) to map user intents to the new actions.

2. **Implement action handlers**:

   - Add the logic for the new actions in [visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts). Use the `AppAgent` and `WebSocketServer` classes to handle communication with the Visual Studio host.

3. **Update the manifest**:

   - Modify [visualStudioManifest.json](./src/visualStudioManifest.json) to include the new actions in the schema.

4. **Test your changes**:

   - Run the agent-server and ensure the new actions are correctly dispatched and executed. Use the Visual Studio **Output** window and agent-server logs for debugging.

5. **Extend the VSIX (if needed)**:
   - If the new actions require changes to the Visual Studio extension, update the relevant files in the `host/csharp/` or `host/webview/` directories.

By following these steps, you can enhance the `visualstudio-agent` to support additional actions and improve its integration with Visual Studio.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/visualStudioManifest.json](./src/visualStudioManifest.json)
- `./agent/handlers` → `./dist/visualStudioActionHandler.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)
- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [@typeagent/websocket-utils](../../../packages/utils/webSocketUtils/README.md)

External: `debug`, `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/visualStudioActionHandler.ts`, `./src/visualStudioManifest.json`, `./src/visualStudioSchema.agr`, …and 4 more under `./src/`.

### Agent surface

- Manifest: [./src/visualStudioManifest.json](./src/visualStudioManifest.json)
- Schema: [./src/visualStudioSchema.ts](./src/visualStudioSchema.ts)
- Grammar: [./src/visualStudioSchema.agr](./src/visualStudioSchema.agr)
- Handler: [./src/visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts)

### Environment variables

_2 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `VISUALSTUDIO_BRIDGE_PORT`
- `VISUALSTUDIO_BRIDGE_SEND_TIMEOUT_MS`

### Actions

_21 actions declared in the schema, none yet implemented in [`./src/visualStudioActionHandler.ts`]._

---

_Auto-generated against commit `656444843518fd1f9bb1b157b6dbf6dcbcde3999` on `2026-07-09T09:05:44.186Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter visualstudio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
