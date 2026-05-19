# Visual Studio TypeAgent

## Overview

The Visual Studio TypeAgent integrates TypeAgent with Visual Studio via the EnvDTE
automation API. It exposes editor, solution, build, and debug actions — manage
breakpoints, drive the debugger, open/save/close files, build and run the
solution, search and navigate code, execute commands, and perform edit actions.

This package contains the **Node-side agent**. The **host-side VSIX** that runs
inside Visual Studio lives under [host/](host/) — see [host/README.md](host/README.md)
for build and install instructions.

## Architecture

```
+-------------------------------+        +--------------------+
|  Visual Studio (VSIX)         |        |  TypeAgent         |
|                               |        |  agent-server      |
|  +------------------------+   |        |                    |
|  |  ChatToolWindow        |<--|--WS--->|  +--------------+  |
|  |   WebView2             |   |  8999  |  | dispatcher   |  |
|  |     chat-ui            |   |        |  +------+-------+  |
|  +------------------------+   |        |         |          |
|                               |        |  +------v-------+  |
|  +------------------------+   |        |  | visualstudio |  |
|  |  AgentBridgeClient.cs  |<--|---WS---|->|    agent     |  |
|  |   DTEActionExecutor.cs |   | ephem. |  +--------------+  |
|  +-----------+------------+   |        +--------------------+
|              |  ^
|              |  + port discovered via
|              |    discovery channel on 8999
|              v EnvDTE
|         (Solution, Build,
|          Debugger, Editor)
+-------------------------------+
```

Two WebSocket channels:

- **Chat channel** (port 8999) — WebView2 inside the VSIX talks to the
  dispatcher. The same port also hosts the dispatcher's read-only
  **discovery channel** that the bridge uses to find the action port
  (see below).
- **Action bridge** (OS-assigned ephemeral port) — this agent owns a
  `WebSocketServer`; the C# host connects as a client and dispatches
  incoming actions through EnvDTE. The actual port is published to the
  agent-server's `PortRegistrar` under `(visualStudio, default)` and
  discovered by `AgentBridgeClient` on every connect attempt.

### Port discovery

`AgentBridgeClient` resolves the bridge port on each connect attempt by
calling `lookupPort("visualStudio", "default")` against the
agent-server's discovery channel (`ws://localhost:<AGENT_SERVER_PORT>/`,
default 8999). Knobs:

| Env var                                   | Default                 | Purpose                                                                     |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `AGENT_SERVER_PORT`                       | `8999`                  | Where the dispatcher's discovery channel is hosted.                         |
| `TYPEAGENT_VS_USE_DISCOVERY`              | `true`                  | Set to `false`/`0` to skip discovery and use the hardcoded fallback (5680). |
| `TYPEAGENT_VS_FALLBACK_PORT`              | `5680`                  | Port to fall back to when discovery is disabled or returns null / fails.    |
| `VISUALSTUDIO_BRIDGE_PORT` _(agent-side)_ | _(unset → OS-assigned)_ | Pin the agent's bridge to a specific port when debugging.                   |

## Action Categories

| Category                  | Actions                                             |
| ------------------------- | --------------------------------------------------- |
| **breakpointsManagement** | addBreakpoint, removeBreakpoint                     |
| **debuggingControl**      | break, go, stepInto, stepOut, stepOver, stop, debug |
| **fileOperations**        | openFile, closeAll, saveAll                         |
| **buildAndRun**           | build, clean, run                                   |
| **searchAndNavigation**   | findInFiles, findText, gotoLine                     |
| **commandExecution**      | executeCommand                                      |
| **editActions**           | redo, undo                                          |

## Prerequisites

- Visual Studio 2022 (or later) with the **Visual Studio extension development**
  workload installed
- Node.js ≥ 20 and pnpm ≥ 10

## Build

The agent itself builds with the rest of the monorepo:

```sh
pnpm run build visualStudio
```

