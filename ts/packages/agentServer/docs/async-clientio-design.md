# Async ClientIO Callbacks: Design Document

## Status

**Draft** | April 2026 | Questions 1, 2, 4 resolved; Question 3 open

## Summary

Three methods on the `ClientIO` interface --- `askYesNo`, `proposeAction`, and `popupQuestion` --- are currently **synchronous, blocking RPC calls**. When the agent-server dispatches one of these calls, the server-side command processing blocks until the specific connected client responds. This creates several problems in a multi-client server environment:

1. **Client disconnection** during a pending callback leaves the server-side command permanently hung (the `Promise` never resolves).
2. **Reconnecting clients** cannot resume or answer a pending question from a previous connection.
3. **Pending interactions are not logged** to the `DisplayLog`, so they cannot be replayed to new clients joining the session.
4. **`popupQuestion` is entirely disabled** in server mode (`throw new Error("Not supported in server mode")`).

This document proposes converting these blocking callbacks into a **non-blocking, log-and-resume pattern** modeled on the existing `requestChoice`/`respondToChoice` mechanism already present in the dispatcher.

---

## Current State Analysis

### The Three Blocking Callbacks

All three methods are defined in `packages/dispatcher/types/src/clientIO.ts`:

```typescript
// ClientIO interface (excerpt)
askYesNo(requestId: RequestId, message: string, defaultValue?: boolean): Promise<boolean>;
proposeAction(requestId: RequestId, actionTemplates: TemplateEditConfig, source: string): Promise<unknown>;
popupQuestion(message: string, choices: string[], defaultId: number | undefined, source: string): Promise<number>;
```

They are classified as **invoke functions** in the RPC layer (`packages/dispatcher/rpc/src/clientIOTypes.ts`):

```typescript
export type ClientIOInvokeFunctions = {
    askYesNo(...): Promise<boolean>;
    proposeAction(...): Promise<unknown>;
    popupQuestion(...): Promise<number>;
    openLocalView(...): Promise<void>;
    closeLocalView(...): Promise<void>;
};
```

This means the RPC transport uses `rpc.invoke()` (request-response) rather than `rpc.send()` (fire-and-forget) for these methods.

### How SharedDispatcher Routes Them Today

In `packages/agentServer/server/src/sharedDispatcher.ts`, the shared `ClientIO` uses a `callback()` helper for these methods:

```typescript
const callback = <T>(requestId: RequestId, fn: (clientIO: ClientIO) => T) => {
    const connectionId = requestId.connectionId;
    // ... looks up client by connectionId ...
    return fn(record.clientIO);
};

// Usage:
askYesNo: async (requestId, ...args) =>
    callback(requestId, (clientIO) => clientIO.askYesNo(requestId, ...args)),
proposeAction: async (requestId, ...args) =>
    callback(requestId, (clientIO) => clientIO.proposeAction(requestId, ...args)),
popupQuestion: async () => {
    throw new Error("Not supported in server mode");
},
```

Key observations:

- `askYesNo` and `proposeAction` route to the specific client that initiated the request (via `requestId.connectionId`).
- `popupQuestion` is unconditionally disabled because it has no `requestId` parameter to route by.
- If the client disconnects while the RPC invoke is in-flight, the Promise rejects with a channel error, but the calling code (deep in a command handler) has no recovery path.

### Callers of These Methods

**`askYesNo`** is called from:

- `askYesNoWithContext()` in `context/interactiveIO.ts` (the primary wrapper; returns `defaultValue` in batch mode)
- At least 12 files across the dispatcher use `askYesNoWithContext()`: file overwrite confirmations, session operations, agent enable/disable prompts, etc.

**`proposeAction`** is called from:

- `confirmTranslation()` in `translation/confirmTranslation.ts` (developer-mode inline action editing)

**`popupQuestion`** is called from:

- `SessionContext.popupQuestion()` in `execute/sessionContext.ts` (exposed to agents via the SDK)

### The Existing Non-Blocking Pattern: `requestChoice`/`respondToChoice`

The codebase already has a non-blocking interaction pattern that serves as our model:

