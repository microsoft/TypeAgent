# AgentServer Sessions Architecture

---

## Motivation

Today, the agent server has a single, implicit session shared by all connected clients. The Shell application compensates by saving chat history to an HTML file on disk, giving it de-facto session persistence. The CLI has no such mechanism and starts fresh every time it connects. Neither client exposes user-level session management — users cannot resume a previous conversation, name a context, or discard one they no longer need.

As we begin making a larger shift towards a client-server model with the agent server, it is becoming more apparent that the session lifecycle belongs in the server layer, not in individual clients. This document proposes a design for explicit, named sessions with full CRUD semantics exposed via the existing RPC protocol.

---

## Goals

- **Create** a new named session on demand.
- **Resume** a previous session (chat history, conversation memory, display log) by ID.
- **List** available sessions, optionally filtered by a name substring match.
- **Rename** a session.
- **Delete** a session and its persisted data.
- Sessions are identified by a **GUID** and carry a human-readable **name** and **client count** so clients can make informed join decisions.
- Clients specify an **optional session ID** at `joinSession()` time; omitting it resumes the most recently active session, or auto-creates a default session if none exist.
- Session isolation is **client-enforced** for now — the server provides the signals, clients decide the policy.

## Non-Goals

- **Authentication or access control on the WebSocket endpoint.** Any process that can reach the agentServer's WebSocket port can call any RPC method, including `deleteSession`. Securing the endpoint itself is out of scope for v1.
- **Per-session access control.** The server does not restrict which clients can join or delete which sessions. Clients are trusted. See Open Questions for a future path.
- **Multi-user or multi-machine session sharing.** Sessions are local to a single agentServer instance.

---

## Current State

### What Exists Today

The dispatcher already has the scaffolding for session persistence:

- `Session.restoreLastSession()` — loads the most recently used session on startup.
- `persistSession: true` + `persistDir` — persists chat history, conversation memory, display log, and session config to `~/.typeagent/`.
- `sessions.json` + `sessions/<sessionDir>/data.json` — per-session on-disk records.

However, this is **transparent to clients**: there is no protocol-level API to list, choose, or delete sessions. The server always resumes whatever was last active.

### One Shared Context for All Clients

A critical detail: `createSharedDispatcher()` calls `initializeCommandHandlerContext()` **once** at startup, producing a single `context`. Every subsequent `join()` call creates a `Dispatcher` via `createDispatcherFromContext(context, connectionId, ...)` — all clients share the same underlying session context. Chat history, conversation memory, and session config are fully shared state. The `connectionId` only isolates `ClientIO` routing (display output reaches the right client), not the conversation itself.

This means a second client connecting mid-conversation sees — and appends to — the same chat history the first client was using. There is effectively no per-client session isolation today.

### Key Gap

The `join()` call today accepts only:

```typescript
type DispatcherConnectOptions = {
  filter?: boolean;
  clientType?: "shell" | "extension";
};
```

There is no way for a client to specify which session to use, or to perform session management at all.

---

## Proposed Design

### 1. Session Identity

Each session is identified by:

