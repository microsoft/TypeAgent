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
/conversation                   — Show conversation command help
/conversation help              — Show conversation command help
/conversation list              — List all conversations
/conversation new [name]        — Create a new conversation
/conversation switch <id|name>  — Switch to a conversation
/conversation info              — Show current conversation info
/conversation next              — Switch to the next conversation (wraps around)
/conversation prev              — Switch to the previous conversation (wraps around)
/conversation rename <id|name> <name>  — Rename a conversation
/conversation delete <id|name>  — Delete a conversation
```

`@conversation` is accepted as an alias for `/conversation`. Natural-language phrases ("list my conversations", "create a new conversation called notes", etc.) are translated by the `system.conversation` sub-agent into the same `manage-conversation` `ClientIO.takeAction` payload, so all three input styles share one client-side renderer (`packages/shell/src/renderer/src/chatPanelBridge.ts:handleManageConversation`).

On startup, the Shell first tries to restore the last conversation it had open (`userSettings.conversation.lastConversationId`); if that conversation no longer exists on the server (deleted, server data wiped, etc.), it falls back to find-or-create a conversation named `"Shell"`. See `packages/shell/src/main/instance.ts`.

### VS Code Shell

The VS Code extension (`packages/vscode-shell`) runs in **connected mode only** — it always talks to a separately-launched agentServer. It is a webview-based chat client with a **sidebar** view plus zero-to-many **tab panels**, each of which holds its own `AgentServerBridge` and may be on a different conversation.

| Surface        | Default landing conversation                                                                                                                             | Restored across reloads?                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar        | Find-or-create a conversation named **`"VS Code"`** (mirroring CLI's `"CLI"` and Shell's `"Shell"`).                                                     | Yes — `globalState["sidebar.lastSessionId"]`.                                                                                             |
| Each tab panel | A **fresh ephemeral** conversation named `cli-ephemeral-vscode-<n>-<ts>`. Ephemerals are swept by the server on startup if they outlive an unclean exit. | The exact ephemeral is restored if the panel state is rehydrated and the conversation still exists; otherwise a new ephemeral is created. |

The sidebar's restore wins over the `"VS Code"` find-or-create whenever the saved id still resolves on the server. The find-or-create only fires on fresh installs, or when the saved conversation has been deleted out from under the extension. Find-or-create races (two VS Code windows opening simultaneously) are handled by re-listing on `createSession` rejection and adopting the winner.

Both `@conversation` slash commands and natural-language phrases ("create a new conversation", "list my conversations", etc.) are routed through the same `manage-conversation` `ClientIO.takeAction` flow as the Shell and CLI. The VS Code shell renders:

- Non-switching results (`list`, `info`, `rename`, `delete`, error messages) in place via `overwriteActionBubble` — they replace the request's own agent-bubble in the current conversation.
- Switching results (`new`, `switch`, `prev`, `next`) via a separate `conversationNotification` webview message that lands **after** the session switch completes. This is necessary because `sessionChanged` triggers `chatPanel.clear()` in the webview, wiping any bubble written in the OLD conversation before the switch.

All HTML interpolated into either path is escaped via a local `escapeHtml()` (matching `shell/src/renderer/src/htmlUtil.ts`) so conversation names, session ids, and server-error messages cannot inject markup.

See `packages/vscode-shell/src/agentServerBridge.ts` (`handleManageConversation`, `connectImpl`) and `packages/vscode-shell/src/extension.ts` for the implementation.

### Browser Extension

The browser extension (`packages/agents/browserExtension/src/extension`) is a Chrome MV3 extension that runs in **connected mode only** — its service worker maintains a WebSocket to the agentServer. The chat panel surfaces the same `@conversation` slash commands and NL phrases as the Shell and CLI.

The chat panel forwards the dispatcher's `manage-conversation` `takeAction` payload to the service worker via a `chatPanelManageConversation` invoke RPC. The service worker (`extension/serviceWorker/dispatcherConnection.ts`) delegates to the shared `manageConversation` helper from `@typeagent/agent-server-client/conversation` (which implements all eight subcommands) via a thin `AgentServerConnection` adapter over the extension's RPC channel, and returns a rendered HTML message plus a `switched` flag.

When `switched` is set, the chat panel clears its DOM and re-runs `loadSessionHistory()` (mirroring the Shell's `replayDisplayHistory` on `conversationChanged`), then renders the confirmation message so it lands after the replayed history. Live display events arriving during the replay are queued via a `runOrDefer` gate and flushed in order on completion.

Switching follows the bind-new → leave-old → delete-old-channels ordering enforced by `switchConversationSafe`: if the new join throws, the existing dispatcher and channels stay live so the user can retry. The chat panel joins with `filter: false` (matching Shell), so display events from peer clients (Shell or CLI joined to the same conversation) are also visible.

See `packages/agents/browserExtension/src/extension/serviceWorker/dispatcherConnection.ts` (`bindToConversation`, `joinConversationDispatcher`, `makeConnectionAdapter`, `manageConversation`) and `packages/agents/browserExtension/src/extension/views/chatPanel.ts` (`dispatcherTakeAction`, `runOrDefer`, `loadSessionHistory`) for the implementation.

---

## Shared Client Helpers

All four clients (CLI, Electron Shell, VS Code, browser extension) drive their conversation surfaces through the shared `@typeagent/agent-server-client/conversation` package. It is UI-agnostic — no chalk, no HTML, no Electron, no DOM — and consolidates the find-or-create, restore-or-fallback, join-before-leave, and `manage-conversation` logic that the four clients previously reinvented (with subtly different race handling).

Modules:

| Module         | Surface                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming.ts`    | `normalizeConversationName`, `findConversationByName`, `findUniqueConversationByName`, `formatAutoConversationName`, `sortConversationsByCreatedDesc`                                                                                                                  |
| `lifecycle.ts` | `findOrCreateNamedConversation`, `joinNamedOrFallback`, `switchConversationSafe`, `createEphemeralConversation`, `deleteEphemeralConversation`, `validateConversationNameUnique`, `isConversationNotFoundError`                                                        |
| `manage.ts`    | `manageConversation` (top-level dispatcher) + per-subcommand entries (`manageNew`, `manageList`, `manageInfo`, `manageSwitch`, `manageCycle`, `manageRename`, `manageDelete`). All return a discriminated `ConversationActionResult` the caller renders to its own UI. |