1. **Agent returns `pendingChoice`** in its `ActionResult` (`execute/actionHandlers.ts:216-231`):

   ```typescript
   if (result.pendingChoice !== undefined) {
       const pc = result.pendingChoice;
       systemContext.pendingChoiceRoutes.set(pc.choiceId, {
           agentName: appAgentName, requestId, actionIndex,
       });
       systemContext.clientIO.requestChoice(requestId, pc.choiceId, pc.type, pc.message, ...);
   }
   ```

2. **`requestChoice`** is a fire-and-forget `ClientIOCallFunction` --- it sends the question to the client without blocking.

3. **Client responds** by calling `dispatcher.respondToChoice(choiceId, response)` (`dispatcher.ts:299-344`):

   ```typescript
   async respondToChoice(choiceId: string, response: boolean | number[]) {
       return context.commandLock(async () => {
           const pending = context.pendingChoiceRoutes.get(choiceId);
           context.pendingChoiceRoutes.delete(choiceId);
           // ... routes to agent's handleChoice() ...
       });
   }
   ```

4. **Pending state** is stored in `context.pendingChoiceRoutes: Map<string, { agentName, requestId, actionIndex }>`.

This pattern: (a) does not block the server, (b) uses a correlation ID (`choiceId`), (c) stores pending state in a Map, and (d) routes the response through a dispatcher method.

### DisplayLog Gaps

The `DisplayLog` class (`dispatcher/src/displayLog.ts`) persists five entry types:

- `set-display`, `append-display`, `set-display-info`, `notify`, `user-request`

It does **not** log any entries for `askYesNo`, `proposeAction`, or `popupQuestion` interactions. The `DisplayLogEntry` union type in `types/src/displayLogEntry.ts` has no types for pending interactions.

The SharedDispatcher patches `setUserRequest`, `setDisplay`, and `appendDisplay` to mirror into the DisplayLog, but the three blocking callbacks are not intercepted.

---

## Proposed Design

### Core Idea

Replace each blocking callback with a **two-phase non-blocking protocol**:

1. **Request phase**: The server sends a fire-and-forget notification to the client describing the pending interaction, assigns a unique `interactionId`, logs it to `DisplayLog`, and stores the pending state. The server-side command processing **suspends** (via a deferred Promise stored in the pending state).
2. **Response phase**: The client sends a response message referencing the `interactionId`. The server resolves the deferred Promise, resuming command processing exactly where it left off.

This is architecturally identical to `requestChoice`/`respondToChoice`, but generalized to support the three callback types.

### New Types

#### Interaction Request Types

```typescript
// New file or added to dispatcher-types

export type PendingInteractionType =
  | "askYesNo"
  | "proposeAction"
  | "popupQuestion";

export type PendingInteractionRequest = {
  interactionId: string;
  type: PendingInteractionType;
  requestId: RequestId; // absent for popupQuestion (session-level)
  source: string;
  timestamp: number;
} & (
  | { type: "askYesNo"; message: string; defaultValue?: boolean }
  | { type: "proposeAction"; actionTemplates: TemplateEditConfig }
  | {
      type: "popupQuestion";
      message: string;
      choices: string[];
      defaultId?: number;
    }
);
```

#### Interaction Response Types

```typescript
export type PendingInteractionResponse =
  | { interactionId: string; type: "askYesNo"; value: boolean }
  | { interactionId: string; type: "proposeAction"; value: unknown }
  | { interactionId: string; type: "popupQuestion"; value: number };
```

#### New DisplayLogEntry Types

```typescript
// Added to displayLogEntry.ts

export type PendingInteractionEntry = {
  type: "pending-interaction";
  seq: number;
  timestamp: number;
  interactionId: string;
  interactionType: PendingInteractionType;
  requestId?: RequestId;
  source: string;
  // Type-specific payload:
  message?: string; // askYesNo, popupQuestion
  defaultValue?: boolean; // askYesNo
  choices?: string[]; // popupQuestion
  defaultId?: number; // popupQuestion
  actionTemplates?: TemplateEditConfig; // proposeAction
};

export type InteractionResolvedEntry = {
  type: "interaction-resolved";
  seq: number;
  timestamp: number;
  interactionId: string;
  response: unknown; // The client's answer
};

// Updated union:
export type DisplayLogEntry =
  | SetDisplayEntry
  | AppendDisplayEntry
  | SetDisplayInfoEntry
  | NotifyEntry
  | UserRequestEntry
  | PendingInteractionEntry
  | InteractionResolvedEntry;
```

