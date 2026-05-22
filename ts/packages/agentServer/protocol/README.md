# agent-server-protocol

Defines the WebSocket RPC contract between agentServer clients and the server.

## Channel names

The fixed channel name for conversation lifecycle RPC is exported as `AgentServerChannelName`:

```typescript
export const AgentServerChannelName = "agent-server";
```

The fixed channel name for the read-only port discovery RPC is exported as `DiscoveryChannelName`:

```typescript
export const DiscoveryChannelName = "discovery";
```

Session-namespaced channels (one pair per joined conversation) are constructed via helper functions:

```typescript
getDispatcherChannelName(conversationId: string): string // "dispatcher:<conversationId>"
getClientIOChannelName(conversationId: string): string // "clientio:<conversationId>"
```

## Conversation types

**`ConversationInfo`** — describes a conversation:

| Field            | Type     | Description                                                           |
| ---------------- | -------- | --------------------------------------------------------------------- |
| `conversationId` | `string` | UUIDv4 stable identifier                                              |
| `name`           | `string` | Human-readable label (1–256 chars)                                    |
| `clientCount`    | `number` | Number of clients currently connected (runtime-only, never persisted) |
| `createdAt`      | `string` | ISO 8601 creation timestamp                                           |

**`JoinConversationResult`** — returned by `joinConversation`:

| Field            | Type     | Description                                      |
| ---------------- | -------- | ------------------------------------------------ |
| `connectionId`   | `string` | Unique identifier for this connection            |
| `conversationId` | `string` | The conversation that was joined or auto-created |

**`DispatcherConnectOptions`** — options passed to `joinConversation`:

| Field            | Type      | Description                                                                        |
| ---------------- | --------- | ---------------------------------------------------------------------------------- |
| `conversationId` | `string`  | Join a specific conversation by UUID. Omit to connect to the default conversation. |
| `clientType`     | `string`  | Identifies the client (`"shell"`, `"extension"`, etc.)                             |
| `filter`         | `boolean` | If true, only receive ClientIO messages for this connection's requests             |

## RPC methods

**`AgentServerInvokeFunctions`** — methods exposed on the `agent-server` channel:

| Method                                        | Description                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `joinConversation(options?)`                  | Join or auto-create a conversation; returns `JoinConversationResult`             |
| `leaveConversation(conversationId)`           | Leave a conversation and clean up its channels                                   |
| `createConversation(name)`                    | Create a new named conversation; returns `ConversationInfo`                      |
| `listConversations(name?)`                    | List all conversations, optionally filtered by name substring (case-insensitive) |
| `renameConversation(conversationId, newName)` | Rename a conversation                                                            |
| `deleteConversation(conversationId)`          | Delete a conversation and all its persisted data                                 |
| `shutdown()`                                  | Request graceful server shutdown                                                 |

## Client-type registry

A module-level registry maps `connectionId → clientType`, populated when a client calls `joinConversation()`. Agents and the dispatcher can call `getClientType(connectionId)` to adapt behavior per client.

```typescript
registerClientType(connectionId: string, clientType: string): void
getClientType(connectionId: string): string | undefined
unregisterClient(connectionId: string): void
```

## Discovery channel

External clients (Chrome extension, VS Code extension, CLI) look up the live port of any in-process app-agent through a read-only RPC channel hosted at the well-known `discovery` channel name. The dispatcher's `PortRegistrar` is the source of truth; the channel only exposes a single `lookupPort` method:

```typescript
export type DiscoveryInvokeFunctions = {
  lookupPort: (param: {
    agentName: string;
    role?: string;
  }) => Promise<{ port: number | null }>;
};
```

`null` means "no allocation found, try again later" — clients should poll/back off rather than treat it as fatal. The well-known `agentName === "agent-server"` resolves the host's own listening port for clients that bootstrap from a different known port.

To stay in lockstep across hosts, both the standalone `agentServer` process and the standalone Electron `shell` build their handler set from the shared factory:

```typescript
import { createDiscoveryHandlers } from "@typeagent/agent-server-protocol";

createDiscoveryHandlers((agentName, role) =>
  portRegistrar.lookup(agentName, role),
);
```

Passing a lookup callback (rather than the `IPortRegistrar` itself) keeps this package free of an `agent-dispatcher` dependency.

Live port allocations (including any client counts agents have published via `SessionContext.notifyClientCountChanged`) are surfaced in-process by the dispatcher's `@system ports` command.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
