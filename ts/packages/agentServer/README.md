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
Shell (Electron)              CLI (Node.js)              IDE / editor extensions
   │  in-process (default)       │  always remote            │  always remote
   │  OR --connect               │                           │  (vscode-shell, etc.)
   └──────────────┬──────────────┴──────────────┬────────────┘
                  │                             │
                  │   ws://localhost:8999  (configurable)
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

### Single-instance, well-known port

The agent-server binds a **well-known TCP port** (default `8999`, override via the `AGENT_SERVER_PORT` environment variable or `--port` flag). Clients on the same machine connect to `ws://localhost:${AGENT_SERVER_PORT ?? 8999}` directly — there is no discovery file.

This mirrors how a future cloud-hosted AS would look: a stable, configured URL is the contract. Local AS uses the same model so client code does not have to special-case "local" vs "remote".

There is at most one agent-server per data-dir profile: the server takes an exclusive OS-level lock on its instance directory at startup (`lockInstanceDir`), so a second `agent-server` invocation against the same `TYPEAGENT_USER_DATA_DIR` exits with `ERR_INSTANCE_LOCKED`. Workflows that need parallel agent-servers (benchmark workers, integration tests, side-by-side dev profiles) set both a per-worker `TYPEAGENT_USER_DATA_DIR` *and* a per-worker `AGENT_SERVER_PORT`.

To coordinate concurrent client spawns targeting the same port, the client library uses a per-port lockfile in the OS temp dir; only one client wins the spawn race, the others fall through to a TCP probe + connect.

Cross-machine connections are still supported: connect from another host with an explicit URL via `connectAgentServer(url)`.

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

# Start (binds AGENT_SERVER_PORT, default 8999)
pnpm --filter agent-server start

# Start with a named config (e.g. loads config.test.json)
pnpm --filter agent-server start -- --config test

# Pin to a specific port (overrides AGENT_SERVER_PORT for this run)
pnpm --filter agent-server start -- --port 9000

# Stop (sends shutdown via RPC at AGENT_SERVER_PORT, default 8999)
pnpm --filter agent-server stop
```

### With node directly

```bash
# From the repo root — binds AGENT_SERVER_PORT (default 8999)
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js

# With optional config name and explicit port
node --disable-warning=DEP0190 ts/packages/agentServer/server/dist/server.js \
    --config test --port 9000
```

On startup the server logs `Agent server started at ws://localhost:<port>`.

A graceful shutdown (`server stop` / RPC `shutdown`) closes the WebSocket and exits the process. If graceful shutdown fails (e.g. the server hung), kill it via your OS tools (`Stop-Process -Id <pid>` on Windows, `kill -9 <pid>` on POSIX).

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
Client calls ensureAgentServer({ hidden?, idleTimeout? })
  │
  ├─ TCP-probe ws://localhost:${AGENT_SERVER_PORT ?? 8999}
  │   ├─ Answers → return { port, url } — no spawn
  │   └─ No answer
  │       ├─ Acquire per-port spawn lockfile (OS temp dir)
  │       │   ├─ Won race  → spawnAgentServer(port) — detached child
  │       │   └─ Lost race → wait via TCP probe
  │       ├─ Wait for the port to start answering (30 s timeout)
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

Read-only lookups (e.g. for IDE/editor extensions like `vscode-shell`, which never spawn their own AS) use `lookupAgentServer()` — same TCP probe, returns `undefined` instead of spawning when no live AS answers.

On disconnect, the server removes all of that connection's conversations from its routing table.

---

## Shell integration

[`packages/shell/src/main/instance.ts`](../shell/src/main/instance.ts) supports two modes:

**Standalone (default)** — dispatcher runs in-process inside the Electron main process.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ in-process Dispatcher
```

**Connected (`--connect`)** — connects to a running agentServer (or auto-spawns one) at the configured well-known port.

```
Chat UI (renderer) ↔ IPC ↔ Main process ↔ WebSocket ↔ agentServer
```

The shell does not pin a port — `--connect` simply means "connect (and auto-spawn if needed) the agent-server at `AGENT_SERVER_PORT`" rather than running the dispatcher in-process.

---

## CLI integration

The CLI ([`packages/cli/`](../cli/)) always uses remote connection via WebSocket.

```
Terminal ↔ ConsoleClientIO ↔ WebSocket ↔ agentServer
```

### `agent-cli connect` (interactive)

`connect` calls `ensureAgentServer({ hidden, idleTimeout })` to auto-spawn the server if no live AS answers at the configured URL, then calls `connectAgentServer()` and `joinConversation()` directly. By default the spawned server window is visible; pass `--hidden` to suppress it. Pass `--idle-timeout <seconds>` to enable idle shutdown when spawning (default: `0`, server stays alive indefinitely).

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
Client → ensureAgentServer({ hidden })
       → TCP-probe ws://localhost:8999 → answers → return { port, url }
Client → connectAgentServer(url) → joinConversation() → Dispatcher proxy
```

**Shell or CLI — server not yet running**

```
Client → ensureAgentServer({ hidden, idleTimeout })
       → probe fails → acquire per-port spawn lock
       → spawnAgentServer(8999) (hidden or visible window)
       → server binds AGENT_SERVER_PORT (default 8999)
       → poll TCP probe until the port answers (30 s timeout)
Client → connectAgentServer(url) → joinConversation() → Dispatcher proxy
```

**Headless server**

```
pnpm --filter agent-server start
→ binds AGENT_SERVER_PORT (default 8999)
→ any number of Shell/CLI clients can connect and share conversations
```

**Stopping the server**

```bash
agent-cli server stop              # via CLI (RPC at the configured URL)
pnpm --filter agent-server stop    # via pnpm script
```

---

## Conversation persistence

Conversation metadata is stored at `~/.typeagent/profiles/dev/conversations/conversations.json`. Each conversation's data (chat history, conversation memory, display log) lives under `~/.typeagent/profiles/dev/conversations/<conversationId>/`.

---

## Sub-package details

- [protocol/README.md](protocol/README.md) — channel names, RPC types, conversation types, client-type registry
- [client/README.md](client/README.md) — connection model, `ensureAgentServer`, `lookupAgentServer`, `connectAgentServer`, smoke driver
- [server/README.md](server/README.md) — server entry point, well-known port binding, `ConversationManager`, `SharedDispatcher`, routing ClientIO
- [docs/manual-smoke.md](docs/manual-smoke.md) — manual smoke scenarios (multi-instance, UI flows, idle timeout, etc.) not covered by the automated smoke driver

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