### Pending Interaction Manager

A new class to manage in-flight interactions, stored on `CommandHandlerContext`:

```typescript
// New: context/pendingInteractionManager.ts

export class PendingInteractionManager {
    private pending = new Map<string, {
        type: PendingInteractionType;
        requestId?: RequestId;
        connectionId?: string;
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timeoutTimer?: ReturnType<typeof setTimeout>;
    }>();

    /**
     * Create a pending interaction and return a Promise that resolves
     * when the client responds (or rejects on timeout/cancellation).
     */
    create<T>(
        interactionId: string,
        type: PendingInteractionType,
        requestId: RequestId | undefined,
        connectionId: string | undefined,
        timeoutMs?: number,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const entry = { type, requestId, connectionId, resolve, reject };
            this.pending.set(interactionId, entry);
            if (timeoutMs !== undefined && timeoutMs > 0) {
                entry.timeoutTimer = setTimeout(() => {
                    this.cancel(interactionId, new Error("Interaction timed out"));
                }, timeoutMs);
            }
        });
    }

    /**
     * Resolve a pending interaction with the client's response.
     */
    resolve(interactionId: string, value: unknown): boolean { ... }

    /**
     * Reject/cancel a pending interaction (e.g., client disconnected).
     */
    cancel(interactionId: string, error: Error): boolean { ... }

    /**
     * Cancel all pending interactions for a specific connectionId
     * (called when a client disconnects).
     */
    cancelByConnection(connectionId: string, error: Error): void { ... }

    /**
     * Get all pending interactions (for replay to reconnecting clients).
     */
    getPending(): PendingInteractionRequest[] { ... }
}
```

### Modified ClientIO Flow

#### `askYesNo` (Before)

```
Agent code -> askYesNoWithContext() -> context.clientIO.askYesNo()
  -> SharedDispatcher.callback() -> RPC invoke to client
  -> client shows dialog, user clicks
  -> RPC response returns boolean
  -> askYesNo() Promise resolves
  -> Agent code continues
```

#### `askYesNo` (After)

```
Agent code -> askYesNoWithContext() -> context.clientIO.askYesNo()
  -> SharedDispatcher intercepts:
     1. Generate interactionId (UUID)
     2. Log PendingInteractionEntry to DisplayLog
     3. Create deferred Promise via PendingInteractionManager
     4. Fire-and-forget: send "requestInteraction" to client
     5. Return the deferred Promise (server command suspends here)
  -> Client receives requestInteraction notification
  -> Client shows UI, user responds
  -> Client calls respondToInteraction(interactionId, { type: "askYesNo", value: true })
  -> SharedDispatcher routes to PendingInteractionManager.resolve()
  -> Log InteractionResolvedEntry to DisplayLog
  -> Deferred Promise resolves with boolean
  -> Agent code continues
```

The critical point: **the server-side `askYesNo()` still returns a `Promise<boolean>`**, so all existing callers are unaffected. The change is entirely in how that Promise is fulfilled --- instead of a synchronous RPC round-trip, it's a stored deferred that gets resolved asynchronously.

#### `popupQuestion` (Currently Disabled)

`popupQuestion` is special because it has **no `requestId`** parameter --- it's a session-level question, not tied to a specific command. The async pattern naturally supports this:

```
Agent code -> sessionContext.popupQuestion(message, choices)
  -> SharedDispatcher intercepts:
     1. Generate interactionId
     2. Log PendingInteractionEntry (no requestId, source = agent name)
     3. Create deferred Promise
     4. Broadcast "requestInteraction" to ALL connected clients (or route to a designated "primary" client)
     5. First client to respond resolves the Promise
  -> popupQuestion returns the chosen index
```

This replaces the current `throw new Error("Not supported in server mode")`.

