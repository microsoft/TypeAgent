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

### Server flags

| Flag                       | Description                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--port <port>`            | Port to listen on (default: 8999)                                                                                                       |
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

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
