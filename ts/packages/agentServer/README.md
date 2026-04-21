# agentServer

The agentServer hosts a **TypeAgent dispatcher over WebSocket**, allowing multiple clients (Shell, CLI, extensions) to share a single running dispatcher instance with full conversation management. It is split into three sub-packages:

| Package     | npm name                | Purpose                                                                                |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `protocol/` | `agent-server-protocol` | RPC channel names, conversation types, client-type registry                            |
| `client/`   | `agent-server-client`   | Client library: connect, conversation management, auto-spawn, stop                     |
| `server/`   | `agent-server`          | Long-running WebSocket server with `ConversationManager` and per-conversation dispatch |

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
         │ ConversationManager│
         │  ┌────────────┐ │
         │  │ Convo A    │ │  ← clients 0, 1
         │  │ Dispatcher │ │
         │  ├────────────┤ │
         │  │ Convo B    │ │  ← client 2
         │  │ Dispatcher │ │
         │  └────────────┘ │
         └─────────────────┘
```

Each conversation has its own `SharedDispatcher` instance with isolated chat history, conversation memory, display log, and persist directory. Clients connected to the same conversation share one dispatcher; clients in different conversations are fully isolated.

### RPC channels per connection

Each WebSocket connection multiplexes independent JSON-RPC channels:

| Channel                       | Direction       | Purpose                                                                           |
| ----------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `agent-server`                | client → server | Conversation lifecycle: `joinConversation`, `leaveConversation`, CRUD, `shutdown` |
| `dispatcher:<conversationId>` | client → server | Commands: `processCommand`, `getCommandCompletion`, etc.                          |
| `clientio:<conversationId>`   | server → client | Display/interaction callbacks: `setDisplay`, `askYesNo`, etc.                     |

The dispatcher and clientIO channels are namespaced by `conversationId`, allowing a single WebSocket connection to participate in multiple conversations simultaneously.

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

## Conversation lifecycle

```
Client calls joinConversation({ conversationId?, clientType, filter })
  │
  ├─ conversationId provided?
  │   ├─ Yes → look up conversations.json
  │   │   ├─ Found → load SharedDispatcher (lazy init if not in memory)
  │   │   └─ Not found → error: "Conversation not found"
  │   └─ No → connect to the default conversation
  │       └─ No conversations exist → auto-create conversation named "default"
  │
  ├─ Register client in conversation's SharedDispatcher routing table
  └─ Return { connectionId, conversationId }
```

Conversation dispatchers are automatically evicted from memory after 5 minutes with no connected clients.

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
  ├─ Send joinConversation({ conversationId, clientType, filter }) on agent-server channel
  │   └─ Server assigns connectionId, returns { connectionId, conversationId }
  │
  └─ Return AgentServerConnection (call .joinConversation() to get a Dispatcher proxy)
```

On disconnect, the server removes all of that connection's conversations from its routing table.

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

`connect` calls `ensureAgentServer(port, hidden, idleTimeout)` to auto-spawn the server if needed, then calls `connectAgentServer()` and `joinConversation()` directly. By default the spawned server window is visible; pass `--hidden` to suppress it. Pass `--idle-timeout <seconds>` to enable idle shutdown when spawning (default: `0`, server stays alive indefinitely).

### `agent-cli run` (non-interactive)

The `run request`, `run translate`, and `run explain` subcommands also call `ensureAgentServer()` — but default to **hidden** (no window), with `--show` to opt into a visible window. All three support `--conversation <id>` to target a specific conversation instead of the default `"CLI"` conversation. When spawning, passes `--idle-timeout 600` so the server exits 10 minutes after the last client disconnects.

### `agent-cli replay`

`replay` always creates an ephemeral conversation (`cli-replay-<uuid>`) and deletes it on exit. Defaults to hidden; `--show` to opt in. Also passes `--idle-timeout 600` when spawning.

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
Client → connectAgentServer() → joinConversation() → Dispatcher proxy
```

**Shell or CLI — server not yet running**

```
Client → ensureAgentServer(port=8999, hidden, idleTimeout)
       → server not found → spawnAgentServer() (hidden or visible window)
       → poll until ready (60 s timeout)
Client → connectAgentServer() → joinConversation() → Dispatcher proxy
```

**Headless server**

```
pnpm --filter agent-server start
→ listens on ws://localhost:8999
→ any number of Shell/CLI clients can connect and share conversations
```

**Stopping the server**

```bash
agent-cli server stop              # via CLI (recommended)
pnpm --filter agent-server stop    # via pnpm script
```

---

## Conversation persistence

Conversation metadata is stored at `~/.typeagent/profiles/dev/conversations/conversations.json`. Each conversation's data (chat history, conversation memory, display log) lives under `~/.typeagent/profiles/dev/conversations/<conversationId>/`.

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, conversation types, client-type registry
- [client/README.md](client/README.md) — `connectAgentServer`, `ensureAndConnectConversation`, `stopAgentServer`
- [server/README.md](server/README.md) — server entry point, `ConversationManager`, `SharedDispatcher`, routing ClientIO

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