### Protocol Changes

#### New ClientIO Call Function

Add to `ClientIOCallFunctions`:

```typescript
export type ClientIOCallFunctions = {
  // ... existing ...

  /**
   * Non-blocking: tells the client there is a pending interaction to answer.
   */
  requestInteraction(interaction: PendingInteractionRequest): void;

  /**
   * Non-blocking: tells the client a pending interaction has been resolved
   * (e.g., by another client or by timeout).
   */
  interactionResolved(interactionId: string, response: unknown): void;
};
```

#### New Dispatcher Method

Add to the `Dispatcher` interface:

```typescript
export interface Dispatcher {
  // ... existing ...
  respondToInteraction(
    interactionId: string,
    response: PendingInteractionResponse,
  ): Promise<void>;
}
```

This mirrors the existing `respondToChoice(choiceId, response)` pattern.

#### New RPC Functions

Add to `DispatcherRpcInvokeFunctions`:

```typescript
respondToInteraction(interactionId: string, response: PendingInteractionResponse): Promise<void>;
```

### SharedDispatcher Changes

The `createSharedDispatcher` function needs the following modifications:

1. **Create a `PendingInteractionManager`** alongside the existing data structures.

2. **Replace the blocking `askYesNo` implementation**:

   ```typescript
   // Before:
   askYesNo: async (requestId, ...args) =>
       callback(requestId, (clientIO) => clientIO.askYesNo(requestId, ...args)),

   // After:
   askYesNo: async (requestId, message, defaultValue) => {
       const interactionId = randomUUID();
       const interaction: PendingInteractionRequest = {
           interactionId, type: "askYesNo", requestId,
           source: "dispatcher", timestamp: Date.now(),
           message, defaultValue,
       };
       log.logPendingInteraction(interaction);
       log.saveQueued();

       const promise = pendingInteractions.create<boolean>(
           interactionId, "askYesNo", requestId, requestId.connectionId,
       );

       // Fire-and-forget to the specific client
       callback(requestId, (clientIO) =>
           clientIO.requestInteraction(interaction));

       return promise;
   },
   ```

3. **Replace the blocking `proposeAction` implementation** (same pattern).

4. **Implement `popupQuestion`** (no longer throws):

   ```typescript
   popupQuestion: async (message, choices, defaultId, source) => {
       const interactionId = randomUUID();
       const interaction: PendingInteractionRequest = {
           interactionId, type: "popupQuestion",
           source, timestamp: Date.now(),
           message, choices, defaultId,
       };
       log.logPendingInteraction(interaction);
       log.saveQueued();

       const promise = pendingInteractions.create<number>(
           interactionId, "popupQuestion", undefined, undefined,
       );

       // Broadcast to all clients (no requestId to route by)
       broadcast("requestInteraction", undefined, (clientIO) =>
           clientIO.requestInteraction(interaction));

       return promise;
   },
   ```

5. **Handle client disconnection**:

   ```typescript
   // In the join() method's close handler:
   const dispatcher = createDispatcherFromContext(
     context,
     connectionId,
     async () => {
       clients.delete(connectionId);
       dispatchers.delete(connectionId);
       unregisterClient(connectionId);
       // Cancel any pending interactions owned by this client
       pendingInteractions.cancelByConnection(
         connectionId,
         new Error("Client disconnected"),
       );
       closeFn();
     },
   );
   ```

6. **Add `respondToInteraction` routing** (exposed via the per-client Dispatcher):
   ```typescript
   // In createDispatcherFromContext or as a method on SharedDispatcher:
   async respondToInteraction(interactionId: string, response: PendingInteractionResponse) {
       const resolved = pendingInteractions.resolve(interactionId, response.value);
       if (resolved) {
           log.logInteractionResolved(interactionId, response.value);
           log.saveQueued();
           // Notify other clients that the interaction is no longer pending
           broadcast("interactionResolved", undefined, (clientIO) =>
               clientIO.interactionResolved(interactionId, response.value));
       }
   }
   ```

### DisplayLog Changes

Add two new logging methods to the `DisplayLog` class:

