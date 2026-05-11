# agent-server-client

Client library for connecting to a running agentServer, used by the Shell, the CLI, and IDE/editor extensions (e.g. `vscode-shell`).

## Connection model

The agent-server binds a **well-known TCP port** (default `8999`, override via the `AGENT_SERVER_PORT` environment variable). Clients connect to `ws://localhost:${AGENT_SERVER_PORT ?? 8999}` directly.

This mirrors how a future cloud-hosted agentServer would be addressed: a stable, configured URL is the contract. The local agentServer uses the same model so client code does not have to special-case "local" vs "remote".

The server takes an exclusive OS-level lock on its instance directory at startup (`lockInstanceDir`), so at most one agent-server is ever running per data-dir profile. Concurrent client spawns targeting the same port are coordinated by a per-port lockfile in the OS temp dir; only one client wins the spawn race, the others fall through to a TCP probe + connect.

Cross-machine connections work the same way — pass an explicit URL to `connectAgentServer(url)`.

The high-level helpers `ensureAgentServer()` and `lookupAgentServer()` encapsulate the probe-then-spawn flow — most callers should use them rather than the low-level building blocks.

## API

### `ensureAgentServer(options?)` — recommended

Returns a `{port, url}` handle. TCP-probes the configured URL; if a live server answers, returns it. Otherwise spawns a fresh agent-server bound to the configured port, waits for the port to start answering, and returns the new handle.

```typescript
const { port, url } = await ensureAgentServer({
    hidden: true, // spawn without showing a console window
    idleTimeout: 600, // 10 min idle shutdown
});
const connection = await connectAgentServer(url);
```

| Option        | Type      | Default | Description                                                                          |
| ------------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| `hidden`      | `boolean` | `false` | When spawning, suppress the terminal/window                                          |
| `idleTimeout` | `number`  | `0`     | Pass `--idle-timeout` to the spawned server; `0` disables (server runs indefinitely) |

### `lookupAgentServer()` — recommended

Read-only lookup: returns `{port, url}` if an agent-server is reachable at the configured URL, `undefined` otherwise. Never spawns. Use this from IDE/editor extensions (e.g. `vscode-shell`) that should not auto-start an agent-server.

```typescript
const handle = await lookupAgentServer();
if (handle === undefined) {
    throw new Error("No agent-server is running. Start one via the shell or `agent-server`.");
}
const connection = await connectAgentServer(handle.url);
```

### `getAgentServerPort()` / `getAgentServerUrl()`

Returns the configured port (`AGENT_SERVER_PORT` env var, or `DEFAULT_AGENT_SERVER_PORT = 8999`) / corresponding `ws://localhost:<port>` URL.

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

### `isServerRunning(url)` / `waitForServer(url, timeoutMs?)`

`isServerRunning` returns `true` if a server is already listening at the given WebSocket URL. `waitForServer` polls until it answers or the timeout elapses.

### `stopAgentServer()`

Connects to the server at the configured URL and sends `shutdown()`. If graceful shutdown fails (e.g. the server hung), kill it via your OS tools (`Stop-Process -Id <pid>` on Windows, `kill -9 <pid>` on POSIX).

## Smoke test

`pnpm -F @typeagent/agent-server-client run smoke` spawns a real agent-server in an isolated profile on a fresh free port (so it never collides with a developer's running agentServer on `8999`), opens a WebSocket connection, validates `lookupAgentServer` finds it, asserts that a second agentServer in the same data-dir refuses with `ERR_INSTANCE_LOCKED`, and sends `shutdown()`.


### `connectDispatcher(clientIO, url, options?, onDisconnect?)` _(deprecated)_

Backward-compatible wrapper: connects and immediately joins a conversation, returning a `Dispatcher`. Use `connectAgentServer()` for full multi-conversation support.

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
