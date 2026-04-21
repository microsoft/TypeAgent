# AgentServer Conversations Architecture

---

## Motivation

Today, the agent server has a single, implicit conversation shared by all connected clients. The Shell application compensates by saving chat history to an HTML file on disk, giving it de-facto conversation persistence. The CLI has no such mechanism and starts fresh every time it connects. Neither client exposes user-level conversation management — users cannot resume a previous conversation, name a context, or discard one they no longer need.

As we begin making a larger shift towards a client-server model with the agent server, it is becoming more apparent that the conversation lifecycle belongs in the server layer, not in individual clients. This document proposes a design for explicit, named conversations with full CRUD semantics exposed via the existing RPC protocol.

---

## Goals

- **Create** a new named conversation on demand.
- **Resume** a previous conversation (chat history, conversation memory, display log) by ID.
- **List** available conversations, optionally filtered by a name substring match.
- **Rename** a conversation.
- **Delete** a conversation and its persisted data.
- Conversations are identified by a **GUID** and carry a human-readable **name** and **client count** so clients can make informed join decisions.
- Clients specify an **optional session ID** at `joinSession()` time; omitting it connects to the default conversation, or auto-creates one if none exist. The server always resolves to `"default"` rather than the most recently active conversation because in a multi-client environment, "most recently active" is a server-wide concept — a CLI user spinning up independently should not be silently dropped into an active Shell conversation. Clients that want last-used behavior should remember their last session ID locally and pass it explicitly.
- Conversation isolation is **client-enforced** for now — the server provides the signals, clients decide the policy.

## Non-Goals

- **Authentication or access control on the WebSocket endpoint.** Any process that can reach the agentServer's WebSocket port can call any RPC method, including `deleteSession`. Securing the endpoint itself is out of scope for v1.
- **Per-conversation access control.** The server does not restrict which clients can join or delete which conversations. Clients are trusted. See Open Questions for a future path.
- **Multi-user or multi-machine conversation sharing.** Conversations are local to a single agentServer instance.

---

## Current State

### What Exists Today

The dispatcher already has the scaffolding for session persistence:

- `Session.restoreLastSession()` — loads the most recently used session on startup.
- `persistSession: true` + `persistDir` — persists chat history, conversation memory, display log, and session config to `~/.typeagent/`.
- `sessions.json` + `sessions/<sessionDir>/data.json` — per-session on-disk records.

However, this is **transparent to clients**: there is no protocol-level API to list, choose, or delete conversations. The server always resumes whatever was last active.

### Instance Storage vs. Session Storage

The dispatcher exposes two storage scopes to agents via `SessionContext`:

- **`instanceStorage`** — scoped to `instanceDir` when present, falling back to `persistDir` when `instanceDir` is absent (standalone Shell, CLI, tests). Intended for configuration and data that should **survive across conversations** (e.g. agent auth tokens, user preferences, learned config). Agents write here and expect to read it back regardless of which conversation the user is in.
- **`sessionStorage`** — scoped to `persistDir/sessions/<sessionId>/`. Intended for ephemeral, session-local data (e.g. caches, in-progress state) that is discarded when the user creates a new session.

In `sessionContext.ts`, the mapping is explicit:

```typescript
const storage = storageProvider.getStorage(name, sessionDirPath); // sessionStorage
const instanceStorage =
  (context.instanceDir ?? context.persistDir)
    ? storageProvider!.getStorage(
        name,
        context.instanceDir ?? context.persistDir!,
      )
    : undefined; // instanceStorage
```

This contract — `instanceStorage` survives, `sessionStorage` is ephemeral — holds today in both the standalone Shell and the CLI.

### The Problem with Scoping `persistDir` per Conversation

Naively scoping each conversation's `persistDir` to `server-sessions/<server-session-id>/` breaks this contract:

```
server-sessions/<server-session-id>/                        ← persistDir → instanceStorage root
server-sessions/<server-session-id>/sessions/<session-id>/  ← sessionStorage
```

**Every time a new conversation is created, both `instanceStorage` and `sessionStorage` start fresh.** Agent configuration data (auth tokens, user preferences, learned state) is silently discarded whenever the user connects to a new conversation. The fix is a split storage root described in Section 4.

### One Shared Context for All Clients

A critical detail: `createSharedDispatcher()` calls `initializeCommandHandlerContext()` **once** at startup, producing a single `context`. Every subsequent `join()` call creates a `Dispatcher` via `createDispatcherFromContext(context, connectionId, ...)` — all clients share the same underlying session context. Chat history, conversation memory, and session config are fully shared state. The `connectionId` only isolates `ClientIO` routing (display output reaches the right client), not the conversation itself.

