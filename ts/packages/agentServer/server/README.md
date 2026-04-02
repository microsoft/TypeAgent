# agent-server

Long-running WebSocket server that hosts a shared TypeAgent dispatcher.

## Entry point

```
packages/agentServer/server/dist/server.js
```

Starts automatically when needed (via `spawnAgentServer()` in the client library), or can be started manually:

```bash
node packages/agentServer/server/dist/server.js
# Listening on ws://localhost:8999
```

## Key components

### `server.ts` — WebSocket listener

1. Calls `createSharedDispatcher()` once at startup to initialize agents, grammar, and state.
2. Calls `createWebSocketChannelServer(8999)` to accept connections.
3. For each connection:
   - Sets up an `AgentServerInvokeFunctions` handler with `join()` and `shutdown()`.
   - On `join()`: calls `sharedDispatcher.join()`, receives a per-connection `Dispatcher`, and wires up `Dispatcher` and `ClientIO` RPC servers for that connection.

### `sharedDispatcher.ts` — Routing layer

`createSharedDispatcher()` returns a `SharedDispatcher` that wraps a single underlying `Dispatcher` and manages multiple client connections.

**On `join(clientIO, closeFn, options)`:**
- Assigns a `connectionId` (auto-incrementing integer, as string).
- Stores the client's `ClientIO` in a `clients` map.
- Registers the client type in the protocol registry.
- Returns a per-connection `Dispatcher` whose commands are tagged with `connectionId`.

**Routing ClientIO:**
When the dispatcher or an agent calls a `ClientIO` method, the routing layer inspects `requestId.connectionId` to look up the correct entry in the `clients` map and forwards the call there. This isolates each client's display output even though they share one dispatcher.

| Method type | Routing |
|---|---|
| Display (`setDisplay`, `appendDisplay`, `notify`, `setUserRequest`) | Forwarded to the client matching `connectionId` |
| Interactive (`askYesNo`, `proposeAction`, `requestChoice`, `takeAction`) | Forwarded to the originating client; awaits response |
| Broadcast | Can optionally be sent to all clients (filter flag controls this) |

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
