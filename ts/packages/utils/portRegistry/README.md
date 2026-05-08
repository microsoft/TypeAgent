# @typeagent/port-registry

Centralized port allocation and resource discovery for TypeAgent processes.

## Why

TypeAgent has many components that bind sockets:

- The agent server (`8999`)
- Visual Studio bridge (`5680`)
- Excel bridge (`5678`/`5679`)
- The Excel `BridgeRegistry` (`5677`)

Each of these uses a hardcoded port. That fails the moment a second
instance launches in a different VS Code window, with a different
solution, or against a different workbook. This package replaces all of
those hardcoded ports with a single registry that:

1. Allocates ephemeral ports on demand.
2. Maps logical resource names (workbook name, solution path, workspace
   key) to their owning process's ports.
3. Cleans up after dead owners (PID liveness check).
4. Survives any one process dying (multi-process leader election with
   self-promotion, inherited from the existing Excel `BridgeRegistry`
   pattern).

## API

```ts
import { globalRegistry, Namespaces } from "@typeagent/port-registry";

// Allocate two ports for an Excel bridge and reserve a workbook name
// in one call.
const { slotId, ports: [wsPort, evalPort] } = await globalRegistry.allocate(
    Namespaces.Excel,
    { count: 2, key: "MyWorkbook.xlsx" },
);

// Register additional resources later (e.g. a second loaded workbook
// in the same Excel process).
await globalRegistry.register(slotId, "OtherWorkbook.xlsx");

// Discover from another process (or the Office add-in via HTTP).
const { ports } = await globalRegistry.lookup(
    Namespaces.Excel,
    "MyWorkbook.xlsx",
);

// Cleanup
await globalRegistry.unregister(slotId, "MyWorkbook.xlsx");
await globalRegistry.release(slotId);
```

## Layered model

The registry separates two distinct concerns:

| Concern | API | Lifetime |
|---|---|---|
| Port allocation (process-scoped) | `allocate` / `release` | bridge process |
| Resource routing (optional) | `register` / `unregister` / `lookup` | per resource |

For consumers that only need a unique port and no name-based discovery
(e.g. the agent server itself), `allocate` alone is sufficient.

## Multi-process semantics

The first process to call `globalRegistry.ensure()` (implicitly invoked by
`allocate`/`lookup`/etc.) binds the well-known HTTP port and becomes the
**server**. Subsequent processes get `EADDRINUSE`, enter **client mode**,
and forward all calls to the server over HTTP. Each client also keeps a
shadow copy of the slots it owns so it can replay them after a
self-promotion.

If the server process dies, the next client whose HTTP call fails attempts
to bind the well-known port itself and replays its shadow. Whichever
client wins the race becomes the new server.

This pattern is inherited from the original Excel `BridgeRegistry`.

## Wire protocol

The server exposes a small HTTP API on the well-known port (default
`5681`, override via `TYPEAGENT_PORT_REGISTRY_PORT`):

| Method   | Path           | Body / Query                                    | Returns                        |
|----------|----------------|-------------------------------------------------|--------------------------------|
| `POST`   | `/allocate`    | `{ namespace, count?, key?, ownerPid }`         | `{ slotId, ports: number[] }`  |
| `POST`   | `/register`    | `{ slotId, resource }`                          | `{ ok: true }`                 |
| `DELETE` | `/unregister`  | `?slotId=&resource=`                            | `{ ok: true }`                 |
| `DELETE` | `/release`     | `?slotId=`                                      | `{ ok: true }`                 |
| `GET`    | `/lookup`      | `?ns=&key=` (key optional → singleton lookup)   | `{ slotId, ports }` or nulls   |
| `GET`    | `/status`      | -                                               | `{ entries: StatusEntry[] }`   |

## Liveness

Slots carry the `ownerPid` of the process that allocated them. On every
`lookup` and on a 30-second timer the server sweeps slots with dead
owners (`process.kill(pid, 0)` returns ENOENT) and removes them.

## Feature flag

The `TYPEAGENT_USE_PORT_REGISTRY` env var (`1` or `true` to enable) gates
whether downstream consumers route through the registry. Default off
during the introduction PR; flipped on in a follow-up after verification.

## Allocation race

`reservePorts` binds via `listen(0)` then closes to read the OS-assigned
port. There is a small window between close and the consumer's bind
during which another process could grab the port. In practice the OS
does not reuse ports rapidly. Consumers that get `EADDRINUSE` at bind
time should retry with a fresh allocation.

## Layout

| File           | Responsibility                                                 |
|----------------|----------------------------------------------------------------|
| `protocol.ts`  | Wire types, namespace constants, env var names                 |
| `allocator.ts` | Ephemeral port reservation via `net.createServer().listen(0)`  |
| `server.ts`    | `RegistryState` + `startRegistryServer` HTTP handler           |
| `client.ts`    | `PortRegistry` with server/client mode + self-promotion        |
| `index.ts`     | Barrel exports                                                 |
