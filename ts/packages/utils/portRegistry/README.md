# @typeagent/port-registry

Centralized port allocation and discovery for TypeAgent processes that
bind sockets — agent server, language-extension bridges, dev daemons.

The package replaces hardcoded port constants with a single registry
that allocates ephemeral ports on demand and lets other processes look
them up by name. The acute need is for **extension bridges and other
local servers** — the kind of process that an editor extension, a
desktop application add-in, or an MCP-style helper spawns to talk to
TypeAgent — where the natural lifetime is per-document or per-project
and a second instance is a normal user action. The agent server
benefits secondarily, mostly through better discovery.

## The problem

The acute pain is in **extension bridges** — local helper processes
that an editor or desktop-application extension spawns to relay between
its host and TypeAgent. These are naturally per-document or
per-project: opening a second project is a normal user action, and a
second bridge picking the same hardcoded port just fails.

The agent server itself is per-user, not per-project, and there's
typically only one of those running. But its clients (CLI commands,
shells, the VS Code extension) still hardcode `ws://localhost:8999`,
which means they have no way to find the server if it's not on that
port and no coordination story when several of them race to spawn one.

```ts
const url = "ws://localhost:8999";          // CLI, vscode-shell, electron shell
const port = parseInt(arg ?? "8999", 10);   // electron shell --connect
```

So we want one mechanism that covers both shapes — **mandatory** for
extension bridges, where multi-instance is the whole point, and
**useful** for the agent server, where it replaces an ad-hoc spawn-lock
file with proper discovery. The same mechanism also gives us a clean
home for any future MCP-style local servers that need a discoverable
port.

The pattern is well-known: a small per-machine HTTP service that hands
out keyed slots to the local processes that bind sockets, and that
external clients (extension code running in a different runtime, a CLI
command in another shell) then discover via a `lookup` call. This
package generalizes that pattern so every TypeAgent component can use
it.

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
   talks to. Server-eligible handles try to start the server themselves
   and fall into client mode (with the right to self-promote later) if
   the well-known port is already bound; client-only handles never bind
   and never promote. Both keep a local **shadow map** so a server-
   eligible client can replay its slots after self-promotion.

The whole thing has zero dependencies beyond `node:net`, `node:http`,
and `debug`. No daemon, no install step, no IPC framework.

## Two-layer API

The registry separates **port allocation** from **named resource
discovery**, because they have different lifetimes:

| Concern                | API                              | Lifetime                |
|------------------------|----------------------------------|-------------------------|
| Port allocation        | `allocate(ns, …)` / `release`    | the bridge process      |
| Resource routing       | `register` / `unregister` / `lookup` | the resource (one per document, project, or whatever the host concept is) |

A bridge process allocates a slot once at startup and releases it at
shutdown. While alive, it can attach and detach **resources** to that
slot — typically one per host-side concept (a document, a project,
whatever the extension's natural unit is). External clients (extension
code in a different runtime, a CLI command) look up resources by name
and get back the bridge's port.

For consumers that only need "a unique port" with no resource layer
(e.g. the agent server today), `allocate` alone is sufficient — pass a
single static `key` (or `"default"`) and the slot doubles as both
allocation and lookup record.

## Multi-process election

When `PortRegistry.ensure()` is called for the first time in any
process, behavior depends on whether the process is **server-eligible**
(see [Who can host the registry?](#who-can-host-the-registry) below):

- **Server-eligible processes** try to bind the well-known HTTP port
  (`5681` by default, overridable via `TYPEAGENT_PORT_REGISTRY_PORT`).
  The first such process wins and becomes the registry server (mode
  `"server"`). Every later server-eligible process gets `EADDRINUSE`,
  transitions to `"client"` mode, but remains eligible to **self-promote**
  if the current server dies.
- **Client-only processes** never attempt to bind. They go straight to
  `"client"` mode and route every call as an HTTP request to whoever is
  hosting the registry. If the server dies, calls fail loudly — they do
  not self-promote.

Each server-eligible client also keeps a **shadow map** of slots it
owns. If the authoritative server dies, the next HTTP call from any
server-eligible client will fail. That client then re-attempts to bind
the well-known port; whichever wins the bind race becomes the new
server, replays its own shadow into the new state, and continues. Other
server-eligible clients re-discover the new server on their next call
(`ECONNREFUSED` → re-bind attempt → if already bound by a peer, fall
back to client mode).

### Who can host the registry?

The rule is simple: **a process is server-eligible iff it owns (or may
spawn) a local agent server.** Concretely:

| Process                                       | Server-eligible? | Why                                                 |
| --------------------------------------------- | ---------------- | --------------------------------------------------- |
| Agent server                                  | yes              | It is the canonical long-lived registry host        |
| Electron shell main (spawning a local server) | yes              | Owns the agent server it spawns                     |
| CLI commands that may spawn (`translate`, …)  | yes              | May bring up a local agent server on demand         |
| Extension hosts doing lookup-only             | no               | Pure consumer; never spawns                         |
| Pure remote clients                           | no               | Already have an explicit URL; no local server       |

The default is **client-only**. Server-eligibility is opt-in — either
via `new PortRegistry({ serverEligible: true })` or by calling
`globalRegistry.enableServerMode()` early in startup, before any
registry call. The `ensureAgentServerForWorkspace` helper enables
server mode automatically for its callers because that call site can
spawn.

This avoids the failure mode where a short-lived process (a CLI that
exits in a few hundred milliseconds) becomes the registry host and
then takes the registry down with it. Eligible processes are exactly
the ones that have a reason to outlive a registry hand-off — or whose
spawned agent server will.

This means:

- **No supervisor.** Every server-eligible process can be started and
  stopped independently. The registry survives any one of them dying.
- **No startup ordering.** Whichever eligible process happens to come
  up first becomes the server.
- **No persistence.** State is in-memory; if every participating
  process exits, the slot map vanishes, and the next process to start
  gets a clean slate. That's correct because slots only describe
  currently running processes anyway.

The pattern is lifted directly from an existing per-machine bridge
registry that has been running this way in production. This package
generalizes it to N namespaces and packages it for reuse.

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
language — including extension code that runs in a non-Node host
runtime and so can't pull in the client library directly.

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
| `test/`        | 16 unit tests: allocator, server lifecycle, slot CRUD, GC, self-promotion, client-only mode |

## Quick reference

```ts
import { globalRegistry, Namespaces, isRegistryEnabled }
    from "@typeagent/port-registry";

if (isRegistryEnabled()) {
    // Server-eligible processes opt in once at startup. The default is
    // client-only, which never binds the well-known port. Skip this
    // line in any process that should never host the registry (e.g.
    // an extension host that only does lookup against an existing
    // server).
    globalRegistry.enableServerMode();

    // Bridge process: claim a slot at startup.
    const { slotId, ports } = await globalRegistry.allocate(
        Namespaces.AgentServer, // or any namespace identifier
        { count: 2, key: "primary-resource-id" },
    );
    const [wsPort, evalPort] = ports;

    // Attach more resources later if the host can hold several at once.
    await globalRegistry.register(slotId, "secondary-resource-id");

    // Discover from another process (or via HTTP from a non-Node client).
    const { ports: lookedUp } = await globalRegistry.lookup(
        Namespaces.AgentServer,
        "primary-resource-id",
    );

    // Cleanup on shutdown.
    await globalRegistry.release(slotId);
}
```
