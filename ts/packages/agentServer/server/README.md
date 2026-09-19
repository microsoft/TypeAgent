# agent-server

Long-running WebSocket server that hosts TypeAgent dispatchers with full conversation management.

## Starting the server

### With pnpm (from the `ts/` directory)

```bash
# Start
pnpm --filter agent-server start

# Start with a named config (e.g. loads config.test.json)
pnpm --filter agent-server start -- --config test

# Stop (sends shutdown via RPC)
agent-cli server stop              # Client Side command
pnpm --filter agent-server stop    # Server Side command
```

### With node directly

```bash
node --disable-warning=DEP0190 packages/agentServer/server/dist/server.js

# With optional config name
node --disable-warning=DEP0190 packages/agentServer/server/dist/server.js --config test
```

Listens on `ws://localhost:8999`. The server also starts automatically when clients call `ensureAgentServer()`.

### Network exposure

The listener binds loopback (`127.0.0.1`), so only this machine can reach it,
and refuses WebSocket upgrades whose `Origin` is neither a loopback page nor a
TypeAgent browser extension. This matters because the server has no
authentication: a client that connects can join conversations, read the signed-in
user's identity, and run agent commands with the local user's permissions.

For cross-device access use the [dev tunnel](#dev-tunnel-cross-device-access) -
the tunnel host runs on this machine and reaches the server over loopback, so it
works unchanged.

`--host <address>` (or `AGENT_SERVER_HOST`) widens the bind for deployments that
must publish the port, such as a container that isolates the workspace. The
server prints a warning banner whenever it binds anything but loopback; only do
this behind a network boundary you control.

### Server flags

| Flag                       | Description                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <port>`            | Port to listen on (default: 8999)                                                                                                       |
| `--host <address>`         | Address to bind (default: `127.0.0.1`). Also settable via `AGENT_SERVER_HOST`.                                                          |
| `--config <name>`          | Load `config.<name>.json` instead of the default config                                                                                 |
| `--idle-timeout <seconds>` | Exit after this many seconds with no connected clients (default: disabled). The CLI passes 600 (10 min) when it auto-spawns the server. |

---

## Key components

### `server.ts` — WebSocket listener

1. Creates a `ConversationManager` at startup with agent providers and storage options.
2. Calls `createWebSocketChannelServer(8999)` to accept connections.
3. For each connection, exposes `AgentServerInvokeFunctions` over the `agent-server` RPC channel:
   - `joinConversation` / `leaveConversation` — join or leave a named conversation
   - `createConversation` / `listConversations` / `renameConversation` / `deleteConversation` — conversation CRUD
   - `shutdown` — graceful server shutdown via `conversationManager.close()`

### `conversationManager.ts` — Conversation pool

Maintains a pool of per-conversation `SharedDispatcher` instances. Key behaviors:

- **Persistence:** conversation metadata stored in `~/.typeagent/profiles/dev/conversations/conversations.json`; each conversation's data in `~/.typeagent/profiles/dev/conversations/<conversationId>/`
- **Lazy init:** each conversation's `SharedDispatcher` is created on first `joinConversation()` and torn down after 5 minutes of inactivity
- **Auto-create:** if no conversation exists and no `conversationId` is provided, a `"default"` conversation is created automatically
- **Startup sweep:** on server start, conversations prefixed `cli-ephemeral-` or `cli-replay-` are automatically deleted to reclaim any orphaned ephemeral conversations left over from crashed CLI processes
- **Idle shutdown:** when `--idle-timeout <seconds>` is passed, the server calls `process.exit(0)` after that many seconds with no WebSocket connections. The timer resets whenever a new client connects.

### `sharedDispatcher.ts` — Routing layer

`createSharedDispatcher()` wraps a single underlying dispatcher context and manages multiple client connections within one conversation.

**On `join(clientIO, closeFn, options)`:**

- Assigns a `connectionId` (auto-incrementing integer, as string)
- Stores the client's `ClientIO` in a routing table
- Registers the client type in the protocol registry
- Returns a per-connection `Dispatcher` whose commands are tagged with `connectionId`

**Routing ClientIO:**

When the dispatcher or an agent calls a `ClientIO` method, the routing layer uses `requestId.connectionId` to forward the call to the correct client. This isolates each client's display output even though they share one dispatcher and conversation context.

| Method type                                                         | Routing                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Display (`setDisplay`, `appendDisplay`, `notify`, `setUserRequest`) | Forwarded to the client matching `connectionId`              |
| Interactive (`askYesNo`, `proposeAction`, `requestChoice`)          | Forwarded to the originating client; awaits response         |
| Broadcast                                                           | Sent to all clients (filter flag controls per-client opt-in) |

---

## Coding working directories

Coding requests execute against the agent-server filesystem. A connected
client's `workingDirectory` is therefore only a proposal; the server
canonicalizes it and applies its own policy before the dispatcher sees it.

- `TYPEAGENT_CODE_ALLOWED_ROOTS` is a path-delimited list of server-local roots
  clients may select (`;` on Windows, `:` on Linux/macOS). When omitted, the
  server does not add a root restriction.
- `TYPEAGENT_CODE_DEFAULT_WORKING_DIRECTORY` is a server-local directory used
  when the client omits a path or proposes one outside the allowed roots. When
  omitted, a local agent-server defaults to its process working directory.
- `TYPEAGENT_CODING_SESSION_MAX_AGE_DAYS` controls when persisted TypeAgent
  coding sessions are deleted. The default is seven days. Cleanup only targets
  session IDs beginning with `typeagent-code-`.

For remote or multi-user deployments, configure both settings and isolate
workspaces at the process/container boundary. If no authorized proposal or
default exists, non-coding requests continue normally, while coding requests
report that no server-side working directory is available.

When a request contains an existing absolute server-local file or directory
path, the server uses that path (or the file's parent directory) as the proposed
coding root. Users can also say, for example, `Use C:\work\project as my coding
working directory`; the selection remains active for later requests from that
connected client and remains subject to the server allowlist.

The allowlist is a deployment security boundary and cannot be widened through
natural language. With `TYPEAGENT_CODE_ALLOWED_ROOTS` unset, any existing local
directory is selectable. When it is set, users can switch only among directories
under those configured roots.

---

## Dev Tunnel (cross-device access)

Expose the agent-server to another device (phone, tablet, second laptop) via a
Microsoft Dev Tunnel. The tunnel provides a public `wss://…devtunnels.ms` URL that
relays WebSocket traffic to your local port 8999.

### Prerequisites

- `devtunnel` CLI installed: `winget install Microsoft.devtunnel`
- Signed in: `devtunnel user login`

### One-time setup

From the workspace root (`ts/`):

```bash
pnpm run devtunnel:setup
```

Creates a persistent tunnel, forwards port 8999, and writes
`~/.typeagent/devtunnel.json`. Prints your client URL and connect-token command.

### Start with tunnel

```bash
pnpm run start:tunnel
```

Starts the agent-server and brings up the tunnel host so remote clients can
connect. Equivalent to running `pnpm start` + `node typeagent-serve.mjs tunnel start`
separately.

### Check status and get client URL

```bash
pnpm run devtunnel:status          # from ts/
# or
node ../../../tools/scripts/typeagent-serve.mjs tunnel status
```

### Stop the tunnel host

```bash
node ../../../tools/scripts/typeagent-serve.mjs tunnel stop
```

The agent-server continues running locally; only the remote relay is stopped.

### How it works

When a client calls `discoverPort` with `remote: true`, the server's tunnel
resolver (`tunnelResolver.ts`) checks whether a tunnel mapping exists for the
requested port and verifies the host is live (`devtunnel show --json`). If both
conditions are met, it returns the `wss://` tunnel URL; otherwise it falls back
to `localhost`.

Enable debug logging with `DEBUG=agent-server:tunnel`.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