The VSIX host has its own two-stage build (WebView2 bundle + MSBuild). See
[host/README.md](host/README.md#build).

## Run

1. Start the TypeAgent agent-server.
2. Ensure `visualstudio-agent` is enabled in your dispatcher config.
3. Launch Visual Studio with the VSIX installed.
4. **View → Other Windows → TypeAgent Chat**.

The chat panel connects to `ws://localhost:8999`. Once connected, the C# bridge
discovers the agent's action port via that same WS (via the discovery channel)
and auto-connects.

## Project Structure

```
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

## API Limitations

- **breakpointsManagement** — add and remove only; no enable/disable, no hit-count
  conditions.
- **debuggingControl** — basic transport (break, go, step\*, stop, debug); no
  attach-to-process, no exception-settings control.
- **fileOperations** — open / close-all / save-all; no per-document save or
  rename.
- **buildAndRun** — solution-wide only; no per-project build, no configuration
  switching.
- **searchAndNavigation** — text-level only; no symbol search, no go-to-definition.
- **commandExecution** — passes through to `DTE.ExecuteCommand`; the caller is
  responsible for knowing the command name.
- **editActions** — redo and undo only.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.

## Troubleshooting

- **VSIX doesn't load.** Confirm the **Visual Studio extension development**
  workload is installed and that the VSIX target version matches your VS
  install.
- **Chat panel never connects.** The agent-server must be running before VS
  opens the tool window. Check that port 8999 is reachable.
- **Actions hang or error with "Host plugin not connected".** The C# bridge
  could not reach the agent's action port. Confirm `visualstudio-agent` is
  enabled in the dispatcher. Check the VS **Output → Debug** pane for
  `[TypeAgent] Bridge…` lines indicating whether discovery succeeded and
  which port was used. Set `TYPEAGENT_VS_USE_DISCOVERY=false` to force the
  hardcoded fallback (5680) if you suspect the discovery channel itself.
- **Action ran but did nothing visible.** Check the Visual Studio **Output**
  window and the agent-server logs; EnvDTE silently no-ops on some commands
  when the relevant context (e.g. an active document, an active debug session)
  is missing.

## TODO — feature enhancements

None of these are in flight.

### Candidate actions / action groups

New groups and additions to existing groups, formatted to match the
**Action Categories** table above.

| Category                              | Proposed actions                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **solutionManagement** _(new)_        | openSolution, closeSolution, switchConfiguration (Debug/Release/…), setStartupProject, addProject, removeProject, listProjects |
| **testRunner** _(new)_                | runAllTests, runTestsInFile, runTest, rerunFailedTests, debugTest, listTests                                                   |
| **diagnostics** _(new)_               | getErrorList (errors/warnings/info), getBuildOutput, getOutputPane (Build/Debug/General/…), clearOutputPane                    |
| **packageManagement** _(new — NuGet)_ | installPackage, uninstallPackage, updatePackage, listPackages, restorePackages                                                 |
| **buildAndRun** _(extend)_            | buildProject, cleanProject, rebuild, rebuildProject, runWithoutDebugging                                                       |
| **searchAndNavigation** _(extend)_    | gotoDefinition, gotoImplementation, findAllReferences, gotoSymbol, gotoFile, navigateBack, navigateForward                     |
| **editActions** _(extend)_            | insertTextAtLine, replaceSelection, replaceTextInFile, formatDocument, toggleLineComment, selectLines                          |
| **fileOperations** _(extend)_         | saveActiveDocument, closeActiveDocument, renameFile, newFile, addExistingItem                                                  |
| **breakpointsManagement** _(extend)_  | enableBreakpoint, disableBreakpoint, setHitCount, setCondition, listBreakpoints, clearAllBreakpoints                           |
| **debuggingControl** _(extend)_       | attachToProcess, detach, evaluateExpression, getCallStack, getLocals, setNextStatement, runToCursor                            |

Highest-leverage to land first, in opinion order: **diagnostics** (so the
model can react to build/error output instead of running blind), then
**testRunner**, **solutionManagement**, and symbol-level navigation under
**searchAndNavigation**.

### Infrastructure

- **Bridge reliability.** `bridge.send()` has no request timeout — a hung host
  stalls `executeAction` indefinitely. Also no reconnect on host disconnect,
  and only a single client is tracked at a time (last-connection-wins).
- **Tests.** No `*.spec.ts` exist for the agent; bridge framing and error
  paths are good first targets.
- **Schema-side validation.** Parameters like `line` are typed as `string` and
  parsed in the host — push numeric types into the schema so the dispatcher
  rejects bad input before it reaches EnvDTE.
