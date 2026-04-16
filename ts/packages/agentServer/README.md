# agentServer

The agentServer hosts a **TypeAgent dispatcher over WebSocket**, allowing multiple clients (Shell, CLI, extensions) to share a single running dispatcher instance with full session management. It is split into three sub-packages:

| Package     | npm name                | Purpose                                                                      |
| ----------- | ----------------------- | ---------------------------------------------------------------------------- |
| `protocol/` | `agent-server-protocol` | RPC channel names, session types, client-type registry                       |
| `client/`   | `agent-server-client`   | Client library: connect, session management, auto-spawn, stop                |
| `server/`   | `agent-server`          | Long-running WebSocket server with `SessionManager` and per-session dispatch |

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
         │  SessionManager │
         │  ┌────────────┐ │
         │  │ Session A  │ │  ← clients 0, 1
         │  │ Dispatcher │ │
         │  ├────────────┤ │
         │  │ Session B  │ │  ← client 2
         │  │ Dispatcher │ │
         │  └────────────┘ │
         └─────────────────┘
```

Each session has its own `SharedDispatcher` instance with isolated chat history, conversation memory, display log, and persist directory. Clients connected to the same session share one dispatcher; clients in different sessions are fully isolated.

### RPC channels per connection

Each WebSocket connection multiplexes independent JSON-RPC channels:

| Channel                  | Direction       | Purpose                                                            |
| ------------------------ | --------------- | ------------------------------------------------------------------ |
| `agent-server`           | client → server | Session lifecycle: `joinSession`, `leaveSession`, CRUD, `shutdown` |
| `dispatcher:<sessionId>` | client → server | Commands: `processCommand`, `getCommandCompletion`, etc.           |
| `clientio:<sessionId>`   | server → client | Display/interaction callbacks: `setDisplay`, `askYesNo`, etc.      |

The dispatcher and clientIO channels are namespaced by `sessionId`, allowing a single WebSocket connection to participate in multiple sessions simultaneously.

---

## Starting and stopping the server

### With pnpm (recommended)

From the `ts/` directory:

```bash
# Build (if not already built)
pnpm run build agentServer

# Start
pnpm --filter agent-server start

# Start with a named config (e.g. loads config.test.json)
pnpm --filter agent-server start -- --config test

# Stop (sends shutdown via RPC)
pnpm --filter agent-server stop
```

### With node directly

```bash
# From the repo root
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js

# With optional config name
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js --config test
```

The server listens on `ws://localhost:8999` and logs `Agent server started at ws://localhost:8999` when ready.

---

## Session lifecycle

```
Client calls joinSession({ sessionId?, clientType, filter })
  │
  ├─ sessionId provided?
  │   ├─ Yes → look up sessions.json
  │   │   ├─ Found → load SharedDispatcher (lazy init if not in memory)
  │   │   └─ Not found → error: "Session not found"
  │   └─ No → connect to the default session
  │       └─ No sessions exist → auto-create session named "default"
  │
  ├─ Register client in session's SharedDispatcher routing table
  └─ Return { connectionId, sessionId }
```

Session dispatchers are automatically evicted from memory after 5 minutes with no connected clients.

---

## Connection lifecycle

```
Client calls ensureAgentServer(port, hidden)
  │
  └─ Is server already listening on ws://localhost:<port>?
      └─ No → spawnAgentServer() — detached child process, survives parent exit
               hidden=true suppresses the terminal/window

Client calls connectAgentServer(url)
  │
  ├─ Open WebSocket → create RPC channels
  │
  ├─ Send joinSession({ sessionId, clientType, filter }) on agent-server channel
  │   └─ Server assigns connectionId, returns { connectionId, sessionId }
  │
  └─ Return AgentServerConnection (call .joinSession() to get a Dispatcher proxy)
```

On disconnect, the server removes all of that connection's sessions from its routing table.

---

## Shell integration

[`packages/shell/src/main/instance.ts`](../shell/src/main/instance.ts) supports two modes:

**Standalone (default)** — dispatcher runs in-process inside the Electron main process.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ in-process Dispatcher
```

**Connected (`--connect <port>`)** — connects to a running agentServer.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ WebSocket ↔ agentServer
```

---

## CLI integration

The CLI ([`packages/cli/`](../cli/)) always uses remote connection via WebSocket.

```
Terminal ↔ ConsoleClientIO ↔ WebSocket ↔ agentServer
```

### `agent-cli connect` (interactive)

`connect` calls `ensureAgentServer(port, hidden, idleTimeout)` to auto-spawn the server if needed, then calls `connectAgentServer()` and `joinSession()` directly. By default the spawned server window is visible; pass `--hidden` to suppress it. Pass `--idle-timeout <seconds>` to enable idle shutdown when spawning (default: `0`, server stays alive indefinitely).

### `agent-cli run` (non-interactive)

The `run request`, `run translate`, and `run explain` subcommands also call `ensureAgentServer()` — but default to **hidden** (no window), with `--show` to opt into a visible window. All three support `--session <id>` to target a specific session instead of the default `"CLI"` session. When spawning, passes `--idle-timeout 600` so the server exits 10 minutes after the last client disconnects.

### `agent-cli replay`

`replay` always creates an ephemeral session (`cli-replay-<uuid>`) and deletes it on exit. Defaults to hidden; `--show` to opt in. Also passes `--idle-timeout 600` when spawning.

### `agent-cli server`

```bash
agent-cli server status    # check whether the server is running
agent-cli server stop      # send a graceful shutdown via RPC
```

---

## Startup scenarios

**Shell standalone (default)**

```
Shell launches → createDispatcher() in-process → no server involved
```

**Shell or CLI — server already running**

```
Client → ensureAgentServer(port=8999, hidden)
       → server already running → no-op
Client → connectAgentServer() → joinSession() → Dispatcher proxy
```

**Shell or CLI — server not yet running**

```
Client → ensureAgentServer(port=8999, hidden, idleTimeout)
       → server not found → spawnAgentServer() (hidden or visible window)
       → poll until ready (60 s timeout)
Client → connectAgentServer() → joinSession() → Dispatcher proxy
```

**Headless server**

```
pnpm --filter agent-server start
→ listens on ws://localhost:8999
→ any number of Shell/CLI clients can connect and share sessions
```

**Stopping the server**

```bash
agent-cli server stop              # via CLI (recommended)
pnpm --filter agent-server stop    # via pnpm script
```

---

## Session persistence

Session metadata is stored at `~/.typeagent/server-sessions/sessions.json`. Each session's data (chat history, conversation memory, display log) lives under `~/.typeagent/server-sessions/<sessionId>/`.

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, session types, client-type registry
- [client/README.md](client/README.md) — `connectAgentServer`, `ensureAndConnectDispatcher`, `stopAgentServer`
- [server/README.md](server/README.md) — server entry point, `SessionManager`, `SharedDispatcher`, routing ClientIO

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
