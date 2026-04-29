---
layout: docs
title: Multi-Client Interaction Protocol
---

## Overview

When multiple clients are connected to the same conversation via the AgentServer, the dispatcher needs to present interactive prompts (yes/no confirmations, choice menus, template editing) to the user. Because any connected client could be the active one, these interactions follow a **broadcast-and-race** pattern: the server sends the prompt to all clients simultaneously, and the first client to respond wins.

This document describes the protocol, the server-side machinery, and the responsibilities of each client implementation.

## Server-Side: SharedDispatcher

A `SharedDispatcher` is a single dispatcher instance shared among all clients connected to the same conversation. It owns a `PendingInteractionManager` — a map of in-flight interactions, each backed by a deferred promise that the dispatcher awaits to unblock execution.

### Interaction lifecycle

```
Server dispatcher                 Client A              Client B
─────────────────                 ────────              ────────
question() called
  create PendingInteraction
  broadcast requestInteraction ──► show prompt          show prompt
  await promise...

                                  user picks "1"
                                  respondToInteraction ──► server resolves promise
                                                           broadcast interactionResolved ──► dismiss prompt
  promise resolves
  execution continues
```

The same flow applies to `proposeAction`.

### Broadcast vs. targeted routing

Most `ClientIO` calls are **targeted**: they carry a `requestId.connectionId` that identifies which client initiated the request, and the server routes the call only to that client.

Interaction calls are **broadcast** to all clients, regardless of which client initiated the originating request. This is intentional: in a multi-client conversation the active user may be on any client.

| ClientIO method        | Routing                           | Notes                                                              |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `setDisplay`           | Broadcast (filtered by requestId) | All clients see output                                             |
| `question`             | Deferred broadcast                | Creates a `PendingInteraction`; broadcast via `requestInteraction` |
| `proposeAction`        | Deferred broadcast                | Same pattern                                                       |
| `requestInteraction`   | Broadcast                         | Sent to all clients to show the prompt                             |
| `interactionResolved`  | Broadcast                         | Sent to all clients after any one responds                         |
| `interactionCancelled` | Broadcast                         | Sent to all clients after `cancelInteraction` or timeout           |

### Timeouts

Pending interactions have a 10-minute timeout (configurable per-type in `sharedDispatcher.ts`). On timeout the deferred promise rejects and `interactionCancelled` is broadcast to all clients.

### Reconnects

Each `join()` call mints a new ephemeral `connectionId`. On reconnect a client receives a fresh `connectionId`, so interactions created before the disconnect (whose `requestId.connectionId` names the old connection) are not re-broadcast to the new connection. A joining client receives any still-pending interactions via `JoinConversationResult.pendingInteractions` and is responsible for displaying them and potentially responding.

## Interaction Types

### `question`

The `question` type is the single unified prompt type for all choice-based interactions. Choices are always explicit strings; the response is the 0-based index of the selected choice.

```typescript
// Request
{ type: "question"; message: string; choices: string[]; defaultId?: number }

// Response
{ interactionId: string; type: "question"; value: number }
```

Caller ergonomics on `SessionContext` are preserved with thin wrappers:

- **`popupQuestion(message, choices?, defaultId?)`** — delegates directly to `clientIO.question()`.
- **`askYesNoWithContext(context, message, defaultValue?)`** — calls `clientIO.question()` with `choices: ["Yes", "No"]`, maps `defaultValue: boolean` to `defaultId: 0 | 1`, and converts the returned index back to a boolean.

### `proposeAction`

`proposeAction` remains intentionally separate — it renders a structured template editor rather than a text prompt, and its response type is `unknown`. It is not yet supported in the CLI client.

## Client Responsibilities

Every `ClientIO` implementation must handle three interaction-related methods.

### `requestInteraction(interaction)`

Called when the server needs the client to show a prompt. The client must:

1. Display the appropriate UI for the interaction type (`question` or `proposeAction`).
2. Register the interaction locally (keyed by `interaction.interactionId`) so it can be dismissed later.
3. When the user responds, call `dispatcher.respondToInteraction(response)`.
4. Remove the local registration after responding or after being dismissed.

Only one client needs to respond — the server ignores duplicate responses for the same `interactionId`.

### `interactionResolved(interactionId, response)`

Called on all clients after any client successfully calls `respondToInteraction`. The client must:

1. Look up the active prompt by `interactionId`.
2. Cancel or dismiss the prompt without sending another response.
3. Optionally show a brief notice (e.g. `[answered by another client]`) so the user understands why the prompt disappeared.

### `interactionCancelled(interactionId)`

Called on all clients after `cancelInteraction` is called or the interaction times out. The client must:

1. Look up the active prompt by `interactionId`.
2. Cancel or dismiss the prompt.
3. Optionally show a notice (e.g. `[interaction cancelled]`).

## CLI Implementation Requirements