This means a second client connecting mid-conversation sees — and appends to — the same chat history the first client was using. There is effectively no per-client conversation isolation today.

### Key Gap

The `join()` call today accepts only:

```typescript
type DispatcherConnectOptions = {
  filter?: boolean;
  clientType?: "shell" | "extension";
};
```

There is no way for a client to specify which conversation to use, or to perform conversation management at all.

---

## Proposed Design

### 1. Conversation Identity

Each conversation is identified by:

| Field         | Type                | Description                                                                                                                                                         |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId`   | `string` (UUIDv4)   | Stable, globally unique identifier                                                                                                                                  |
| `name`        | `string`            | Human-readable label (1–256 chars), set by the caller at `createSession()` time. Not enforced unique.                                                               |
| `createdAt`   | `string` (ISO 8601) | When the conversation was first created                                                                                                                             |
| `clientCount` | `number`            | Number of clients currently connected to this conversation (runtime-derived; `0` if the conversation is not loaded in memory). **Never persisted** — see Section 2. |

### 2. Conversation Metadata

A `sessions.json` file lives at `instanceDir/server-sessions/sessions.json` and is the authoritative registry:

```json
{
  "sessions": [
    {
      "sessionId": "a1b2c3d4-...",
      "name": "workout playlist setup",
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

Each conversation's ephemeral data (chat history, conversation memory, display log, session config) is stored in `instanceDir/server-sessions/<sessionId>/`. Agent `instanceStorage` (config, auth tokens, learned state) is stored directly under `instanceDir/<agentName>/`, **shared across all conversations**.

> **Note:** `clientCount` is a runtime-only field — it is **never written to `sessions.json`**. It is populated at query time by inspecting the live dispatcher pool.

> **Note:** Legacy session data (from standalone Shell runs) is left in place and coexists on disk with the agentServer's conversation registry. The agentServer does not read, migrate, or touch legacy session directories. The standalone Shell continues to use its own session management independently for now.

### 3. Protocol Changes

#### Extended `DispatcherConnectOptions`

```typescript
type DispatcherConnectOptions = {
  filter?: boolean;
  clientType?: "shell" | "extension";

  // Session management (new)
  sessionId?: string; // Join a specific conversation by UUID. If omitted → connects to the default conversation.
};
```

#### New `AgentServerInvokeFunctions`

The existing `join` RPC is replaced by `joinSession`. A `leaveSession` call is added for explicit conversation departure. Full conversation CRUD is exposed:

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
  sessionId: string; // The conversation that was joined or auto-created
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

Today, `createSharedDispatcher()` creates one global dispatcher with one session. Under the new design, a `SessionManager` maintains a **pool of per-conversation `SharedDispatcher` instances** — one per active conversation, shared by all clients connected to that conversation.

```
AgentServer
  └── SessionManager
        ├── SessionRecord[conversation-A]
        │     └── SharedDispatcher ← clients 0, 1 (both connected to conversation A)
        └── SessionRecord[conversation-B]
              └── SharedDispatcher ← client 2 (connected to conversation B)
```

#### Storage Split: `instanceDir` vs. `persistDir`

To preserve the `instanceStorage` / `sessionStorage` contract across conversations, the dispatcher must be initialized with **two distinct root directories** rather than one:

| Directory     | Purpose                                                                                                                                 | Lifetime                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `instanceDir` | Global instance root — maps to `instanceStorage` for all agents. Contains agent config, auth tokens, user preferences, embedding cache. | Lives for the lifetime of the agentServer process (or the user profile). Never scoped per conversation. |
| `persistDir`  | Per-conversation root — maps to `sessionStorage` and holds chat history, conversation memory, display log, and session config.          | Scoped to `instanceDir/server-sessions/<sessionId>/`. Discarded with the conversation.                  |

**Concrete paths:**

```
~/.typeagent/profiles/dev/                                              ← instanceDir (global)
~/.typeagent/profiles/dev/server-sessions/<sessionId>/                  ← persistDir (per conversation)
~/.typeagent/profiles/dev/server-sessions/<sessionId>/sessions/<id>/    ← sessionStorage
~/.typeagent/profiles/dev/<agentName>/                                  ← instanceStorage (global)
```

#### `DispatcherOptions` changes

`initializeCommandHandlerContext()` today accepts a single `persistDir`. To support the split, a new optional `instanceDir` field is added:

```typescript
type DispatcherOptions = {
  // ...existing fields...
  persistDir?: string; // per-conversation directory (chat history, memory, config)
  instanceDir?: string; // global instance directory for cross-conversation agent storage
  // ...
};
```

When `instanceDir` is provided, `instanceStorage` is rooted there instead of at `persistDir`. When `instanceDir` is omitted (standalone Shell, CLI, tests), behavior is unchanged — `instanceStorage` falls back to `persistDir`, preserving full backward compatibility.

#### `SessionContext` wiring

In `sessionContext.ts`, the `instanceStorage` base changes from `context.persistDir` to the new `context.instanceDir` (falling back to `context.persistDir` when `instanceDir` is absent):

```typescript
const instanceStorage =
  (context.instanceDir ?? context.persistDir)
    ? storageProvider!.getStorage(
        name,
        context.instanceDir ?? context.persistDir!,
      )
    : undefined;
```

This is the only change needed in the storage wiring — no changes to the `Storage` interface or agent code.

#### Server initialization

When the agentServer starts up, it resolves both directories once and passes them to every per-conversation dispatcher:

```typescript
const instanceDir = getProfilePath("dev"); // e.g. ~/.typeagent/profiles/dev
const persistDir = path.join(instanceDir, "server-sessions", sessionId); // per-session subdirectory

initializeCommandHandlerContext("agentServer", {
  instanceDir, // global — never changes between conversations
  persistDir, // scoped to this conversation
  persistSession: true,
  // ...
});
```

#### `CommandHandlerContext` changes

A new `instanceDir` field is added alongside the existing `persistDir`:

```typescript
export type CommandHandlerContext = {
  // ...existing fields...
  readonly persistDir: string | undefined; // per-conversation root (chat, memory, config)
  readonly instanceDir: string | undefined; // global instance root (agent config, auth tokens)
  // ...
};
```

Each conversation's `SharedDispatcher` is created lazily on first `joinSession()` and calls `initializeCommandHandlerContext()` with a `persistDir` scoped to `server-sessions/<sessionId>/` and a shared `instanceDir`, giving it fully isolated chat history and session config while preserving agent configuration across conversation boundaries. Clients connecting to the same conversation share one dispatcher instance and its routing `ClientIO` table, consistent with how the current single dispatcher works today.

`SharedDispatcher.join()` calls `createDispatcherFromContext(context, connectionId, ...)` per client — producing a lightweight `Dispatcher` handle bound to a unique `connectionId` but sharing the same underlying context. Output routing is per-client via `connectionId`; conversation state is shared across all clients in the conversation.

Idle conversation dispatchers are automatically evicted from memory after 5 minutes with no connected clients, freeing resources without requiring explicit lifecycle management.

#### Channel Namespacing

Each conversation uses namespaced WebSocket channels to allow multiple conversations over a single WebSocket connection:

- `dispatcher:<sessionId>` — the dispatcher RPC channel for that conversation
- `clientio:<sessionId>` — the ClientIO RPC channel for that conversation

### 5. Conversation Lifecycle on `joinSession()`

```
Client calls joinSession({ sessionId?, clientType, filter })
  │
  ├─ sessionId provided?
  │   ├─ Yes → look up instanceDir/server-sessions/sessions.json
  │   │   ├─ Found → load SharedDispatcher for this conversation (lazy init if not in memory pool)
  │   │   └─ Not found → return error: "Conversation not found"
  │   └─ No → connect to the default conversation
  │       ├─ Conversation named "default" exists → use it
  │       └─ No conversations exist → auto-create conversation named "default"
  │           ├─ Create instanceDir/server-sessions/<sessionId>/     ← persistDir
  │           └─ Init dispatcher with instanceDir (global) + persistDir (conversation-scoped)
  │
  ├─ Register client in conversation's SharedDispatcher routing table
  └─ Return JoinSessionResult { connectionId, sessionId }
```

### 6. `listSessions(name?)`

Returns the conversations from `sessions.json`. If `name` is provided, only conversations whose `name` contains the substring (case-insensitive) are returned. If `name` is omitted, all conversations are returned. `clientCount` is populated from the live dispatcher pool for conversations currently loaded in memory.

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

1. Close all active client dispatcher handles for the conversation.
2. Shut down and evict the conversation's `SharedDispatcher` from the in-memory pool.
3. Remove `instanceDir/server-sessions/<sessionId>/` from disk (recursive delete of the `persistDir` subtree only, best-effort). **Agent `instanceStorage` under `instanceDir/<agentName>/` is not touched.**
4. Remove the entry from `sessions.json`.

> **Note:** Any connected client can call `deleteSession` on any conversation, including conversations they are not currently connected to. The calling client's session-namespaced channels are cleaned up immediately; other clients connected to the deleted conversation have their dispatcher handles closed when `SharedDispatcher.close()` is called. Server-side authorization is out of scope for v1 (see Open Questions).

---

## Client Integration

### CLI

The CLI implements the full conversation management surface described in this document, with client-side conversation persistence.

#### `connect` — join a conversation

```bash
agent-cli connect                        # connect to the 'CLI' conversation (created if absent)
agent-cli connect --resume               # resume the last used conversation
agent-cli connect --session <id>         # connect to a specific conversation by ID
agent-cli connect --port <port>          # connect to a server on a non-default port (default: 8999)
agent-cli connect --hidden               # start the server hidden (no visible window)
```

By default (no flags), `connect` targets a conversation named `"CLI"`. It calls `listSessions("CLI")` and joins the first match, or calls `createSession("CLI")` if none exists.

Pass `--resume` / `-r` to instead resume the last used conversation, whose ID is persisted client-side in `~/.typeagent/cli-state.json`. If that conversation is no longer found on the server, the user is prompted to join the `"CLI"` conversation (find-or-create). If the user declines, the stale ID is cleared and the command exits.

Pass `--session` / `-s <id>` to connect to a specific conversation by UUID. This takes priority over `--resume` if both are provided; errors propagate as-is without the recovery prompt.

Pass `--hidden` to start the agent server without a visible window. Default is a visible window for interactive use.

On every successful connection the connected session ID is written to `~/.typeagent/cli-state.json` for use by future `--resume` invocations.

#### `run` — non-interactive commands

`agent-cli run request`, `run translate`, and `run explain` each accept `--session <id>` / `-s` to target a specific conversation. If omitted, they use the find-or-create `"CLI"` conversation. The server is started hidden by default for non-interactive commands; use `--show` to get a visible window.

#### `server` — manage the server process

```bash
agent-cli server status                  # show whether the server is running
agent-cli server stop                    # send a graceful shutdown to the running server
```

#### `sessions` topic — conversation CRUD

| Command                                    | RPC call                     |
| ------------------------------------------ | ---------------------------- |
| `agent-cli sessions create <name>`         | `createSession(name)`        |
| `agent-cli sessions list [--name <sub>]`   | `listSessions(name?)`        |
| `agent-cli sessions rename <id> <newName>` | `renameSession(id, newName)` |
| `agent-cli sessions delete <id> [--yes]`   | `deleteSession(id)`          |

`sessions create`, `list`, `rename`, and `delete` use `connectAgentServer()` directly (no `joinSession()`) — they are management operations that do not require joining a conversation.

`sessions delete` prompts `Delete conversation <id> and all its data? (y/N)` before calling `deleteSession()`. Pass `--yes` / `-y` to skip the prompt.

`sessions list` renders a fixed-width table with columns `SESSION ID`, `NAME`, `CLIENTS`, and `CREATED AT`. Pass `--name <substring>` to filter by name (case-insensitive).

### Shell

Conversation management only applies when the Shell is running in **connected mode** (`--connect <port>`). In standalone mode the Shell runs an in-process dispatcher and manages its own session state independently.

When connected to the agentServer:

- On startup, Shell calls `listSessions()` and presents a conversation picker (or auto-connects to the default conversation).
- A conversation management panel allows listing, switching, renaming, and deleting conversations.
- When resuming a conversation, the Shell loads chat history from the server via `getDisplayHistory()` (which already exists on the `Dispatcher` interface and works per-conversation since each conversation has its own `DisplayLog` instance) rather than its local HTML file. How this history is rendered in the Shell UI is an open question — see Open Questions item 2.

---

## Out of Scope (Future Iterations)

- **Conversation sharing across machines** — conversations are local to one agentServer instance for now.
- **Conversation export/import** — useful for backup/restore, but not required for v1.
- **Per-conversation agent configuration** — conversations inherit the global agent enable/disable config for now.
- **Pagination for `listSessions()`** — the full index is loaded on every call; pagination (`limit`/`offset`) can be added once conversation counts grow large enough to matter.
- **Graceful drain on `deleteSession()`** — currently `deleteSession()` closes all client dispatcher handles immediately with no drain window. A future iteration should notify connected clients and await in-flight `processCommand()` calls (with a timeout) before tearing down the conversation.
- **Per-conversation concurrency lock** — concurrent `joinSession()` calls targeting the same session ID before lazy initialization completes could race. A per-conversation async mutex should be added in a follow-up.
- **LLM-generated conversation summaries** — auto-generating a one-line summary after the first exchange is a useful future addition for conversation discoverability, but is deferred in favor of explicit `name` for now.

---

## Open Questions

1. **Conversation size limits:** Should there be a maximum number of conversations? A maximum disk size per conversation? These constraints are useful for operational hygiene but depend on expected usage patterns.

2. **Shell history rendering on conversation resume:** When the Shell resumes a conversation in connected mode, it calls `getDisplayHistory()` to load prior history. The open question is how this is rendered: does the Shell rebuild the chat view in place from the returned entries, swap its local HTML file, or render history on demand? This is a Shell-specific UX and architecture decision to be resolved when this work is tackled.

3. **Client-Enforced Conversation Isolation:** Conversation isolation is currently **client-enforced**. The server provides `clientCount` as a signal, but nothing prevents a poorly behaved client from joining a conversation it shouldn't. Whether to add server-side enforcement (e.g., max connections per conversation, explicit conversation locking) is an open question for a future iteration.

---

## Natural Language Conversation Management

In addition to the RPC/CLI surface described above, users can manage server-side conversations via natural language through the `system.session` sub-agent built into the dispatcher. Phrases like "switch to my work conversation", "create a new conversation called research", or "delete the old project conversation" are translated into structured actions and bridged to the client layer.

Because the dispatcher has no direct access to the agent-server RPC layer, `executeSessionAction` uses the existing `ClientIO.takeAction` mechanism:

```typescript
agentContext.clientIO.takeAction(requestId, "manage-conversation", payload);
```

where `payload` has the shape:

```typescript
{ subcommand: "new"; name?: string }
{ subcommand: "list" }
{ subcommand: "info" }
{ subcommand: "switch" }
{ subcommand: "delete"; name: string }
{ subcommand: "rename"; name: string; newName: string }
```

Each client handles `"manage-conversation"` using its own conversation management API:

- **CLI** — `enhancedConsole.ts` receives the action and calls `handleConversationCommand(conversationContext, argsString)`, delegating to the same `@conversation` command machinery used for explicit slash commands (`new`, `list`, `info`, `switch`, `rename`, `delete`).
- **Shell** — `main.ts` receives the action and calls the corresponding `ClientAPI` session method (`sessionCreate`, `sessionList`, `sessionSwitch`, `sessionRename`, `sessionDelete`, `sessionGetCurrent`) over the Electron IPC bridge.

See the [dispatcher README](../../packages/dispatcher/dispatcher/README.md#sessions) for the full list of supported phrases.

## Summary

This design adds explicit conversation management to the agentServer without fundamentally restructuring its architecture. The core additions are:

- A `sessions.json` registry for discoverable, GUID-keyed named conversations.
- A `SessionManager` that maintains a pool of per-conversation `SharedDispatcher` instances, each with its own isolated `initializeCommandHandlerContext()` call, chat history, conversation memory, and persist directory.
- Five new RPC methods on the `AgentServer` channel: `joinSession`, `leaveSession`, `createSession`, `listSessions`, `renameSession`, `deleteSession`.
- `sessionId` in `DispatcherConnectOptions` so clients can resume a specific conversation by ID.
- `listSessions(name?)` with optional substring filtering as the primary conversation discovery mechanism.
- Session-namespaced WebSocket channels (`dispatcher:<id>`, `clientio:<id>`) enabling multiple concurrent conversations over a single connection.
- Idle dispatcher eviction after 5 minutes to free memory for inactive conversations.
- **A split storage root**: `instanceDir` (global, shared across all conversations) and `persistDir` (per-conversation, discarded with the conversation). `instanceStorage` is rooted at `instanceDir`, preserving agent configuration and auth tokens across conversation boundaries. `sessionStorage` and all ephemeral dispatcher data (chat history, memory, display log) remain scoped to `persistDir`. A new `instanceDir` field is added to `DispatcherOptions` and `CommandHandlerContext`; when absent, behavior falls back to `persistDir` for full backward compatibility with the standalone Shell, CLI, and tests.

The server enforces no policy on who can join or delete a conversation — `clientCount` gives clients the signal to make that decision themselves.

Conversation state is local to the server — the underlying LLM API is stateless, and the server owns all history management. This lifts that responsibility from individual clients (Shell, CLI) into the shared server layer, where it belongs.
