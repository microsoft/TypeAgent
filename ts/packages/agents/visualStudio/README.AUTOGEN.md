<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=7ada2f9a71ae8e2dff79b65bc1f2f7c68b338e852735091314975317204636db -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# visualstudio-agent — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `visualstudio-agent` package integrates TypeAgent with Visual Studio via the EnvDTE automation API. It enables various actions related to the editor, solution management, build processes, and debugging within Visual Studio. This package contains the Node-side agent, while the host-side VSIX that runs inside Visual Studio is located under the `host/` directory.

## What it does

The `visualstudio-agent` package supports a range of actions that can be categorized into several groups:

- **breakpointsManagement**: `addBreakpoint`, `removeBreakpoint`
- **debuggingControl**: `break`, `go`, `stepInto`, `stepOut`, `stepOver`, `stop`, `debug`
- **fileOperations**: `openFile`, `closeAll`, `saveAll`
- **buildAndRun**: `build`, `clean`, `run`
- **searchAndNavigation**: `findInFiles`, `findText`, `gotoLine`
- **commandExecution**: `executeCommand`
- **editActions**: `redo`, `undo`

These actions allow users to manage breakpoints, control the debugger, perform file operations, build and run solutions, search and navigate code, execute commands, and perform edit actions within Visual Studio.

## Setup

To set up the `visualstudio-agent`, you need to have Visual Studio 2022 (or later) with the **Visual Studio extension development** workload installed. Additionally, ensure you have Node.js ≥ 20 and pnpm ≥ 10.

For detailed setup instructions, see the hand-written README.

## Key Files
The architecture of the `visualstudio-agent` involves two WebSocket channels:

- **Chat channel** (port 8999): The WebView2 inside the VSIX communicates with the dispatcher.
- **Action bridge** (port 5680): The agent owns a `WebSocketServer`, and the C# host connects as a client to dispatch incoming actions through EnvDTE.

The project structure is as follows:

```text
packages/agents/visualStudio/
├── src/
│   ├── visualStudioActionHandler.ts   # AppAgent + WebSocket bridge server
│   ├── visualStudioSchema.ts          # Action type definitions
│   ├── visualStudioSchema.agr         # Grammar rules
│   └── visualStudioManifest.json
├── host/
│   ├── csharp/                        # VSIX project (.NET / WPF)
│   └── webview/                       # WebView2 chat content (TS + Vite)
├── package.json
└── README.md
```

## How to extend

To extend the `visualstudio-agent`, follow these steps:

1. **Add new actions**: Define new action types in [visualStudioSchema.ts](./src/visualStudioSchema.ts). Ensure each action has a corresponding handler in [visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts).

2. **Update grammar rules**: Modify [visualStudioSchema.agr](./src/visualStudioSchema.agr) to include grammar rules for the new actions.

3. **Implement handlers**: Implement the logic for the new actions in [visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts). Ensure the actions are correctly dispatched through the WebSocket bridge.

4. **Test the changes**: Run tests to verify the new actions work as expected. Ensure the agent-server is running and Visual Studio is connected to the appropriate WebSocket channels.

By following these steps, you can extend the functionality of the `visualstudio-agent` to support additional actions and improve integration with Visual Studio.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/visualStudioManifest.json](./src/visualStudioManifest.json)
- `./agent/handlers` → [./dist/visualStudioActionHandler.js](./dist/visualStudioActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)
- [action-grammar-compiler](../../../packages/actionGrammarCompiler/README.md)

External: `ws`

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/visualStudioActionHandler.ts`, `./src/visualStudioManifest.json`, `./src/visualStudioSchema.agr`, …and 2 more under `./src/`.

### Agent surface

- Manifest: [./src/visualStudioManifest.json](./src/visualStudioManifest.json)
- Schema: [./src/visualStudioSchema.ts](./src/visualStudioSchema.ts)
- Grammar: [./src/visualStudioSchema.agr](./src/visualStudioSchema.agr)
- Handler: [./src/visualStudioActionHandler.ts](./src/visualStudioActionHandler.ts)

### Actions

_21 actions declared in the schema, none yet implemented in [`./src/visualStudioActionHandler.ts`]._

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter visualstudio-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