The CLI (`enhancedConsole.ts`) owns stdin and renders prompts inline in the terminal. To support multiple clients it needs:

### Active prompt registry

A `Map<string, AbortController>` keyed by `interactionId`, local to `createEnhancedClientIO`. Each entry holds an `AbortController` whose signal is passed to the `question()` call so it can be aborted remotely.

```typescript
const activeInteractions = new Map<string, AbortController>();
```

### Cancellable `question()` races

`requestInteraction` creates an `AbortController`, stores it in `activeInteractions`, and passes its signal to the underlying `question()` readline call. When `abort()` is called (by `interactionResolved` or `interactionCancelled`), the pending readline rejects with the abort reason.

```
requestInteraction(interaction):
  ac = new AbortController()
  activeInteractions.set(interaction.interactionId, ac)

  try:
    display numbered choice menu
    input = await question(prompt, rl, ac.signal)
    value = parse input as 1-based index
    await dispatcher.respondToInteraction({ type: "question", value })
  catch (AbortError):
    if reason.kind === "resolved-by-other":
      print "[answered by another client]"
    else:
      print "Cancelled!"
  finally:
    activeInteractions.delete(interaction.interactionId)
```

The `question()` function itself must also clean up its stdin listener when the signal fires, to avoid a leaked `data` listener on stdin.

### `interactionResolved` and `interactionCancelled`

```typescript
interactionResolved(interactionId, response): void {
    const ac = activeInteractions.get(interactionId);
    if (ac) {
        activeInteractions.delete(interactionId);
        ac.abort({ kind: "resolved-by-other", response });
    }
},
interactionCancelled(interactionId): void {
    const ac = activeInteractions.get(interactionId);
    if (ac) {
        activeInteractions.delete(interactionId);
        ac.abort(INTERACTION_CANCELLED);
    }
},
```

The abort reasons distinguish resolved vs. cancelled so the client can print the appropriate notice.

## Shell Implementation

The Shell (`main.ts`) implements the same `AbortController` pattern as the CLI. `registerClient()` holds a `Map<string, AbortController>` (called `activeInteractions`) scoped to the session. Each interaction is registered on `requestInteraction` and removed after the user responds or the interaction is dismissed.

### `requestInteraction`

Creates an `AbortController`, registers it in `activeInteractions`, and fires an async IIFE that calls `chatView.showInteractionQuestion()` (for `question`) or `chatView.proposeAction()` (for `proposeAction`). On success it calls `chatView.respondToInteraction(response)`. On abort it distinguishes known abort reasons (`{ kind: "resolved-by-other" }` / `"cancelled"`) from unexpected errors and logs the latter.

`chatView.showInteractionQuestion()` renders the prompt inline in the chat scroll region using `ChoicePanel`. For binary `["Yes", "No"]` choices it reuses the same icon elements as the standalone `askYesNo()` path for visual consistency. All other choice sets render a numbered button panel. The method accepts an `AbortSignal` and dismisses the panel — appending a `[answered by another client]` or `[interaction cancelled]` inline notice — when the signal fires.

### `interactionResolved` and `interactionCancelled`

```typescript
interactionResolved(interactionId): void {
    const ac = activeInteractions.get(interactionId);
    if (ac) {
        activeInteractions.delete(interactionId);
        ac.abort({ kind: "resolved-by-other" });
    }
},
interactionCancelled(interactionId): void {
    const ac = activeInteractions.get(interactionId);
    if (ac) {
        activeInteractions.delete(interactionId);
        ac.abort("cancelled");
    }
},
```

### Standalone mode

When the Shell runs its own dispatcher (not connected to an agent-server), `question()` is called directly on the renderer `ClientIO` — not via `requestInteraction`. In this path `showInteractionQuestion()` is called with `interactionId: ""` and no `AbortSignal`, since there are no other clients that could call `interactionResolved`/`interactionCancelled`.

`popupQuestion` interactions (no `requestId`) use a synthesised `clientRequestId` with the `agent-interaction-` prefix, which triggers auto-creation of a standalone `MessageGroup` in the chat with no user bubble.

## Future Work

- **`proposeAction` in CLI**: render the structured template editor inline in the terminal.
- **Stable client identity**: allow a reconnecting client to reclaim its old `connectionId` so in-flight interactions are re-broadcast rather than orphaned (see `TODO` in `sharedDispatcher.ts` `join()`).
- **Freeform text input**: add a `textInput` interaction type for open-ended questions where the agent needs a free-form string from the user (e.g. "What name should I use?"). This would follow the same broadcast-and-race pattern as `question`, with a `{ type: "textInput"; message: string; defaultValue?: string }` request and a `{ type: "textInput"; value: string }` response. A precedent exists in `typeagent/src/chat.ts` (`ChatUserInterface.getInput()`) and `knowledgeProcessor` which use this pattern outside the dispatcher layer.
