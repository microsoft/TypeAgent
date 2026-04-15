# agent-server-client

Client library for connecting to a running agentServer, used by the Shell and CLI.

## API

### `connectAgentServer(url, onDisconnect?)`

Opens a WebSocket to an already-running agentServer and returns an `AgentServerConnection` with full session management support.

```typescript
const connection = await connectAgentServer("ws://localhost:8999");

// Join a session
const { dispatcher, sessionId } = await connection.joinSession(clientIO, {
  clientType: "shell",
});

// Session management
await connection.createSession("my session");
await connection.listSessions(); // all sessions
await connection.listSessions("workout"); // filter by name substring
await connection.renameSession(sessionId, "new name");
await connection.deleteSession(sessionId);

// Leave and close
await connection.leaveSession(sessionId);
await connection.close();
```

**`AgentServerConnection`** methods:

| Method                              | Description                                          |
| ----------------------------------- | ---------------------------------------------------- |
| `joinSession(clientIO, options?)`   | Join a session; returns `{ dispatcher, sessionId }`  |
| `leaveSession(sessionId)`           | Leave a session and clean up its channels            |
| `createSession(name)`               | Create a new named session                           |
| `listSessions(name?)`               | List sessions, optionally filtered by name substring |
| `renameSession(sessionId, newName)` | Rename a session                                     |
| `deleteSession(sessionId)`          | Delete a session and its persisted data              |
| `close()`                           | Close the WebSocket connection                       |

### `ensureAgentServer(port?, hidden?)`

Ensures the agentServer is running, spawning it if needed.

1. Calls `isServerRunning(port)` to check whether a server is already listening.
2. If not, calls `spawnAgentServer(hidden)` to start it as a detached child process.
3. Polls until the server is ready (500 ms interval, 60 s timeout).

```typescript
// Start hidden (no window) — default for non-interactive CLI commands
await ensureAgentServer(8999, true);

// Start in a visible window — default for interactive connect
await ensureAgentServer(8999, false);

const connection = await connectAgentServer("ws://localhost:8999");
```

| Parameter | Type      | Default | Description                                                   |
| --------- | --------- | ------- | ------------------------------------------------------------- |
| `port`    | `number`  | `8999`  | Port to check and spawn on                                    |
| `hidden`  | `boolean` | `false` | When spawning, suppress the terminal/window (`true` = hidden) |

### `isServerRunning(port?)`

Returns `true` if a server is already listening on `ws://localhost:<port>`.

```typescript
if (await isServerRunning(8999)) {
  console.log("Server is up");
}
```

### `stopAgentServer(port?)`

Connects to the running server on the given port and sends a `shutdown()` RPC.

### `ensureAndConnectDispatcher(clientIO, port?, options?, onDisconnect?)` _(deprecated)_

Convenience wrapper that auto-spawns the server if needed and joins a session, returning a `Dispatcher` directly. Prefer calling `ensureAgentServer()` + `connectAgentServer()` + `joinSession()` separately for full control.

### `connectDispatcher(clientIO, url, options?, onDisconnect?)` _(deprecated)_

Backward-compatible wrapper: connects and immediately joins a session, returning a `Dispatcher`. Use `connectAgentServer()` for full multi-session support.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
