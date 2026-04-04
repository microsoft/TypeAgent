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

### `ensureAndConnectDispatcher(clientIO, port?, options?, onDisconnect?)`

Convenience wrapper that auto-spawns the server if needed and joins a session, returning a `Dispatcher` directly. Used by Shell and CLI.

1. Checks whether a server is already listening on `ws://localhost:<port>` (default 8999).
2. If not, calls `spawnAgentServer()` to start it as a detached child process.
3. Polls until the server is ready (500 ms interval, 60 s timeout).
4. Calls `connectDispatcher()` and returns the `Dispatcher` proxy.

```typescript
const dispatcher = await ensureAndConnectDispatcher(
  clientIO,
  8999,
  { clientType: "shell" },
  () => {
    console.error("Disconnected");
    process.exit(1);
  },
);

await dispatcher.processCommand("help");
```

### `stopAgentServer(port?)`

Connects to the running server on the given port and sends a `shutdown()` RPC.

### `connectDispatcher(clientIO, url, options?, onDisconnect?)` _(deprecated)_

Backward-compatible wrapper: connects and immediately joins a session, returning a `Dispatcher`. Use `connectAgentServer()` for full multi-session support.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
