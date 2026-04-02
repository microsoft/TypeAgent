# agent-server-protocol

Defines the WebSocket RPC contract between agentServer clients and the server.

## Channel names

```typescript
enum ChannelName {
  AgentServer = "AgentServer", // lifecycle: join / shutdown
  Dispatcher  = "Dispatcher",  // command dispatch
  ClientIO    = "ClientIO",    // display / interaction callbacks
}
```

Each WebSocket connection uses all three channels independently.

## RPC types

**`AgentServerInvokeFunctions`** — methods exposed on the `AgentServer` channel:

| Method | Description |
|---|---|
| `join(options?)` | Register this connection; returns `connectionId` string |
| `shutdown()` | Request graceful server shutdown |

**`DispatcherConnectOptions`** — options passed to `join()`:

| Field | Type | Description |
|---|---|---|
| `clientType` | `string` | Identifies the client (`"shell"`, `"extension"`, etc.) |
| `filter` | `boolean` | If true, only receive ClientIO messages for this connection's requests |

## Client-type registry

A module-level registry maps `connectionId → clientType`, populated when a client calls `join()`. Agents and the dispatcher can call `getClientType(connectionId)` to adapt behavior per client.

```typescript
registerClientType(connectionId: string, clientType: string): void
getClientType(connectionId: string): string | undefined
unregisterClient(connectionId: string): void
```

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