```typescript
logPendingInteraction(interaction: PendingInteractionRequest): number {
    const seq = this.nextSeq++;
    this.entries.push({
        type: "pending-interaction",
        seq,
        timestamp: Date.now(),
        interactionId: interaction.interactionId,
        interactionType: interaction.type,
        requestId: interaction.requestId,
        source: interaction.source,
        message: interaction.message,
        defaultValue: interaction.defaultValue,
        choices: interaction.choices,
        defaultId: interaction.defaultId,
        actionTemplates: interaction.actionTemplates,
    });
    this.dirty = true;
    return seq;
}

logInteractionResolved(interactionId: string, response: unknown): number {
    const seq = this.nextSeq++;
    this.entries.push({
        type: "interaction-resolved",
        seq,
        timestamp: Date.now(),
        interactionId,
        response,
    });
    this.dirty = true;
    return seq;
}
```

### Replay and Reconnection Strategy

When a client joins a session (via `joinSession`), the server can replay the current state:

1. **Replay display entries**: Already supported via `DisplayLog.getEntries(afterSeq)`.
2. **Replay pending interactions**: The new `pending-interaction` entries appear in the display log. The client can identify which interactions are still pending by checking for entries without a corresponding `interaction-resolved` entry, or by querying `PendingInteractionManager.getPending()`.

#### Reconnection Protocol Extension

Add to `JoinSessionResult`:

```typescript
export type JoinSessionResult = {
  connectionId: string;
  sessionId: string;
  name: string;
  pendingInteractions?: PendingInteractionRequest[]; // NEW
};
```

When a client connects, the server includes any unresolved interactions. The client can immediately render UI for them.

#### Reassignment on Reconnect

If the original client disconnects and a new client connects:

1. `cancelByConnection()` marks interactions from the old client as "orphaned" (optionally with a grace period instead of immediate cancellation).
2. On new client join, orphaned interactions can be **reassigned** to the new connection.
3. Alternatively, with the broadcast approach for `requestInteraction`, any connected client can respond --- no reassignment needed.

**Recommended approach**: Use a configurable **grace period** (e.g., 30 seconds) before canceling orphaned interactions. If a new client joins within the grace period, pending interactions are automatically replayed to it.

### Timeout and Cancellation Handling

All three interaction types reject with an error on timeout or client disconnect. This treats a missing response as a cancelled operation uniformly across all types — there is no silent fallback to a default value.

```typescript
// In PendingInteractionManager, on timeout or disconnect:
cancel(interactionId: string, error: Error): boolean {
    const entry = this.pending.get(interactionId);
    if (!entry) return false;
    this.pending.delete(interactionId);
    clearTimeout(entry.timeoutTimer);
    entry.reject(error);
    return true;
}
```

Callers handle the rejection according to their existing cancellation logic — for example, `askYesNoWithContext` callers either throw `"Aborted!"` or display a "Cancelled!" warning and return. Note that `askYesNoWithContext()` uses `defaultValue` only in **batch mode** (no user interaction at all), which is unaffected by this change.

### Batch Mode Compatibility

The existing `askYesNoWithContext()` helper in `context/interactiveIO.ts` already short-circuits in batch mode:

```typescript
export async function askYesNoWithContext(
  context,
  message,
  defaultValue = false,
) {
  return context?.batchMode
    ? defaultValue
    : context.clientIO.askYesNo(getRequestId(context), message, defaultValue);
}
```

This remains unchanged. The async redesign only affects the non-batch path.

---

## Backward Compatibility

### Wire Protocol Versioning

The new `requestInteraction` call function and `respondToInteraction` invoke function are **additive** --- they don't change existing messages. However, we need to handle clients that don't support the new protocol:

1. **Legacy detection**: If a client does not register a handler for `requestInteraction`, the RPC `send()` call will silently be ignored (fire-and-forget semantics).
2. **Fallback behavior**: If no client responds within a configurable timeout, the `PendingInteractionManager` rejects all pending interactions with an error. Callers treat this as a cancelled operation — `askYesNoWithContext` callers either throw `"Aborted!"` or display a cancellation warning, `proposeAction` callers abort the confirmation flow, and `popupQuestion` callers propagate the error.
3. **Gradual migration**: The old blocking invoke functions (`ClientIOInvokeFunctions.askYesNo` etc.) remain in the type definitions for standalone (non-server) use. Only the `SharedDispatcher` implementation changes.

