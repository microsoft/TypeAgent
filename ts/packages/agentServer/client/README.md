# agent-server-client

Client library for connecting to a running agentServer, used by the Shell, vscode-shell, and CLI.

## Discovery model

The agent-server picks an **ephemeral TCP port** at startup (the OS assigns a free port) and publishes it to a discovery file at `~/.typeagent/agent-server.json`:

```json
{ "port": 64357, "pid": 22940, "startedAt": "2026-05-08T22:47:37.875Z" }
```

Clients on the same machine read this file to find the server — there is no well-known port. The server takes an exclusive OS-level lock on its instance directory at startup, so at most one agent-server is ever running per machine. Cross-machine discovery is out of scope: connect from another host with an explicit URL via `connectAgentServer(url)`.

The high-level helpers `ensureAgentServerViaDiscovery()` and `lookupAgentServerViaDiscovery()` encapsulate this flow — most callers should use them rather than the low-level building blocks.

## API

### `ensureAgentServerViaDiscovery(options?)` — recommended

Discovery-file-aware ensure: returns a `{port, url}` handle. Reads the discovery file; if a live server is published, returns its port. Otherwise spawns a fresh agent-server (which picks its own ephemeral port and writes the file), waits for the file to appear, and returns the new port.

```typescript
const { port, url } = await ensureAgentServerViaDiscovery({
    hidden: true, // spawn without showing a console window
    idleTimeout: 600, // 10 min idle shutdown
});
const connection = await connectAgentServer(url);
```

### `lookupAgentServerViaDiscovery()` — recommended

Read-only discovery: returns `{port, url}` if an agent-server is published in the discovery file and reachable, `undefined` otherwise. Never spawns. Use this from extensions / IDE integrations that should not auto-start an agent-server.

```typescript
const handle = await lookupAgentServerViaDiscovery();
if (handle === undefined) {
    throw new Error("No agent-server is running. Start one via the shell or `agent-server`.");
}
const connection = await connectAgentServer(handle.url);
```

### `connectAgentServer(url, onDisconnect?)`

Opens a WebSocket to an already-running agentServer and returns an `AgentServerConnection` with full conversation management support.

```typescript
const connection = await connectAgentServer(url);

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

Lower-level ensure: when `port` is omitted, behaves like `ensureAgentServerViaDiscovery` (and returns the discovered port). When `port` is provided, uses the legacy explicit-port path: probes that port, spawns an agent-server bound to it on miss, and returns the same port. Returns the resolved port number.

```typescript
// Discovery-file path (recommended)
const port = await ensureAgentServer();

// Explicit-port path (tests, remote-host)
await ensureAgentServer(9000, true, 600);
```

| Parameter     | Type                  | Default     | Description                                                                          |
| ------------- | --------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `port`        | `number \| undefined` | `undefined` | If set, pin to that port; otherwise use the discovery file                           |
| `hidden`      | `boolean`             | `false`     | When spawning, suppress the terminal/window                                          |
| `idleTimeout` | `number`              | `0`         | Pass `--idle-timeout` to the spawned server; `0` disables (server runs indefinitely) |

### `isServerRunning(url)`

Returns `true` if a server is already listening at the given WebSocket URL.

### `stopAgentServer(port?, force?)`

Connects to the running server (port from the discovery file when `port` is omitted) and sends `shutdown()`. With `force: true`, falls back to SIGKILL via the discovery file if graceful shutdown times out.

### Low-level discovery helpers

For tools that need to inspect the discovery file directly:

| Function                           | Description                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| `getDiscoveryFilePath()`           | Returns the absolute path to `~/.typeagent/agent-server.json`      |
| `readDiscoveryFile()`              | Returns `{port, pid, startedAt}` or `undefined` if missing/invalid |
| `writeDiscoveryFile(port, pid)`    | Writes a new record (used by the agent-server itself)              |
| `removeDiscoveryFile()`            | Deletes the file (used during graceful shutdown)                   |
| `isProcessAlive(pid)`              | Cross-platform process-existence check (handles Windows EPERM)     |
| `waitForDiscoveryFile(timeoutMs?)` | Polls until the file exists with a live pid and reachable port     |

## Smoke test

`pnpm -F @typeagent/agent-server-client run smoke` spawns a real agent-server in an isolated profile directory, validates the discovery file is written with a live pid, opens a WebSocket connection, sends `shutdown()`, and asserts that the discovery file is removed when the server exits.


### `connectDispatcher(clientIO, url, options?, onDisconnect?)` _(deprecated)_

Backward-compatible wrapper: connects and immediately joins a conversation, returning a `Dispatcher`. Use `connectAgentServer()` for full multi-conversation support.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
