# agent-server-protocol

Defines the WebSocket RPC contract between agentServer clients and the server.

## Channel names

The fixed channel name for session lifecycle RPC is exported as `AgentServerChannelName`:

```typescript
export const AgentServerChannelName = "agent-server";
```

Session-namespaced channels (one pair per joined session) are constructed via helper functions:

```typescript
getDispatcherChannelName(sessionId: string): string // "dispatcher:<sessionId>"
getClientIOChannelName(sessionId: string): string // "clientio:<sessionId>"
```

## Session types

**`SessionInfo`** — describes a session:

| Field         | Type     | Description                                                           |
| ------------- | -------- | --------------------------------------------------------------------- |
| `sessionId`   | `string` | UUIDv4 stable identifier                                              |
| `name`        | `string` | Human-readable label (1–256 chars)                                    |
| `clientCount` | `number` | Number of clients currently connected (runtime-only, never persisted) |
| `createdAt`   | `string` | ISO 8601 creation timestamp                                           |

**`JoinSessionResult`** — returned by `joinSession`:

| Field          | Type     | Description                                 |
| -------------- | -------- | ------------------------------------------- |
| `connectionId` | `string` | Unique identifier for this connection       |
| `sessionId`    | `string` | The session that was joined or auto-created |

**`DispatcherConnectOptions`** — options passed to `joinSession`:

| Field        | Type      | Description                                                                       |
| ------------ | --------- | --------------------------------------------------------------------------------- |
| `sessionId`  | `string`  | Join a specific session by UUID. Omit to resume the most recently active session. |
| `clientType` | `string`  | Identifies the client (`"shell"`, `"extension"`, etc.)                            |
| `filter`     | `boolean` | If true, only receive ClientIO messages for this connection's requests            |

## RPC methods

**`AgentServerInvokeFunctions`** — methods exposed on the `agent-server` channel:

| Method                              | Description                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `joinSession(options?)`             | Join or auto-create a session; returns `JoinSessionResult`                  |
| `leaveSession(sessionId)`           | Leave a session and clean up its channels                                   |
| `createSession(name)`               | Create a new named session; returns `SessionInfo`                           |
| `listSessions(name?)`               | List all sessions, optionally filtered by name substring (case-insensitive) |
| `renameSession(sessionId, newName)` | Rename a session                                                            |
| `deleteSession(sessionId)`          | Delete a session and all its persisted data                                 |
| `shutdown()`                        | Request graceful server shutdown                                            |

## Client-type registry

A module-level registry maps `connectionId → clientType`, populated when a client calls `joinSession()`. Agents and the dispatcher can call `getClientType(connectionId)` to adapt behavior per client.

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