### Switch protocol

`switchConversationSafe` enforces the strict join-before-leave protocol every client needs:

1. Join the target conversation. Failure leaves the caller on the current one and returns `kind: "join-failed"`.
2. Invoke `onJoined` (caller rebinds the active dispatcher). A throw here triggers a rollback: the helper leaves the freshly-joined target and re-throws.
3. Invoke `onPersist` (best-effort; a throw is swallowed — persistence never blocks a switch).
4. Leave the old conversation (best-effort), then invoke `onLeftOld` exactly once with `(oldId, leaveError | undefined)`. A throw inside `onLeftOld` is swallowed.

The `manage-conversation` surface exposes the same staged sequence via two distinct hooks on `ManageConversationContext`:

- **`onSwitched`** — pre-leave; rebind the active dispatcher and any per-conversation request-id maps. **Keep work here minimal.** Broadcasts, UI clears, and history replay that could observe events from the old conversation belong in `onAfterSwitched`.
- **`onAfterSwitched(newConversation, leaveError)`** — post-leave; safe place for history replay, "conversation changed" broadcasts, and any output that must not race lingering events from the old conversation. A throw here is swallowed.
- **`onPersistSwitched`** — best-effort persistence; same swallow-on-throw semantics as `onPersist` in `switchConversationSafe`.
- **`onCurrentConversationUpdated(updated)`** — fires when a manage-* op changes the *current\* conversation's metadata in place (e.g. `rename` of the active one). Refresh title bars and cached names here. A throw is swallowed.
- **`confirmDestructive(action, target)`** — prompt the user for destructive subcommands (`delete`). A throw is caught and surfaced as an `error` result (it is **not** treated as user-cancellation; that would mask infrastructure failures).
- **`cycleOrder`** — `"newest-first"` (default; matches CLI/Shell list output) or `"server-order"` (matches VS Code's QuickPick order).
- **`cycleOnCurrentNotInList`** — `"wrap"` (default; jumps to index 0) or `"error"` (refuses to cycle from a conversation that's gone from the list; matches browser UX).

### Race handling

- **Find-or-create race**: `findOrCreateNamedConversation` re-lists after a failed `createConversation` and adopts the peer's winning entry instead of bubbling the create error. The name is trimmed once at the boundary so it matches the server's uniqueness check (which trims) even when the server's list filter (which does not trim, only case-insensitive `includes`) misses it.
- **Saved-id vs. default-fallback race**: `joinNamedOrFallback` recovers from "deleted between list and join" by re-running `findOrCreateNamedConversation`. Other join errors (permission, transport) are **surfaced as-is**, not masked by a spurious re-create. Callers can override the fallback decision via the optional `shouldFallback(err)` hook.
- **Peer-already-deleted**: `manageDelete` treats a server `Conversation not found` from the delete RPC as idempotent success — the user wanted it gone and it is.
- **Per-client mutex**: `switchConversationSafe` is re-entrant per client, but clients that issue overlapping switches (e.g. VS Code's rapid `@conversation next`) must serialize calls themselves. VS Code uses `joinInFlight`; the browser extension uses a `conversationOpQueue` promise chain.

### Per-client integration

| Client       | Entry point                                                                            | Notes                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI          | `packages/cli/src/conversationCommands.ts`                                             | Splits rebind (`onSwitched`) from replay (`onAfterSwitched`) in `commands/connect.ts`.                                                                                              |
| Shell        | `packages/shell/src/main/conversationManager.ts`                                       | `commitSwitch` is pre-leave; `broadcastSwitched` is post-leave (wired into `onLeftOld` for explicit switch + `onAfterSwitched` for manage).                                         |
| VS Code      | `packages/vscode-shell/src/agentServerBridge.ts`                                       | `applySessionJoinedRebindOnly` is pre-leave; `sessionChanged`/`status`/replay broadcasts go in `onAfterSwitched`. Manage handler wraps all switching subcommands in `joinInFlight`. |
| Browser ext. | `packages/agents/browserExtension/src/extension/serviceWorker/dispatcherConnection.ts` | `makeConnectionAdapter()` resolves the live module-level WS/RPC state on every call so a reconnect mid-op doesn't bind on stale transport.                                          |

Tests live in `packages/agentServer/client/test/conversation-{naming,lifecycle,manage}.spec.ts` and exercise the helpers against an in-memory stub `AgentServerConnection`.

---

## Natural Language Conversation Management

Users can manage conversations via natural language through the `system.conversation` sub-agent. Phrases like "switch to my work conversation", "create a new conversation called research", or "delete the old project conversation" are translated into structured actions and bridged to the client layer via `ClientIO.takeAction`:

```typescript
agentContext.clientIO.takeAction(requestId, "manage-conversation", payload);
```

where `payload` has the shape:

```typescript
{ subcommand: "help" }
{ subcommand: "new"; name?: string }
{ subcommand: "list" }
{ subcommand: "info" }
{ subcommand: "switch"; name: string }
{ subcommand: "prev" }
{ subcommand: "next" }
{ subcommand: "delete"; name: string }
{ subcommand: "rename"; name?: string; newName: string }
```

`help` is dispatched when `@conversation` / `/conversation` is invoked with no subcommand (via the dispatcher's `defaultSubCommand: "help"`); there is intentionally no natural-language form for it. NL drops `help` from its `ConversationActionPayload` union and only emits `new`, `list`, `info`, `switch`, `prev`, `next`, `rename`, `delete`. See `packages/dispatcher/dispatcher/src/context/system/manageConversationPayload.ts` for the authoritative type.

Each client handles `"manage-conversation"` using its own conversation management API:

- **CLI** — `enhancedConsole.ts` calls `handleConversationCommand(conversationContext, argsString)`, delegating to the same `@conversation` command machinery used for explicit slash commands.
- **Shell** — `chatPanelBridge.ts:handleManageConversation` renders results into the active `chat-ui` chat panel via `addAgentMessage` (info) or `showInline` (warnings/errors), and switches conversations via the corresponding `ClientAPI` methods (`conversationCreate`, `conversationList`, `conversationSwitch`, `conversationRename`, `conversationDelete`, `conversationGetCurrent`) over the Electron IPC bridge. All HTML interpolated into bubbles is escaped via a local `escapeHtml()`.
- **VS Code Shell** — `agentServerBridge.handleManageConversation` invokes the legacy `LegacyAgentServerConnection` (`listSessions`/`createSession`/`renameSession`/`deleteSession`) directly. Renders results inline via `overwriteActionBubble` for non-switching subcommands, and via the post-switch `conversationNotification` webview message for switching subcommands (`new`/`switch`/`prev`/`next`).

See the [dispatcher README](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/README.md#conversations) for the full list of supported phrases.
