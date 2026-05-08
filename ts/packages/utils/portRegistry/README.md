# @typeagent/port-registry

Centralized port allocation and discovery for TypeAgent processes that
bind sockets — agent server, language-extension bridges, dev daemons.

The package replaces hardcoded port constants (`8999`, `5680`,
`5677`/`5678`/`5679`, …) with a single registry that allocates ephemeral
ports on demand and lets other processes look them up by name. The
acute need is for **bridge processes** (Excel, Visual Studio, and
soon Word) that are genuinely per-document or per-solution — running
two of them today fails because of port contention. The agent server
benefits secondarily, mostly through better discovery.

## The problem

The acute pain is in **bridges** — Excel, Visual Studio, and (soon)
Word — where the bridge process is genuinely per-document or
per-solution and a second instance is a normal user action. Today every
bridge picks a hardcoded port and the second one fails.

The agent server itself is per-user, not per-workspace, and there's
typically only one of those running. But its clients (CLI commands,
shells, the VS Code extension) still hardcode `ws://localhost:8999`,
which means they have no way to find the server if it's not on that
port and no coordination story when several of them race to spawn one.

```ts
const url = "ws://localhost:8999";          // CLI, vscode-shell, electron shell
const port = parseInt(arg ?? "8999", 10);   // electron shell --connect
```

So we want one mechanism that covers both shapes — **mandatory** for
bridges, where multi-instance is the whole point, and **useful** for
the agent server, where it replaces an ad-hoc spawn-lock file with
proper discovery.

The Excel agent already has the right shape — its `BridgeRegistry`
runs as a per-machine HTTP service that hands out workbook-keyed slots
to bridge processes that the Office add-in then discovers via
`/lookup`. This package generalizes that pattern so every TypeAgent
component can use it.

| Component               | Port               | Failure mode when contended         |
|-------------------------|--------------------|-------------------------------------|
| `agentServer`           | `8999`             | Spawn-lock file works most of the time, but clients still hardcode the URL |
| `visualStudio` agent    | `5680`             | Second VS instance: `EADDRINUSE`    |
| Excel `BridgeRegistry`  | `5677`             | Second Excel add-in can't start     |
| Excel bridge            | `5678` / `5679`    | Second workbook collides            |

## Architecture overview

```
              ┌──────────── well-known port 5681 ────────────┐
              │                                              │
   ┌─────────────────────┐          HTTP                ┌────────────────┐
   │  registry server    │ ◄──────────────────────────► │ registry client│
   │  (one process wins) │   /allocate /register        │ (every other   │
   │                     │   /unregister /release       │  process)      │
   │  - slot map         │   /lookup /status            │                │
   │  - PID liveness GC  │                              │ - shadow map   │
   │  - ephemeral alloc  │                              │ - self-promote │
   └─────────────────────┘                              └────────────────┘
              ▲                                                ▲
              │                                                │
              └────────── consumed by `globalRegistry` ────────┘
                          (process-local singleton)
```

Three layers, each with a clear responsibility:

1. **Allocator** (`allocator.ts`) — pure helper that returns OS-assigned
   ephemeral ports via `net.createServer().listen(0)`. Stateless. No
   knowledge of namespaces, slots, or the registry.
2. **Server** (`server.ts`) — owns the canonical slot map. Exposes a
   small HTTP API on the well-known port. Knows nothing about who its
   clients are.
3. **Client** (`client.ts`) — `PortRegistry` class that every consumer
   talks to. Tries to start the server itself; if the well-known port is
   already bound, it falls into client mode and forwards every call over
   HTTP. Also keeps a local **shadow map** so it can replay its slots
   after a self-promotion.

The whole thing has zero dependencies beyond `node:net`, `node:http`,
and `debug`. No daemon, no install step, no IPC framework.

## Two-layer API

The registry separates **port allocation** from **named resource
discovery**, because they have different lifetimes:

| Concern                | API                              | Lifetime                |
|------------------------|----------------------------------|-------------------------|
| Port allocation        | `allocate(ns, …)` / `release`    | the bridge process      |
| Resource routing       | `register` / `unregister` / `lookup` | the resource (workbook, solution, …) |

A bridge process allocates a slot once at startup and releases it at
shutdown. While alive, it can attach and detach **resources** to that
slot — for Excel, each workbook the user opens; for Visual Studio, each
loaded solution. External clients (the Office add-in JS, a CLI command)
look up resources by name and get back the bridge's port.

For consumers that only need "a unique port" with no resource layer
(e.g. the agent server today), `allocate` alone is sufficient — pass a
single static `key` (or `"default"`) and the slot doubles as both
allocation and lookup record.

## Multi-process election

When `PortRegistry.ensure()` is called for the first time in any
process, it tries to bind the well-known HTTP port (`5681` by default,
overridable via `TYPEAGENT_PORT_REGISTRY_PORT`):

- **First process wins.** It binds, becomes the server, and starts
  serving HTTP. Its mode is `"server"` — it dispatches calls to its own
  in-memory state directly without a network round-trip.
- **Every later process loses.** It gets `EADDRINUSE`, transitions to
  `"client"` mode, and forwards `allocate`/`register`/etc. as HTTP
  requests to whoever bound the port.