| Field         | Type                | Description                                                                                                                                               |
| ------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`   | `string` (UUIDv4)   | Stable, globally unique identifier                                                                                                                        |
| `name`        | `string`            | Human-readable label (1–256 chars), set by the caller at `createSession()` time. Not enforced unique.                                                     |
| `createdAt`   | `string` (ISO 8601) | When the session was first created                                                                                                                        |
| `clientCount` | `number`            | Number of clients currently connected to this session (runtime-derived; `0` if the session is not loaded in memory). **Never persisted** — see Section 2. |

### 2. Session Metadata

A `sessions.json` file lives at `persistDir/server-sessions/sessions.json` and is the authoritative registry:

```json
{
  "sessions": [
    {
      "sessionId": "a1b2c3d4-...",
      "name": "workout playlist setup",
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ],
  "lastActiveSessionId": "a1b2c3d4-..."
}
```

Each session's full data (chat history, conversation memory, display log) is stored in `persistDir/server-sessions/<sessionId>/` — the same layout that exists today, but keyed on UUID.

> **Note:** `clientCount` is a runtime-only field — it is **never written to `sessions.json`**. It is populated at query time by inspecting the live dispatcher pool.

> **Note:** Legacy session data (from standalone Shell runs) is left in place and coexists on disk with the agentServer's session registry. The agentServer does not read, migrate, or touch legacy session directories. The standalone Shell continues to use its own session management independently for now.

### 3. Protocol Changes

#### Extended `DispatcherConnectOptions`

```typescript
type DispatcherConnectOptions = {
  filter?: boolean;
  clientType?: "shell" | "extension";

  // Session management (new)
  sessionId?: string; // Join a specific session by UUID. If omitted → resumes most recently active session.
};
```

#### New `AgentServerInvokeFunctions`

The existing `join` RPC is replaced by `joinSession`. A `leaveSession` call is added for explicit session departure. Full session CRUD is exposed:

```typescript
type AgentServerInvokeFunctions = {
  // Replaces the old `join`
  joinSession: (
    options?: DispatcherConnectOptions,
  ) => Promise<JoinSessionResult>;
  leaveSession: (sessionId: string) => Promise<void>;

  // Session CRUD
  createSession: (name: string) => Promise<SessionInfo>;
  listSessions: (name?: string) => Promise<SessionInfo[]>;
  renameSession: (sessionId: string, newName: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
};
```

#### `JoinSessionResult`

```typescript
type JoinSessionResult = {
  connectionId: string;
  sessionId: string; // The session that was joined or auto-created
};
```

> **Migration note:** The old `join()` returned `Promise<string>` (the `connectionId`). The fork avoids this breaking change by renaming the method to `joinSession()` and keeping `connectDispatcher()` as a `@deprecated` backward-compatible wrapper in `agentServerClient.ts`.

#### `SessionInfo`

```typescript
type SessionInfo = {
  sessionId: string;
  name: string;
  clientCount: number;
  createdAt: string;
};
```

### 4. Server-Side: `SessionManager` and `SharedDispatcher`

Today, `createSharedDispatcher()` creates one global dispatcher with one session. Under the new design, a `SessionManager` maintains a **pool of per-session `SharedDispatcher` instances** — one per active session, shared by all clients connected to that session.

```
AgentServer
  └── SessionManager
        ├── SessionRecord[session-A]
        │     └── SharedDispatcher ← clients 0, 1 (both connected to session A)
        └── SessionRecord[session-B]
              └── SharedDispatcher ← client 2 (connected to session B)
```

Each session's `SharedDispatcher` is created lazily on first `joinSession()` and calls `initializeCommandHandlerContext()` with a `persistDir` scoped to `server-sessions/<sessionId>/`, giving it fully isolated chat history, conversation memory, display log, and session config. Clients connecting to the same session share one dispatcher instance and its routing `ClientIO` table, consistent with how the current single dispatcher works today.

`SharedDispatcher.join()` calls `createDispatcherFromContext(context, connectionId, ...)` per client — producing a lightweight `Dispatcher` handle bound to a unique `connectionId` but sharing the same underlying context. Output routing is per-client via `connectionId`; conversation state is shared across all clients in the session.

Idle session dispatchers are automatically evicted from memory after 5 minutes with no connected clients, freeing resources without requiring explicit lifecycle management.

#### Channel Namespacing

Each session uses namespaced WebSocket channels to allow multiple sessions over a single WebSocket connection:

- `dispatcher:<sessionId>` — the dispatcher RPC channel for that session
- `clientio:<sessionId>` — the ClientIO RPC channel for that session

### 5. Session Lifecycle on `joinSession()`

```
Client calls joinSession({ sessionId?, clientType, filter })
  │
  ├─ sessionId provided?
  │   ├─ Yes → look up sessions.json
  │   │   ├─ Found → load SharedDispatcher for this session (lazy init if not in memory pool)
  │   │   └─ Not found → return error: "Session not found"
  │   └─ No → resolve most recently active session
  │       ├─ lastActiveSessionId set and valid → use it
  │       └─ No sessions exist → auto-create session named "default"
  │
  ├─ Register client in session's SharedDispatcher routing table
  ├─ Update lastActiveSessionId in sessions.json
  └─ Return JoinSessionResult { connectionId, sessionId }
```

### 6. `listSessions(name?)`

Returns the sessions from `sessions.json`. If `name` is provided, only sessions whose `name` contains the substring (case-insensitive) are returned. If `name` is omitted, all sessions are returned. `clientCount` is populated from the live dispatcher pool for sessions currently loaded in memory.

```typescript
// Response shape
SessionInfo[]
// Example:
[
  {
    sessionId: "a1b2c3d4-e5f6-...",
    name: "workout playlist setup",
    createdAt: "2026-04-01T10:00:00Z",
    clientCount: 1
  },
  {
    sessionId: "f7e8d9c0-...",
    name: "flight research",
    createdAt: "2026-03-28T09:15:00Z",
    clientCount: 0
  }
]
```

### 7. `deleteSession(sessionId)`

1. Close all active client dispatcher handles for the session.
2. Shut down and evict the session's `SharedDispatcher` from the in-memory pool.
3. Remove `persistDir/server-sessions/<sessionId>/` from disk (recursive delete, best-effort).
4. Remove the entry from `sessions.json` and update `lastActiveSessionId` if needed.

> **Note:** Any connected client can call `deleteSession` on any session, including sessions they are not currently connected to. The calling client's session-namespaced channels are cleaned up immediately; other clients connected to the deleted session have their dispatcher handles closed when `SharedDispatcher.close()` is called. Server-side authorization is out of scope for v1 (see Open Questions).

---

## Client Integration

### CLI

The CLI implements the full session management surface described in this document.

#### `connect` — join a session

```bash
agent-cli connect                        # resume most recently active session
agent-cli connect --session <id>         # resume a specific session by ID
```

`connect.ts` passes `{ sessionId: flags.session }` to `ensureAndConnectSession()` when `--session` is provided; omitting the flag calls `joinSession()` without a session ID, letting the server resolve the most recently active session (or auto-create `"default"`).

#### `sessions` topic — session CRUD

| Command                                    | RPC call                     |
| ------------------------------------------ | ---------------------------- |
| `agent-cli sessions create <name>`         | `createSession(name)`        |
| `agent-cli sessions list [--name <sub>]`   | `listSessions(name?)`        |
| `agent-cli sessions rename <id> <newName>` | `renameSession(id, newName)` |
| `agent-cli sessions delete <id> [--yes]`   | `deleteSession(id)`          |

`sessions create`, `list`, `rename`, and `delete` use `connectAgentServer()` directly (no `joinSession()`) — they are management operations that do not require joining a session.

`sessions delete` prompts `Delete session <id> and all its data? (y/N)` before calling `deleteSession()`. Pass `--yes` / `-y` to skip the prompt.

`sessions list` renders a fixed-width table with columns `SESSION ID`, `NAME`, `CLIENTS`, and `CREATED AT`. Pass `--name <substring>` to filter by name (case-insensitive).

### Shell

Session management only applies when the Shell is running in **connected mode** (`--connect <port>`). In standalone mode the Shell runs an in-process dispatcher and manages its own session state independently.

When connected to the agentServer:

- On startup, Shell calls `listSessions()` and presents a session picker (or auto-resumes the most recently active session).
- A session management panel allows listing, switching, renaming, and deleting sessions.
- When resuming a session, the Shell loads chat history from the server via `getDisplayHistory()` (which already exists on the `Dispatcher` interface and works per-session since each session has its own `DisplayLog` instance) rather than its local HTML file. How this history is rendered in the Shell UI is an open question — see Open Questions item 2.

---

## Out of Scope (Future Iterations)

- **Session sharing across machines** — sessions are local to one agentServer instance for now.
- **Session export/import** — useful for backup/restore, but not required for v1.
- **Per-session agent configuration** — sessions inherit the global agent enable/disable config for now.
- **Pagination for `listSessions()`** — the full index is loaded on every call; pagination (`limit`/`offset`) can be added once session counts grow large enough to matter.
- **Graceful drain on `deleteSession()`** — currently `deleteSession()` closes all client dispatcher handles immediately with no drain window. A future iteration should notify connected clients and await in-flight `processCommand()` calls (with a timeout) before tearing down the session.
- **Per-session concurrency lock** — concurrent `joinSession()` calls targeting the same session ID before lazy initialization completes could race. A per-session async mutex should be added in a follow-up.
- **LLM-generated session summaries** — auto-generating a one-line summary after the first exchange is a useful future addition for session discoverability, but is deferred in favor of explicit `name` for now.

---

## Open Questions

1. **Session size limits:** Should there be a maximum number of sessions? A maximum disk size per session? These constraints are useful for operational hygiene but depend on expected usage patterns.

2. **Shell history rendering on session resume:** When the Shell resumes a session in connected mode, it calls `getDisplayHistory()` to load prior history. The open question is how this is rendered: does the Shell rebuild the chat view in place from the returned entries, swap its local HTML file, or render history on demand? This is a Shell-specific UX and architecture decision to be resolved when this work is tackled.

3. **Client-Enforced Session Isolation:** Session isolation is currently **client-enforced**. The server provides `clientCount` as a signal, but nothing prevents a poorly behaved client from joining a session it shouldn't. Whether to add server-side enforcement (e.g., max connections per session, explicit session locking) is an open question for a future iteration.

---

## Summary

This design adds explicit session management to the agentServer without fundamentally restructuring its architecture. The core additions are:

- A `sessions.json` registry for discoverable, GUID-keyed named sessions.
- A `SessionManager` that maintains a pool of per-session `SharedDispatcher` instances, each with its own isolated `initializeCommandHandlerContext()` call, chat history, conversation memory, and persist directory.
- Five new RPC methods on the `AgentServer` channel: `joinSession`, `leaveSession`, `createSession`, `listSessions`, `renameSession`, `deleteSession`.
- `sessionId` in `DispatcherConnectOptions` so clients can resume a specific session by ID.
- `listSessions(name?)` with optional substring filtering as the primary session discovery mechanism.
- Session-namespaced WebSocket channels (`dispatcher:<id>`, `clientio:<id>`) enabling multiple concurrent sessions over a single connection.
- Idle dispatcher eviction after 5 minutes to free memory for inactive sessions.

The server enforces no policy on who can join or delete a session — `clientCount` gives clients the signal to make that decision themselves.

Session state is local to the server — the underlying LLM API is stateless, and the server owns all history management. This lifts that responsibility from individual clients (Shell, CLI) into the shared server layer, where it belongs.
