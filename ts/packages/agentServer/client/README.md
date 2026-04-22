# agent-server-client

Client library for connecting to a running agentServer, used by the Shell and CLI.

## API

### `connectAgentServer(url, onDisconnect?)`

Opens a WebSocket to an already-running agentServer and returns an `AgentServerConnection` with full conversation management support.

```typescript
const connection = await connectAgentServer("ws://localhost:8999");

// Join a conversation
const { dispatcher, conversationId } = await connection.joinConversation(
  clientIO,
  {
    clientType: "shell",
  },
);

// Conversation management
await connection.createConversation("my conversation");
await connection.listConversations(); // all conversations
await connection.listConversations("workout"); // filter by name substring
await connection.renameConversation(conversationId, "new name");
await connection.deleteConversation(conversationId);

// Leave and close
await connection.leaveConversation(conversationId);
await connection.close();
```

**`AgentServerConnection`** methods:

| Method                                        | Description                                                   |
| --------------------------------------------- | ------------------------------------------------------------- |
| `joinConversation(clientIO, options?)`        | Join a conversation; returns `{ dispatcher, conversationId }` |
| `leaveConversation(conversationId)`           | Leave a conversation and clean up its channels                |
| `createConversation(name)`                    | Create a new named conversation                               |
| `listConversations(name?)`                    | List conversations, optionally filtered by name substring     |
| `renameConversation(conversationId, newName)` | Rename a conversation                                         |
| `deleteConversation(conversationId)`          | Delete a conversation and its persisted data                  |
| `close()`                                     | Close the WebSocket connection                                |

### `ensureAgentServer(port?, hidden?, idleTimeout?)`

Ensures the agentServer is running, spawning it if needed.

1. Calls `isServerRunning(url)` to check whether a server is already listening.
2. If not, calls `spawnAgentServer(hidden, idleTimeout)` to start it as a detached child process.
3. Polls until the server is ready (500 ms interval, 60 s timeout).

```typescript
// Start hidden with 10-minute idle shutdown — used by non-interactive CLI commands
await ensureAgentServer(8999, true, 600);

// Start in a visible window, no idle shutdown — used by interactive connect
await ensureAgentServer(8999, false);

const connection = await connectAgentServer("ws://localhost:8999");
```

| Parameter     | Type      | Default | Description                                                                          |
| ------------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| `port`        | `number`  | `8999`  | Port to check and spawn on                                                           |
| `hidden`      | `boolean` | `false` | When spawning, suppress the terminal/window (`true` = hidden)                        |
| `idleTimeout` | `number`  | `0`     | Pass `--idle-timeout` to the spawned server; `0` disables (server runs indefinitely) |

### `isServerRunning(url)`

Returns `true` if a server is already listening at the given WebSocket URL.

```typescript
if (await isServerRunning("ws://localhost:8999")) {
  console.log("Server is up");
}
```

### `stopAgentServer(port?)`

Connects to the running server on the given port and sends a `shutdown()` RPC.

### `ensureAndConnectConversation(clientIO, port?, options?, onDisconnect?, hidden?, idleTimeout?)`

Convenience wrapper: ensures the server is running, connects, and joins a conversation in one call. Returns a `ConversationDispatcher` directly.

```typescript
const conversation = await ensureAndConnectConversation(
  clientIO,
  8999,
  { conversationId },
  onDisconnect,
  true,
  600,
);
```

| Parameter      | Type                       | Default      | Description                                           |
| -------------- | -------------------------- | ------------ | ----------------------------------------------------- |
| `clientIO`     | `ClientIO`                 | _(required)_ | Client IO implementation                              |
| `port`         | `number`                   | `8999`       | Port to connect to                                    |
| `options`      | `DispatcherConnectOptions` | `undefined`  | Conversation join options (e.g. `conversationId`)     |
| `onDisconnect` | `() => void`               | `undefined`  | Called when the WebSocket disconnects                 |
| `hidden`       | `boolean`                  | `false`      | Suppress terminal/window when spawning                |
| `idleTimeout`  | `number`                   | `0`          | Pass `--idle-timeout` to spawned server; `0` disables |

### `ensureAndConnectDispatcher(clientIO, port?, options?, onDisconnect?)` _(deprecated)_

Convenience wrapper that auto-spawns the server if needed and joins a conversation, returning a `Dispatcher` directly. Prefer calling `ensureAgentServer()` + `connectAgentServer()` + `joinConversation()` separately for full control.

### `connectDispatcher(clientIO, url, options?, onDisconnect?)` _(deprecated)_

Backward-compatible wrapper: connects and immediately joins a conversation, returning a `Dispatcher`. Use `connectAgentServer()` for full multi-conversation support.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