Each client also keeps a **shadow map** of slots it owns. If the
authoritative server dies, the next HTTP call from any client will fail.
That client then re-attempts to bind the well-known port; whichever
client wins the bind race becomes the new server, replays its own
shadow into the new state, and continues. Other clients re-discover the
new server on their next call (`ECONNREFUSED` → re-bind attempt → if
already bound by a peer, fall back to client mode).

This means:

- **No supervisor.** Every TypeAgent process can be started and stopped
  independently. The registry survives any one of them dying.
- **No startup ordering.** Whoever happens to come up first becomes the
  server.
- **No persistence.** State is in-memory; if every participating process
  exits, the slot map vanishes, and the next process to start gets a
  clean slate. That's correct because slots only describe currently
  running processes anyway.

The pattern is lifted directly from the existing Excel `BridgeRegistry`,
which has been running this way in production. This package generalizes
it to N namespaces and packages it for reuse.

## Liveness

Slots carry the `ownerPid` of the process that allocated them. The
server sweeps stale slots in two places:

1. **On every `lookup`** — checked inline so callers never see slots
   pointing at zombie processes.
2. **On a 30s timer** — background sweep keeps `/status` honest and
   reclaims slots whose owners died without releasing.

The liveness check is `process.kill(pid, 0)`. On Windows, an `EPERM`
result means *the process exists but we can't signal it* — that's still
"alive" for our purposes. Only `ESRCH` ("no such process") removes the
slot. The timer is `unref`'d so it doesn't keep an otherwise-idle Node
process alive.

## Wire protocol

| Method   | Path          | Body / Query                                  | Returns                        |
|----------|---------------|-----------------------------------------------|--------------------------------|
| `POST`   | `/allocate`   | `{ namespace, count?, key?, ownerPid }`       | `{ slotId, ports: number[] }`  |
| `POST`   | `/register`   | `{ slotId, resource }`                        | `{ ok: true }`                 |
| `DELETE` | `/unregister` | `?slotId=&resource=`                          | `{ ok: true }`                 |
| `DELETE` | `/release`    | `?slotId=`                                    | `{ ok: true }`                 |
| `GET`    | `/lookup`     | `?ns=&key=` (key optional → singleton lookup) | `{ slotId, ports }` or `null`s |
| `GET`    | `/status`     | —                                             | `{ entries: StatusEntry[] }`   |

JSON over HTTP, CORS enabled. Designed to be consumable from any
language — including the C# Visual Studio extension and the JS Office
add-in, which can't reasonably depend on the Node-side client library.

## Feature flag

`TYPEAGENT_USE_PORT_REGISTRY` (`1` / `true` to enable; default **off**)
gates whether downstream consumers route through the registry at all.
When off, every consumer falls back to its hardcoded behavior exactly as
before — no new failure modes, no new dependencies at runtime. When on,
the new code paths take effect.

The flag exists only to land the package and the per-consumer wiring
incrementally. It will flip to default-on once every consumer has been
migrated and validated, and removed once stable.

## Forward compatibility: `workspaceKey`

The agent-server-client API takes a `workspaceKey: string` parameter
even though only one agent server runs per user today. This is honest
forward-compat hedging, not a planned multi-server rollout: if a
future change ever needs to partition agent-server state by workspace
(e.g. different model configs per project), the API surface and the
registry's slot key already carry the dimension and won't have to
break.

That said, "I want different config per project" is more naturally
solved as a **workspace-scoped session** inside a single dispatcher,
not a second dispatcher process — the dispatcher already partitions
conversations and could carry a workspace dimension on settings. So
the realistic baseline remains one agent server per user.

Until any of that lands, every consumer passes `"default"` and the
system behaves single-instance.

## Allocation race

`reservePorts` binds via `listen(0)`, reads the OS-assigned port, and
closes the listener so the consumer can rebind. Between close and
rebind there's a tiny window during which the OS could hand the same
port to an unrelated process. In practice the OS does not reuse ports
that fast — but consumers that hit `EADDRINUSE` should retry with a
fresh allocation rather than treat it as fatal.

## Layout

| File           | Responsibility                                                 |
|----------------|----------------------------------------------------------------|
| `protocol.ts`  | Wire types, namespace constants, env var names                 |
| `allocator.ts` | Ephemeral port reservation via `net.createServer().listen(0)`  |
| `server.ts`    | `RegistryState` + `startRegistryServer` HTTP handler           |
| `client.ts`    | `PortRegistry` with server/client mode + self-promotion        |
| `index.ts`     | Barrel exports                                                 |
| `test/`        | 13 unit tests: allocator, server lifecycle, slot CRUD, GC, self-promotion |

## Quick reference

```ts
import { globalRegistry, Namespaces, isRegistryEnabled }
    from "@typeagent/port-registry";

if (isRegistryEnabled()) {
    // Bridge process: claim a slot at startup.
    const { slotId, ports } = await globalRegistry.allocate(
        Namespaces.Excel,
        { count: 2, key: "MyWorkbook.xlsx" },
    );
    const [wsPort, evalPort] = ports;

    // Attach more resources later (Excel: a second workbook).
    await globalRegistry.register(slotId, "OtherWorkbook.xlsx");

    // Discover from another process (or via HTTP from a non-Node client).
    const { ports: lookedUp } = await globalRegistry.lookup(
        Namespaces.Excel,
        "MyWorkbook.xlsx",
    );

    // Cleanup on shutdown.
    await globalRegistry.release(slotId);
}
```
