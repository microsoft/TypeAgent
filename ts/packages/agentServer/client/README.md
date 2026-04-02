# agent-server-client

Client library for connecting to a running agentServer, used by the Shell and CLI.

## API

### `connectDispatcher(clientIO, url, options?, onDisconnect?)`

Opens a WebSocket to an already-running agentServer at `url`, sets up the three RPC channels, calls `join()`, and returns a `Dispatcher` RPC proxy.

### `ensureAndConnectDispatcher(clientIO, port?, options?, onDisconnect?)`

Higher-level convenience wrapper:
1. Checks whether a server is already listening on `ws://localhost:<port>` (default 8999).
2. If not, calls `spawnAgentServer()` to start it as a detached child process.
3. Polls until the server is ready (500 ms interval, 60 s timeout).
4. Calls `connectDispatcher()` and returns the `Dispatcher` proxy.

This is the function both the Shell and CLI call — they do not need to know whether the server was already running.

### `stopAgentServer(port?)`

Connects to the running server on the given port and sends a `shutdown()` RPC.

### `spawnAgentServer(serverPath)`

Spawns `packages/agentServer/server/dist/server.js` as a detached child process (so it survives parent exit). Cross-platform: uses `windowsHide` on Windows.

---

## Usage

```typescript
import { ensureAndConnectDispatcher } from "@typeagent/agent-server-client";

const dispatcher = await ensureAndConnectDispatcher(
  clientIO,   // your ClientIO implementation
  8999,       // port (optional, defaults to 8999)
  undefined,  // DispatcherConnectOptions (optional)
  () => { console.error("Disconnected"); process.exit(1); }
);

await dispatcher.processCommand("help");
```

---

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