### Standalone Dispatcher (CLI, Electron Shell)

The standalone dispatcher (used by CLI and Electron shell) can continue using the direct blocking pattern. The `ClientIO` interface is unchanged --- only the server-side routing implementation in `SharedDispatcher` changes.

The `nullClientIO` in `context/interactiveIO.ts` remains as-is for testing.

---

## Open Questions

1. **Should `popupQuestion` be broadcast to all clients or routed to a "primary" client?**

   - Broadcast is simpler; first responder wins. But it may confuse users if multiple people see the same dialog.
   - Routing to the client whose agent triggered the question is more precise but requires adding a `requestId` or `connectionId` to the `popupQuestion` signature.
   - **Decision**: Broadcast, with a "first responder wins" resolution. The first client to call `respondToInteraction` resolves the Promise; all other clients receive an `interactionResolved` notification and dismiss their UI. Verify this matches the current implementation; update if not.

2. **What timeout is appropriate for pending interactions?**

   - **Decision**:
     - `askYesNo`: 60 seconds, then reject (caller treats as cancellation).
     - `proposeAction`: 5 minutes (300 seconds), then reject.
     - `popupQuestion`: 60 seconds, then reject.

3. **Should the `requestChoice`/`respondToChoice` mechanism be unified with this new system?**

   - They are architecturally very similar. Unification would reduce code duplication.
   - However, `requestChoice` is part of the `ActionResult` return path and has different semantics (agent-initiated, not system-initiated).
   - **Open**: Leave separate for now; revisit unification in a future iteration.

4. **Grace period vs. immediate cancellation on client disconnect?**
   - Immediate cancellation is simpler but loses the interaction if the client reconnects quickly.
   - A grace period allows seamless reconnection.
   - **Decision**: Configurable grace period, default 30 seconds. If a client reconnects within the grace period, pending interactions are replayed to the new connection. After the grace period expires with no reconnect, all orphaned interactions are cancelled.

---

## Sequence Diagrams

### askYesNo: Normal Flow

```
Client              SharedDispatcher          PendingInteractionMgr     DisplayLog
  |                       |                           |                      |
  |   (command in progress, agent calls askYesNo)     |                      |
  |                       |--- create(id, "askYesNo") -->                    |
  |                       |<-- Promise<boolean> -------|                      |
  |                       |--- logPendingInteraction --------------------->  |
  |<-- requestInteraction-|                           |                      |
  |                       |   (server suspends here)  |                      |
  |   (user clicks Yes)   |                           |                      |
  |-- respondToInteraction -->                        |                      |
  |                       |--- resolve(id, true) ---->|                      |
  |                       |--- logInteractionResolved -------------------->  |
  |                       |   (Promise resolves, command continues)          |
```

### askYesNo: Client Disconnect + Grace Period Expiry

```
Client              SharedDispatcher          PendingInteractionMgr
  |                       |                           |
  |<-- requestInteraction-|                           |
  |                       |                           |
  X  (client disconnects) |                           |
  |                       |--- cancelByConnection --->|
  |                       |   (grace period starts)   |
  |                       |                           |
  |                       |   (30s grace period expires, no reconnect)
  |                       |--- cancel(id, error) ---->|
  |                       |   (Promise rejects, caller handles as cancellation)
```

### popupQuestion: Multi-Client Broadcast

```
ClientA             ClientB           SharedDispatcher          PendingInteractionMgr
  |                   |                     |                           |
  |                   |  (agent calls popupQuestion)                   |
  |<-- requestInteraction ------------------|                          |
  |                   |<-- requestInteraction                          |
  |                   |                     |                           |
  |  (user answers 1) |                     |                           |
  |-- respondToInteraction ---------------->|                           |
  |                   |                     |--- resolve(id, 1) ------>|
  |                   |<-- interactionResolved (id, 1)                 |
  |                   |                     |   (ClientB dismisses UI) |
```
