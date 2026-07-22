<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=8d567a5239b59a6a8cc617b1307d5d2b4bda8fd92144c7ff88020e29e92e903d -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# visualstudio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `visualstudio-agent` package integrates TypeAgent with Visual Studio using the EnvDTE automation API. It acts as the Node-side agent, enabling communication between the TypeAgent system and Visual Studio for tasks such as debugging, file operations, and solution management. The corresponding host-side Visual Studio extension (VSIX) resides in the `host/` directory.

This agent establishes two WebSocket channels to facilitate communication: one for chat interactions and another for action dispatching. It supports a wide range of actions grouped into categories like debugging, file operations, and build management.

## What it does

The `visualstudio-agent` bridges the TypeAgent system and Visual Studio, enabling the execution of various actions within the IDE. These actions are grouped into the following categories:

- **breakpointsManagement**: Manage breakpoints with actions like `addBreakpoint` and `removeBreakpoint`.
- **debuggingControl**: Control debugging sessions with actions such as `break`, `go`, `stepInto`, `stepOut`, `stepOver`, `stop`, and `debug`.
- **fileOperations**: Perform file-related tasks like `openFile`, `closeAll`, and `saveAll`.
- **buildAndRun**: Execute solution-wide build and run tasks with actions like `build`, `clean`, and `run`.
- **searchAndNavigation**: Search and navigate code using actions like `findInFiles`, `findText`, and `gotoLine`.
- **commandExecution**: Execute Visual Studio commands via the `executeCommand` action.
- **editActions**: Perform basic editing operations with `redo` and `undo`.

The agent communicates with the Visual Studio host through two WebSocket channels:

1. **Chat channel**: Used by the WebView2 component in the VSIX to communicate with the TypeAgent dispatcher.
2. **Action bridge**: A WebSocket server owned by the agent, which the C# host connects to for dispatching actions through EnvDTE.

## Setup

To set up the `visualstudio-agent`, follow these steps:

1. **Install Required Software**:

   - Install Visual Studio 2022 (or later) with the **Visual Studio extension development** workload.
   - Install Node.js (version 20 or later) and pnpm (version 10 or later).

2. **Configure Environment Variables**:

   - `VISUALSTUDIO_BRIDGE_PORT`: (Optional) Specifies the port for the agent's WebSocket bridge. If not set, an OS-assigned ephemeral port will be used.
   - `VISUALSTUDIO_BRIDGE_SEND_TIMEOUT_MS`: Configures the timeout for sending messages through the bridge.

3. **Build the Agent**:

   - Run the following command to build the agent:
     ```sh
     pnpm run build visualStudio
     ```

4. **Set Up the VSIX Host**:

   - The VSIX host has its own build process, which includes building the WebView2 bundle and the MSBuild project. Refer to the `host/README.md` file for detailed instructions.

5. **Run the Agent**:
   - Start the TypeAgent agent-server.
   - Ensure `visualstudio-agent` is enabled in your dispatcher configuration.
   - Launch Visual Studio with the VSIX installed.
   - Open the **TypeAgent Chat** panel in Visual Studio via **View → Other Windows → TypeAgent Chat**.

## Key Files

The `visualstudio-agent` package is organized as follows:

```plaintext
packages/agents/visualStudio/
├── src/
│   ├── visualStudioActionHandler.ts   # Implements the WebSocket bridge and action handlers
│   ├── visualStudioSchema.ts          # Defines action types
│   ├── visualStudioSchema.agr         # Grammar rules for action parsing
│   └── visualStudioManifest.json      # Agent manifest and configuration
├── host/
│   ├── csharp/                        # VSIX project (C# and WPF code)
│   └── webview/                       # WebView2 chat content (TypeScript + Vite)
├── package.json
└── README.md
```

### File Responsibilities

- **[visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts)**: Implements the WebSocket bridge server and action handlers. It manages communication with the C# host and dispatches actions to EnvDTE.
- **[visualStudioSchema.ts](./src/visualStudioSchema.ts)**: Defines the TypeScript types for all supported actions.
- **[visualStudioSchema.agr](./src/visualStudioSchema.agr)**: Contains grammar rules for parsing natural language inputs into structured actions.
- **[visualStudioManifest.json](./src/visualStudioManifest.json)**: Specifies the agent's metadata, including its schema, grammar, and default configuration.

## How to extend

To add new functionality to the `visualstudio-agent`, follow these steps:

1. **Define the Action**:

   - Add the new action type to [visualStudioSchema.ts](./src/visualStudioSchema.ts). Include all necessary parameters and a clear description of the action.

2. **Update the Grammar**:

   - Add grammar rules for the new action in [visualStudioSchema.agr](./src/visualStudioSchema.agr). These rules map natural language inputs to the action's structure.

3. **Implement the Handler**:

   - Implement the logic for the new action in [visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts). Ensure the action is correctly dispatched through the WebSocket bridge to the C# host.

4. **Test the Changes**:

   - Run the agent-server and connect Visual Studio with the VSIX installed. Test the new action to ensure it behaves as expected.

5. **Update Documentation**:
   - Document the new action in the hand-written README or other relevant documentation.

By following this process, you can extend the `visualstudio-agent` to support additional actions and improve its integration with Visual Studio.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/visualStudioManifest.json](./src/visualStudioManifest.json)
- `./agent/handlers` → [./dist/visualStudioActionHandler.js](./dist/visualStudioActionHandler.js)

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

_Auto-generated against commit `6bea19a9ee02598644b1ac3ab67c705dcc495832` on `2026-07-22T11:19:17.632Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter visualstudio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
