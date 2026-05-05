# Visual Studio TypeAgent — host extension

Host-side plugin that turns the [`visualstudio-agent`](../) into a chat panel inside Visual Studio.

```
+-------------------------------+        +--------------------+
|  Visual Studio (this VSIX)    |        |  TypeAgent         |
|                               |        |  agent-server      |
|  +------------------------+   |   WS   |  (external)        |
|  |  ChatToolWindow        |<--|------->|                    |
|  |   WebView2             |   |  8999  |  +--------------+  |
|  |     chat-ui (HTML/JS)  |   |        |  | dispatcher   |  |
|  +------------------------+   |        |  +------+-------+  |
|                               |        |         |          |
|  +------------------------+   |        |  +------v-------+  |
|  |  AgentBridgeClient.cs  |<--|---WS---|->| visualstudio |  |
|  |   DTEActionExecutor.cs |   |  5678  |  |    agent     |  |
|  +-----------+------------+   |        |  +--------------+  |
|              |                |        +--------------------+
|              v EnvDTE         |
|         (Solution, Build,     |
|          Debugger, Editor)    |
+-------------------------------+
```

The agent-server is **externally managed** — start it before launching VS. The VSIX has two WebSocket clients:

1. **Chat channel** — WebView2 connects to `ws://localhost:8999` and renders chat using the shared `chat-ui` package.
2. **Action bridge** — C# host connects to `ws://localhost:5678` (the `visualstudio-agent`'s bridge) and dispatches incoming actions through EnvDTE.

## Layout

```
host/
├── csharp/                          # VSIX project (.NET / WPF)
│   ├── VisualStudioTypeAgent.sln
│   ├── VisualStudioTypeAgent.csproj
│   ├── source.extension.vsixmanifest
│   ├── TypeAgentPackage.cs          # AsyncPackage entry; registers tool window
│   ├── ChatToolWindowCommand.cs     # "View → Other Windows → TypeAgent Chat"
│   ├── ChatToolWindow.cs            # ToolWindowPane wrapper
│   ├── ChatToolWindowControl.xaml   # WPF host with WebView2
│   ├── ChatToolWindowControl.xaml.cs
│   ├── Bridge/
│   │   ├── AgentBridgeClient.cs     # WS client → port 5678
│   │   └── DTEActionExecutor.cs     # actionName → EnvDTE call
│   └── webview-content/             # Populated at build time from ../webview/dist
│       └── (.gitignore'd)
└── webview/                         # WebView2 content (TS, bundled via Vite)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.ts
        ├── dispatcherConnection.ts  # Adapted from packages/agents/browser/...
        └── platformAdapter.ts       # Link clicks → window.chrome.webview
```

## Build

Two stages — the WebView2 bundle (Node) then the VSIX (MSBuild):

```powershell
# 1. Build the WebView2 content
cd host\webview
pnpm install
pnpm run build           # outputs to dist/

# 2. Copy bundled assets into the VSIX project's webview-content/
xcopy /E /Y dist ..\csharp\webview-content\

# 3. Build the VSIX
cd ..\csharp
msbuild VisualStudioTypeAgent.sln /p:Configuration=Release
# .vsix lands in csharp\bin\Release\
```

## Install

Double-click the `.vsix` and follow the VSIX installer. Or for development, F5 from Visual Studio with the project loaded — launches an experimental instance with the extension loaded.

## Run

1. Start the TypeAgent agent-server (e.g. `pnpm --filter agent-server start` or however you normally do it).
2. Ensure the `visualstudio-agent` is enabled in your dispatcher config.
3. Launch Visual Studio.
4. **View → Other Windows → TypeAgent Chat**.
5. The chat panel connects to `ws://localhost:8999`. Once connected, the C# bridge connects to `ws://localhost:5678` automatically.
