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
Shell (Electron)              CLI (Node.js)              vscode-shell
   │  in-process (default)       │  always remote            │  always remote
   │  OR --connect               │                           │
   └──────────────┬──────────────┴──────────────┬────────────┘
                  │                             │
                  │   ws://localhost:<ephemeral port>
                  │   (port discovered via ~/.typeagent/agent-server.json)
                  │
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

### Single-instance, ephemeral port, file-based discovery

The agent-server picks an **ephemeral TCP port** at startup (the OS assigns a free port via `{ port: 0 }`) and publishes its `{port, pid, startedAt}` to a discovery file at `~/.typeagent/agent-server.json`. Clients on the same machine read this file to find the server — there is **no well-known port**.

There is at most one agent-server per machine: the server takes an exclusive OS-level lock on its instance directory at startup (`lockInstanceDir`), so a second `agent-server` invocation exits with `ERR_INSTANCE_LOCKED`. Concurrent client spawns therefore land on the same agent-server rather than racing to start two.

Cross-machine discovery is explicitly out of scope: connect from another host with an explicit URL via `connectAgentServer(url)`.

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

# Start (picks an ephemeral port, writes ~/.typeagent/agent-server.json)
pnpm --filter agent-server start

# Start with a named config (e.g. loads config.test.json)
pnpm --filter agent-server start -- --config test

# Pin to a specific port (for tests or remote-host setups)
pnpm --filter agent-server start -- --port 9000

# Stop (sends shutdown via RPC; resolves port from the discovery file)
pnpm --filter agent-server stop
```

### With node directly

```bash
# From the repo root — picks an ephemeral port
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js

# With optional config name
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js --config test
```

On startup the server logs `Agent server started at ws://localhost:<port>` (where `<port>` is the OS-assigned ephemeral port unless `--port` was passed) and writes a discovery file:

```json
// ~/.typeagent/agent-server.json
{ "port": 64357, "pid": 22940, "startedAt": "2026-05-08T22:47:37.875Z" }
```

The file is removed on graceful shutdown. A stale file (process dead, or port not answering) is treated as "no server" and the next client to call `ensureAgentServerViaDiscovery()` spawns a fresh one.

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
Client calls ensureAgentServerViaDiscovery({ hidden?, idleTimeout? })
  │
  ├─ Read ~/.typeagent/agent-server.json
  │   ├─ File present, pid alive, port answers
  │   │   └─ Return { port, url } — no spawn
  │   └─ Missing or stale
  │       ├─ spawnAgentServer() — detached child, no --port flag
  │       │   (lockInstanceDir resolves concurrent spawn races)
  │       ├─ Wait for discovery file to appear with a live pid + reachable port (60 s timeout)
  │       └─ Return { port, url }
  │
Client calls connectAgentServer(url)
  │
  ├─ Open WebSocket → create RPC channels
  │
  ├─ Send joinConversation({ conversationId, clientType, filter }) on agent-server channel
  │   └─ Server assigns connectionId, returns { connectionId, conversationId }
  │
  └─ Return AgentServerConnection (call .joinConversation() to get a Dispatcher proxy)
```

Read-only discovery (e.g. for the vscode-shell extension, which never spawns its own AS) goes through `lookupAgentServerViaDiscovery()` — same lookup, returns `undefined` instead of spawning when no live AS is published.

On disconnect, the server removes all of that connection's conversations from its routing table.

---

## Shell integration

[`packages/shell/src/main/instance.ts`](../shell/src/main/instance.ts) supports two modes:

**Standalone (default)** — dispatcher runs in-process inside the Electron main process.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ in-process Dispatcher
```

**Connected (`--connect`)** — connects to a running agentServer (or auto-spawns one) via the discovery file.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ WebSocket ↔ agentServer
```

The shell does not pin a port — `--connect` simply means "auto-discover or auto-spawn the agent-server" rather than running the dispatcher in-process.

---

## CLI integration

The CLI ([`packages/cli/`](../cli/)) always uses remote connection via WebSocket.

```
Terminal ↔ ConsoleClientIO ↔ WebSocket ↔ agentServer
```

### `agent-cli connect` (interactive)

`connect` calls `ensureAgentServerViaDiscovery({ hidden, idleTimeout })` to auto-spawn the server if no live AS is published in the discovery file, then calls `connectAgentServer()` and `joinConversation()` directly. By default the spawned server window is visible; pass `--hidden` to suppress it. Pass `--idle-timeout <seconds>` to enable idle shutdown when spawning (default: `0`, server stays alive indefinitely).

### `agent-cli run` (non-interactive)

The `run request`, `run translate`, and `run explain` subcommands also call `ensureAgentServerViaDiscovery()` — but default to **hidden** (no window), with `--show` to opt into a visible window. All three support `--conversation <id>` to target a specific conversation instead of the default `"CLI"` conversation. When spawning, passes `--idle-timeout 600` so the server exits 10 minutes after the last client disconnects.

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
Client → ensureAgentServerViaDiscovery({ hidden })
       → reads ~/.typeagent/agent-server.json
       → pid alive, port answers → return existing { port, url }
Client → connectAgentServer(url) → joinConversation() → Dispatcher proxy
```

**Shell or CLI — server not yet running**

```
Client → ensureAgentServerViaDiscovery({ hidden, idleTimeout })
       → discovery file missing or stale
       → spawnAgentServer() (hidden or visible window, no --port flag)
       → server picks ephemeral port, writes ~/.typeagent/agent-server.json
       → poll discovery file until pid alive + port answers (60 s timeout)
Client → connectAgentServer(url) → joinConversation() → Dispatcher proxy
```

**Headless server**

```
pnpm --filter agent-server start
→ picks an ephemeral port
→ writes ~/.typeagent/agent-server.json
→ any number of Shell/CLI clients can connect and share conversations
```

**Stopping the server**

```bash
agent-cli server stop              # via CLI (resolves port from the discovery file)
pnpm --filter agent-server stop    # via pnpm script
```

---

## Conversation persistence

Conversation metadata is stored at `~/.typeagent/profiles/dev/conversations/conversations.json`. Each conversation's data (chat history, conversation memory, display log) lives under `~/.typeagent/profiles/dev/conversations/<conversationId>/`.

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, conversation types, client-type registry
- [client/README.md](client/README.md) — discovery model, `ensureAgentServerViaDiscovery`, `lookupAgentServerViaDiscovery`, `connectAgentServer`, smoke driver
- [server/README.md](server/README.md) — server entry point, ephemeral port + discovery file publication, `ConversationManager`, `SharedDispatcher`, routing ClientIO

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
