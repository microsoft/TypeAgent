# AgentServer Conversations Architecture

---

## Overview

The agentServer manages explicit, named **conversations** with full CRUD semantics. Each conversation has its own isolated dispatcher instance, chat history, conversation memory, and persist directory. Multiple clients can connect to the same conversation simultaneously and share state; clients connected to different conversations are fully isolated.

Conversations are identified by a UUIDv4 and carry a human-readable name. The server exposes conversation management via RPC, CLI commands, and natural-language actions routed through the `system.conversation` sub-agent.

---

## Conversation Identity

Each conversation is described by:

| Field            | Type                | Description                                                                                                                                         |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversationId` | `string` (UUIDv4)   | Stable, globally unique identifier                                                                                                                  |
| `name`           | `string`            | Human-readable label (1–256 chars), set at `createConversation()` time. Not enforced unique.                                                        |
| `createdAt`      | `string` (ISO 8601) | When the conversation was first created                                                                                                             |
| `clientCount`    | `number`            | Number of clients currently connected to this conversation (runtime-derived; `0` if the conversation is not loaded in memory). **Never persisted.** |

---

## On-Disk Layout

A `conversations.json` file at `instanceDir/conversations/conversations.json` is the authoritative registry:

```json
{
  "sessions": [
    {
      "conversationId": "a1b2c3d4-...",
      "name": "workout playlist setup",
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

> **Note:** The `"sessions"` JSON array key is kept for on-disk backward compatibility.

Each conversation's ephemeral data (chat history, conversation memory, display log, session config) lives in `instanceDir/conversations/<conversationId>/`. Agent `instanceStorage` (config, auth tokens, learned state) lives directly under `instanceDir/<agentName>/` and is **shared across all conversations**.

```
~/.typeagent/profiles/dev/                                              ← instanceDir (global)
~/.typeagent/profiles/dev/conversations/<conversationId>/               ← persistDir (per conversation)
~/.typeagent/profiles/dev/conversations/<conversationId>/sessions/<id>/ ← sessionStorage
~/.typeagent/profiles/dev/<agentName>/                                  ← instanceStorage (global)
```

### On-disk migration

The `ConversationManager` runs a one-time migration on startup:

1. If `instanceDir/server-sessions/` exists, it is renamed to `instanceDir/conversations/`.
2. If `instanceDir/conversations/sessions.json` exists, it is renamed to `conversations.json`.
3. If any entry in `conversations.json` has a legacy `sessionId` field instead of `conversationId`, the field is migrated and the file is rewritten in the current format.

---

## Storage Scopes

The dispatcher exposes two storage scopes to agents via `SessionContext`:

| Scope             | Root directory                     | Lifetime                                      |
| ----------------- | ---------------------------------- | --------------------------------------------- |
| `instanceStorage` | `instanceDir/<agentName>/`         | Lives across conversations; never discarded   |
| `sessionStorage`  | `persistDir/sessions/<sessionId>/` | Scoped to one conversation; discarded with it |

When `instanceDir` is absent (standalone Shell, CLI, tests), `instanceStorage` falls back to `persistDir` — preserving full backward compatibility.

---

## RPC Protocol

### `DispatcherConnectOptions`

```typescript
type DispatcherConnectOptions = {
  filter?: boolean;
  clientType?: "shell" | "extension";
  conversationId?: string; // Join a specific conversation by UUID. If omitted → connects to the default conversation.
};
```

### `AgentServerInvokeFunctions`

```typescript
type AgentServerInvokeFunctions = {
  joinConversation: (
    options?: DispatcherConnectOptions,
  ) => Promise<JoinConversationResult>;
  leaveConversation: (conversationId: string) => Promise<void>;

  createConversation: (name: string) => Promise<ConversationInfo>;
  listConversations: (name?: string) => Promise<ConversationInfo[]>;
  renameConversation: (
    conversationId: string,
    newName: string,
  ) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
};
```

### `JoinConversationResult`

```typescript
type JoinConversationResult = {
  connectionId: string;
  conversationId: string; // The conversation that was joined or auto-created
};
```

### `ConversationInfo`

```typescript
type ConversationInfo = {
  conversationId: string;
  name: string;
  clientCount: number;
  createdAt: string;
};
```

---

## Server Architecture: `ConversationManager` and `SharedDispatcher`

The `ConversationManager` maintains a pool of per-conversation `SharedDispatcher` instances — one per active conversation, shared by all clients connected to that conversation.

```
AgentServer
  └── ConversationManager
        ├── ConversationRecord[conversation-A]
        │     └── SharedDispatcher ← clients 0, 1 (both connected to conversation A)
        └── ConversationRecord[conversation-B]
              └── SharedDispatcher ← client 2 (connected to conversation B)
```

Each conversation's `SharedDispatcher` is created lazily on first `joinConversation()` and initialized with:

- `instanceDir` — global, shared across all conversations
- `persistDir` — scoped to `conversations/<conversationId>/`, discarded when the conversation is deleted

`SharedDispatcher.join()` calls `createDispatcherFromContext(context, connectionId, ...)` per client — producing a lightweight `Dispatcher` handle bound to a unique `connectionId` but sharing the same underlying context. Output routing is per-client via `connectionId`; conversation state (chat history, memory, config) is shared across all clients in the conversation.

Idle conversation dispatchers are automatically evicted from memory after 5 minutes with no connected clients.

### Channel Namespacing

Each conversation uses namespaced WebSocket channels:

- `dispatcher:<conversationId>` — the dispatcher RPC channel for that conversation
- `clientio:<conversationId>` — the ClientIO channel for that conversation

---

## `joinConversation()` Flow

```
Client calls joinConversation({ conversationId?, clientType, filter })
  │
  ├─ conversationId provided?
  │   ├─ Yes → look up in conversations.json
  │   │   ├─ Found → load SharedDispatcher (lazy init if not in memory pool)
  │   │   └─ Not found → error: "Conversation not found"
  │   └─ No → connect to the default conversation
  │       ├─ Conversation named "default" exists → use it
  │       └─ No conversations exist → auto-create conversation named "default"
  │
  ├─ Register client in conversation's SharedDispatcher routing table
  └─ Return JoinConversationResult { connectionId, conversationId }
```

---

## `deleteConversation()` Flow

1. Close all active client dispatcher handles for the conversation.
2. Shut down and evict the conversation's `SharedDispatcher` from the memory pool.
3. Remove `instanceDir/conversations/<conversationId>/` from disk (recursive delete of the `persistDir` subtree only). **Agent `instanceStorage` under `instanceDir/<agentName>/` is not touched.**
4. Remove the entry from `conversations.json`.

---

## Client Integration

### CLI

#### `connect` — join a conversation

```bash
agent-cli connect                        # connect to the 'CLI' conversation (created if absent)
agent-cli connect --resume               # resume the last used conversation
agent-cli connect --conversation <id>    # connect to a specific conversation by ID
agent-cli connect --port <port>          # connect to a server on a non-default port (default: 8999)
agent-cli connect --hidden               # start the server hidden (no visible window)
```

By default, `connect` targets a conversation named `"CLI"`. It calls `listConversations("CLI")` and joins the first match, or calls `createConversation("CLI")` if none exists.

`--resume` / `-r` resumes the last used conversation, whose ID is persisted client-side in `~/.typeagent/cli-state.json`. If that conversation is no longer found on the server, the user is prompted to fall back to `"CLI"`.

`--conversation` / `-c <id>` connects to a specific conversation by UUID and takes priority over `--resume`.

On every successful connection, the conversation ID is written to `~/.typeagent/cli-state.json` for future `--resume` invocations.

#### `conversations` topic — conversation CRUD

| Command                                         | RPC call                          |
| ----------------------------------------------- | --------------------------------- |
| `agent-cli conversations create <name>`         | `createConversation(name)`        |
| `agent-cli conversations list [--name <sub>]`   | `listConversations(name?)`        |
| `agent-cli conversations rename <id> <newName>` | `renameConversation(id, newName)` |
| `agent-cli conversations delete <id> [--yes]`   | `deleteConversation(id)`          |

These are management-only operations and do not require joining a conversation. `conversations list` renders a table with columns `CONVERSATION ID`, `NAME`, `CLIENTS`, and `CREATED AT`.

#### `run` — non-interactive commands

`agent-cli run request`, `run translate`, and `run explain` each accept `--conversation <id>` / `-c` to target a specific conversation. If omitted, they use the find-or-create `"CLI"` conversation.

### Shell

Conversation management only applies when the Shell is running in **connected mode** (`--connect <port>`). In standalone mode the Shell manages its own session state independently.

When connected to the agentServer, the Shell exposes `/conversation` commands in the chat input:

```
/conversation list              — List all conversations
/conversation new [name]        — Create a new conversation
/conversation switch <id|name>  — Switch to a conversation
/conversation info              — Show current conversation info
/conversation rename <id|name> <name>  — Rename a conversation
/conversation delete <id|name>  — Delete a conversation
```

`@conversation` is accepted as an alias for `/conversation`.

---

## Natural Language Conversation Management

Users can manage conversations via natural language through the `system.conversation` sub-agent. Phrases like "switch to my work conversation", "create a new conversation called research", or "delete the old project conversation" are translated into structured actions and bridged to the client layer via `ClientIO.takeAction`:

```typescript
agentContext.clientIO.takeAction(requestId, "manage-conversation", payload);
```

where `payload` has the shape:

```typescript
{ subcommand: "new"; name?: string }
{ subcommand: "list" }
{ subcommand: "info" }
{ subcommand: "switch"; name: string }
{ subcommand: "delete"; name: string }
{ subcommand: "rename"; name?: string; newName: string }
```

Each client handles `"manage-conversation"` using its own conversation management API:

- **CLI** — `enhancedConsole.ts` calls `handleConversationCommand(conversationContext, argsString)`, delegating to the same `@conversation` command machinery used for explicit slash commands.
- **Shell** — `main.ts` calls the corresponding `ClientAPI` method (`conversationCreate`, `conversationList`, `conversationSwitch`, `conversationRename`, `conversationDelete`, `conversationGetCurrent`) over the Electron IPC bridge.

See the [dispatcher README](../../packages/dispatcher/dispatcher/README.md#conversations) for the full list of supported phrases.
