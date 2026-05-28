# Visual Studio TypeAgent — host extension

Host-side plugin that turns the [`visualstudio-agent`](../) into a chat panel inside Visual Studio.

```
+-------------------------------+        +--------------------+
|  Visual Studio (the VSIX)     |        |  TypeAgent         |
|                               |        |  agent-server      |
|  +------------------------+   |   WS   |  (external)        |
|  |  ChatToolWindow        |<--|------->|                    |
|  |   WebView2             |   |  8999  |  +--------------+  |
|  |     chat-ui (HTML/JS)  |   |        |  | dispatcher   |  |
|  +------------------------+   |        |  +------+-------+  |
|                               |        |         |          |
|  +------------------------+   |        |  +------v-------+  |
|  |  AgentBridgeClient.cs  |<--|---WS---|->| visualstudio |  |
|  |   DTEActionExecutor.cs |   | ephem. |  |    agent     |  |
|  +-----------+------------+   |        |  +--------------+  |
|              |                |        +--------------------+
|              v EnvDTE         |
|         (Solution, Build,     |
|          Debugger, Editor)    |
+-------------------------------+
```

The agent-server is **externally managed** — start it before launching VS. The VSIX has two WebSocket clients:

1. **Chat channel** — WebView2 connects to `ws://localhost:8999` and renders chat using the shared `chat-ui` package.
2. **Action bridge** — C# host discovers the `visualstudio-agent`'s ephemeral bridge port via the dispatcher's discovery channel (`AGENT_SERVER_PORT`, default 8999) and dispatches incoming actions through EnvDTE. See [`Bridge/BridgeDiscovery.cs`](../../../../../dotnet/visualStudioTypeAgent/Bridge/BridgeDiscovery.cs).

## Layout

The VSIX C# project lives under the repo's `dotnet/` tree so it picks up the
shared `dotnet/.editorconfig` (StyleCop-ish rules: braces, formatting, etc.):

```
ts/packages/agents/visualStudio/
├── src/                            # TS agent (action handler, schema)
└── host/
    └── webview/                    # WebView2 content (TS, bundled via Vite)
        ├── package.json
        ├── tsconfig.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── main.ts
            ├── dispatcherConnection.ts
            └── platformAdapter.ts

dotnet/visualStudioTypeAgent/       # VSIX project (.NET / WPF)
├── VisualStudioTypeAgent.sln
├── VisualStudioTypeAgent.csproj
├── source.extension.vsixmanifest
├── TypeAgentPackage.cs             # AsyncPackage entry; registers tool window
├── ChatToolWindowCommand.cs        # "View → Other Windows → TypeAgent Chat"
├── ChatToolWindow.cs               # ToolWindowPane wrapper
├── ChatToolWindowControl.xaml      # WPF host with WebView2
├── ChatToolWindowControl.xaml.cs
├── Bridge/
│   ├── BridgeDiscovery.cs          # Discovery RPC → agent-server (8999)
│   ├── AgentBridgeClient.cs        # WS client → discovered bridge port
│   └── DTEActionExecutor.cs        # actionName → EnvDTE call
└── webview-content/                # Populated at build time from
    └── (.gitignore'd)              #   host/webview/dist
```

## Build

Two stages — the WebView2 bundle (Node) then the VSIX (MSBuild):

```powershell
# 1. Build the WebView2 content
cd ts\packages\agents\visualStudio\host\webview
pnpm install
pnpm run build           # outputs to dist/

# 2. Copy bundled assets into the VSIX project's webview-content/
xcopy /E /Y dist ..\..\..\..\..\..\dotnet\visualStudioTypeAgent\webview-content\

# 3. Build the VSIX
cd ..\..\..\..\..\..\dotnet\visualStudioTypeAgent
msbuild VisualStudioTypeAgent.sln /p:Configuration=Release
# .vsix lands in bin\Release\
```

## Install

Double-click the `.vsix` and follow the VSIX installer. Or for development, F5 from Visual Studio with the project loaded — launches an experimental instance with the extension loaded.

## Run

1. Start the TypeAgent agent-server (e.g. `pnpm --filter agent-server start` or however you normally do it).
2. Ensure the `visualstudio-agent` is enabled in your dispatcher config.
3. Launch Visual Studio.
4. **View → Other Windows → TypeAgent Chat**.
5. The chat panel connects to `ws://localhost:8999`. The C# bridge then queries the dispatcher's discovery channel for the agent's ephemeral bridge port and connects automatically.
