# agentServer

The agentServer hosts a **shared TypeAgent dispatcher** over WebSocket, allowing multiple clients (Shell, CLI, extensions) to share a single running dispatcher instance. It is split into three sub-packages:

| Package | npm name | Purpose |
|---|---|---|
| `protocol/` | `agent-server-protocol` | RPC channel names, join/shutdown types, client-type registry |
| `client/` | `agent-server-client` | Client library: connect, auto-spawn, stop |
| `server/` | `agent-server` | Long-running WebSocket server with shared dispatcher |

---

## Architecture

```
Shell (Electron)              CLI (Node.js)
   │  in-process (default)       │  always remote
   │  OR WebSocket               │
   └──────────────┬──────────────┘
                  │ ws://localhost:8999
         ┌────────▼────────┐
         │   agentServer   │
         │                 │
         │  ┌───────────┐  │
         │  │  Routing  │  │   routes ClientIO callbacks
         │  │  ClientIO │  │   back to correct client
         │  └─────┬─────┘  │   by connectionId
         │        │        │
         │  ┌─────▼─────┐  │
         │  │  Shared   │  │   one instance shared
         │  │Dispatcher │  │   by all connected clients
         │  └───────────┘  │
         └─────────────────┘
```

### Three RPC channels per connection

Each WebSocket connection multiplexes three independent JSON-RPC channels:

| Channel | Direction | Purpose |
|---|---|---|
| `AgentServer` | client → server | Lifecycle: `join()`, `shutdown()` |
| `Dispatcher` | client → server | Commands: `processCommand()`, `getCommandCompletion()`, etc. |
| `ClientIO` | server → client | Display/interaction callbacks: `setDisplay()`, `askYesNo()`, etc. |

### Shared dispatcher + routing ClientIO

A single `Dispatcher` instance is created at server startup and shared by all connected clients. Each `processCommand()` call carries a `ClientRequestId = { connectionId, requestId }`. When the dispatcher (or an agent) calls a `ClientIO` method, the **routing ClientIO** layer uses `connectionId` to forward the callback to the correct client's WebSocket.

This means:
- Agents are loaded once and shared across clients.
- Per-client state (session, cache) is isolated by `connectionId`.
- Agents are unaware that multiple clients are connected.

---

## Connection lifecycle

```
Client calls ensureAndConnectDispatcher(clientIO, port)
  │
  ├─ Check: is server already listening on ws://localhost:<port>?
  │   └─ No → spawnAgentServer() — detached child process, survives parent exit
  │   └─ Yes → continue
  │
  ├─ Open WebSocket → create 3 RPC channels
  │
  ├─ Send join({ clientType, filter }) on AgentServer channel
  │   └─ Server assigns connectionId, registers client type
  │
  └─ Return Dispatcher RPC proxy to caller
```

On disconnect, the server removes the client from its routing table and cleans up the connection.

---

## Shell integration

[`packages/shell/src/main/instance.ts`](../shell/src/main/instance.ts) supports two modes:

**Standalone (default)** — dispatcher runs in-process inside the Electron main process. No WebSocket overhead, fastest for single-user desktop use.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ in-process Dispatcher
```

**Connected (`--connect <port>`)** — connects to a running agentServer. Enables sharing a dispatcher across multiple Shell windows or CLI sessions.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ WebSocket ↔ agentServer
```

The Shell also registers its own `AppAgentProvider` ([`agent.ts`](../shell/src/main/agent.ts)) for shell-specific commands (themes, voice mode, etc.).

---

## CLI integration

The CLI ([`packages/cli/src/commands/connect.ts`](../cli/src/commands/connect.ts)) always uses remote connection. It calls `ensureAndConnectDispatcher()`, which auto-spawns the server if it is not already running, then enters an interactive readline loop (or processes a single `--request`).

```
Terminal ↔ EnhancedConsoleClientIO ↔ WebSocket ↔ agentServer
```

---

## Startup scenarios

**Shell standalone (default)**
```
Shell launches → createDispatcher() in-process → no server involved
```

**Shell or CLI with running server**
```
Client → ensureAndConnectDispatcher(port=8999)
       → server already running → connect → join() → get Dispatcher proxy
```

**Server not yet running**
```
Client → ensureAndConnectDispatcher(port=8999)
       → server not found → spawnAgentServer()
       → poll until ready (60 s timeout)
       → connect → join() → get Dispatcher proxy
```

**Headless server only**
```
node packages/agentServer/server/dist/server.js
→ listens on ws://localhost:8999
→ any number of Shell/CLI clients can connect and share the dispatcher
```

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, client-type registry
- [client/README.md](client/README.md) — `connectDispatcher`, `ensureAndConnectDispatcher`, `stopAgentServer`
- [server/README.md](server/README.md) — server entry point, `createSharedDispatcher`, routing ClientIO

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
