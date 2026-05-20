// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import {
    DispatcherConnectOptions,
    registerClientType,
    unregisterClient,
} from "@typeagent/agent-server-protocol";
import {
    Dispatcher,
    DispatcherOptions,
    ClientIO,
    RequestId,
} from "agent-dispatcher";
import type {
    PendingInteractionRequest,
    PendingInteractionResponse,
    QueueCancelReason,
    QueuedRequest,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";
import { PendingInteractionManager } from "agent-dispatcher/internal";
import { MessageQueue } from "./messageQueue.js";

import registerDebug from "debug";
const debugConnect = registerDebug("agent-server:connect");
const debugClientIOError = registerDebug("agent-server:clientIO:error");
const debugInteraction = registerDebug("agent-server:interaction");
const debugCommand = registerDebug("agent-server:command");

type ClientRecord = {
    clientIO: ClientIO;
    filter: boolean;
};

export async function createSharedDispatcher(
    hostName: string,
    options?: DispatcherOptions,
) {
    if (options?.clientIO !== undefined) {
        throw new Error(
            "SharedDispatcher manages ClientIO internally; do not provide one in options",
        );
    }
    let nextConnectionId = 0;
    const clients = new Map<string, ClientRecord>();
    const pendingInteractions = new PendingInteractionManager();

    // Timeouts for pending interactions. All currently set to 10 minutes but
    // kept separate so they can be tuned independently.
    const INTERACTION_TIMEOUT_MS = {
        question: 10 * 60 * 1000,
        proposeAction: 10 * 60 * 1000,
    };

    // Returns the number of clients the message was sent to.
    const broadcast = (
        name: string,
        requestId: RequestId | undefined,
        fn: (clientIO: ClientIO) => void,
    ): number => {
        let count = 0;
        for (const [connectionId, clientRecord] of clients) {
            if (
                clientRecord.filter &&
                requestId?.connectionId !== connectionId
            ) {
                continue;
            }
            try {
                fn(clientRecord.clientIO);
                count++;
            } catch (error) {
                // Ignore errors in server mode.
                debugClientIOError(
                    `ClientIO error on ${name} for client ${connectionId}: ${error}`,
                );
            }
        }
        return count;
    };

    const callback = <T>(
        requestId: RequestId,
        fn: (clientIO: ClientIO) => T,
    ) => {
        const connectionId = requestId.connectionId;
        if (connectionId === undefined) {
            throw new Error(
                "Cannot perform async call without a connectionId in the requestId",
            );
        }
        const record = clients.get(connectionId);
        if (record === undefined) {
            throw new Error(
                `ClientIO not found for connectionId ${connectionId}`,
            );
        }
        return fn(record.clientIO);
    };

    // Create a routing ClientIO that forwards calls to the current request's client
    // Wraps all methods to catch "Agent channel disconnected" errors gracefully
    const clientIO: ClientIO = {
        clear: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.clear(requestId, ...args),
            ),
        exit: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.exit(requestId, ...args),
            ),
        shutdown: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.shutdown(requestId, ...args),
            ),
        setUserRequest: (requestId, ...args) => {
            broadcast("setUserRequest", requestId, (clientIO) =>
                clientIO.setUserRequest(requestId, ...args),
            );
        },
        setDisplayInfo: (requestId, ...args) => {
            broadcast("setDisplayInfo", requestId, (clientIO) =>
                clientIO.setDisplayInfo(requestId, ...args),
            );
        },
        setDisplay: (message) => {
            broadcast("setDisplay", message.requestId, (clientIO) =>
                clientIO.setDisplay(message),
            );
        },
        appendDisplay: (message, ...args) => {
            broadcast("appendDisplay", message.requestId, (clientIO) =>
                clientIO.appendDisplay(message, ...args),
            );
        },
        appendDiagnosticData: (requestId, ...args) => {
            broadcast("appendDiagnosticData", requestId, (clientIO) =>
                clientIO.appendDiagnosticData(requestId, ...args),
            );
        },
        setDynamicDisplay: (requestId, ...args) => {
            broadcast("setDynamicDisplay", requestId, (clientIO) =>
                clientIO.setDynamicDisplay(requestId, ...args),
            );
        },

        // ===== Async deferred pattern for blocking interactions =====
        // Instead of blocking via callback(), we create a deferred promise
        // and broadcast the request to all clients. The first client to
        // respond via respondToInteraction resolves the promise.

        question: async (requestId, message, choices, defaultId?, source?) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "question",
                ...(requestId !== undefined ? { requestId } : {}),
                source: source ?? requestId?.connectionId ?? "unknown",
                timestamp: Date.now(),
                message,
                choices,
                ...(defaultId !== undefined ? { defaultId } : {}),
            };

            debugInteraction(
                `question created: ${interactionId} message="${message}"`,
            );

            // Broadcast to all connected clients
            broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );

            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            return pendingInteractions.create<number>(
                request,
                INTERACTION_TIMEOUT_MS.question,
            );
        },

        proposeAction: async (requestId, actionTemplates, source) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "proposeAction",
                requestId,
                source,
                timestamp: Date.now(),
                actionTemplates,
            };

            debugInteraction(
                `proposeAction created: ${interactionId} source="${source}"`,
            );

            // Log and queue unconditionally so the interaction survives in
            // the DisplayLog and is included in JoinSessionResult.pendingInteractions
            // on the next join.
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );

            return pendingInteractions.create<unknown>(
                request,
                INTERACTION_TIMEOUT_MS.proposeAction,
            );
        },

        notify: (notificationId, ...args) => {
            broadcast(
                "notify",
                typeof notificationId === "string" ? undefined : notificationId,
                (clientIO) => clientIO.notify(notificationId, ...args),
            );
        },
        openLocalView: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.openLocalView(requestId, ...args),
            ),
        closeLocalView: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.closeLocalView(requestId, ...args),
            ),
        requestChoice: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.requestChoice(requestId, ...args),
            ),
        requestInteraction: (interaction) => {
            // Broadcast to all clients
            broadcast("requestInteraction", interaction.requestId, (cio) =>
                cio.requestInteraction(interaction),
            );
        },
        interactionResolved: (interactionId, response) => {
            broadcast("interactionResolved", undefined, (cio) =>
                cio.interactionResolved(interactionId, response),
            );
        },
        interactionCancelled: (interactionId) => {
            broadcast("interactionCancelled", undefined, (cio) =>
                cio.interactionCancelled(interactionId),
            );
        },
        takeAction: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.takeAction(requestId, ...args),
            ),
        onUserFeedback: (entry) => {
            // Fan out the rating change to every connected client (including
            // the originator — the dispatcher relies on the broadcast for its
            // own local UI update too).
            broadcast("onUserFeedback", entry.requestId, (cio) =>
                cio.onUserFeedback?.(entry),
            );
        },
        onUserHide: (entry) => {
            broadcast("onUserHide", entry.requestId, (cio) =>
                cio.onUserHide?.(entry),
            );
        },
    };
    const context = await initializeCommandHandlerContext(hostName, {
        ...options,
        clientIO,
    });

    // Intercept the three display methods on the shared clientIO so that all
    // display traffic is mirrored into the DisplayLog for later replay.
    // We patch context.clientIO (which IS the broadcast `clientIO` object above)
    // rather than the local variable so any future reference through context also
    // sees the patched version.
    {
        const log = context.displayLog;
        const orig = context.clientIO;

        const origSetUserRequest = orig.setUserRequest.bind(orig);
        orig.setUserRequest = (requestId, ...args) => {
            origSetUserRequest(requestId, ...args);
            log.logUserRequest(requestId, args[0]);
            log.saveQueued();
        };

        const origSetDisplay = orig.setDisplay.bind(orig);
        orig.setDisplay = (message) => {
            origSetDisplay(message);
            // Toast and inline kinds are ephemeral (visual notifications, not
            // chat history). Skip logging so they don't replay on reconnect —
            // matches notify's default-not-persisted behavior. Bubble (or
            // absent kind = a normal request response) always logs.
            if (message.kind !== "toast" && message.kind !== "inline") {
                log.logSetDisplay(message);
                log.saveQueued();
            }
        };

        const origAppendDisplay = orig.appendDisplay.bind(orig);
        orig.appendDisplay = (message, mode, ...rest) => {
            origAppendDisplay(message, mode, ...rest);
            // Skip ephemeral output:
            //   - toast/inline kinds (visual-only notifications)
            //   - mode === "temporary" (transient status indicators like
            //     "Executing action ...", reasoning's "Thinking..." stream).
            // Persisting either causes replayed bubbles on reconnect,
            // DisplayLog growth proportional to streaming tokens, and
            // apparent "duplicate" bubbles next to the real reply.
            if (
                message.kind !== "toast" &&
                message.kind !== "inline" &&
                mode !== "temporary"
            ) {
                log.logAppendDisplay(message, mode);
                log.saveQueued();
            }
        };

        const origSetDisplayInfo = orig.setDisplayInfo.bind(orig);
        orig.setDisplayInfo = (
            requestId,
            source,
            actionIndex,
            action,
            ...rest
        ) => {
            origSetDisplayInfo(requestId, source, actionIndex, action, ...rest);
            log.logSetDisplayInfo(requestId, source, actionIndex, action);
            log.saveQueued();
        };

        // Notifications are ephemeral by default — only log when the producer
        // explicitly opts in via options.persist. Agents (e.g. OS-notification
        // forwarding) that should never enter durable history MUST leave the
        // flag unset.
        const origNotify = orig.notify.bind(orig) as (
            ...args: Parameters<ClientIO["notify"]>
        ) => void;
        orig.notify = (
            notificationId: any,
            event: any,
            data: any,
            source: any,
            seq?: any,
            options?: any,
        ) => {
            origNotify(notificationId, event, data, source, seq, options);
            if (options?.persist === true) {
                log.logNotify(notificationId, event, data, source);
                log.saveQueued();
            }
        };
    }

    const dispatchers = new Map<string, Dispatcher>();

    // Bare per-connection dispatcher used by the queue's drain loop when
    // the originator has disconnected — bypasses the per-connection
    // wrappers (DisplayLog commandComplete, etc.) but still produces
    // setUserRequest/setDisplay broadcasts to remaining clients.
    const bareDispatcher = createDispatcherFromContext(context, undefined);

    // ===== Message queue (Phase 1) =====
    // One queue per conversation. Replaces implicit serialization-via-
    // commandLock with an explicit FIFO that broadcasts lifecycle
    // events to every connected client.
    const messageQueue = new MessageQueue(
        (entry: QueuedRequest) => {
            const originator = dispatchers.get(entry.originatorConnectionId);
            return originator ?? bareDispatcher;
        },
        {
            requestQueued: (entry) => {
                broadcast("requestQueued", undefined, (cio) =>
                    cio.requestQueued?.(entry),
                );
            },
            requestStarted: (entry) => {
                broadcast("requestStarted", undefined, (cio) =>
                    cio.requestStarted?.(entry),
                );
            },
            requestCancelled: (requestId, reason) => {
                broadcast("requestCancelled", undefined, (cio) =>
                    cio.requestCancelled?.(requestId, reason),
                );
            },
            queueStateChanged: (snapshot) => {
                broadcast("queueStateChanged", undefined, (cio) =>
                    cio.queueStateChanged?.(snapshot),
                );
            },
        },
    );
    const shared: SharedDispatcher = {
        get clientCount() {
            return clients.size;
        },
        get pendingInteractions() {
            return pendingInteractions;
        },
        join(
            clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ): Dispatcher {
            // TODO: Support a stable clientId in DispatcherConnectOptions so that a
            // reconnecting client can reclaim its old connectionId (or have pending
            // interactions retargeted to its new one).  Currently connectionId is
            // ephemeral: each join() mints a fresh value, so askYesNo/proposeAction
            // interactions created before a disconnect are permanently unroutable to
            // the reconnected client because requestId.connectionId no longer matches
            // and getPendingInteractions() filters them out.  See
            // docs/async-clientio-design.md §Open Questions for the full design note.
            const connectionId = (nextConnectionId++).toString();
            clients.set(connectionId, {
                clientIO,
                filter: options?.filter ?? false,
            });
            // Register client type for per-request routing
            if (options?.clientType) {
                registerClientType(connectionId, options.clientType);
            }
            const dispatcher = createDispatcherFromContext(
                context,
                connectionId,
                async () => {
                    clients.delete(connectionId);
                    dispatchers.delete(connectionId);
                    unregisterClient(connectionId);
                    messageQueue.onClientDisconnect(connectionId);

                    closeFn();
                    debugConnect(
                        `Client disconnected: ${connectionId} (total clients: ${clients.size})`,
                    );
                },
            );
            dispatchers.set(connectionId, dispatcher);
            debugConnect(
                `Client connected: ${connectionId} (total clients: ${clients.size})`,
            );

            // Extend the per-connection dispatcher with respondToInteraction
            // which delegates to the shared PendingInteractionManager
            (dispatcher as any).respondToInteraction = async (
                response: PendingInteractionResponse,
            ): Promise<void> => {
                shared.respondToInteraction(response);
            };

            (dispatcher as any).cancelInteraction = (
                interactionId: string,
            ): void => {
                shared.cancelInteraction(interactionId);
            };

            // Wrap processCommand so each completed request logs a
            // command-result entry into the DisplayLog (carrying its
            // metrics). This lets history replay re-render timing data
            // exactly the way live commandComplete does.
            const origProcessCommand =
                dispatcher.processCommand.bind(dispatcher);
            dispatcher.processCommand = async (
                command: any,
                clientRequestId?: any,
                attachments?: any,
                processOptions?: any,
                requestId?: any,
            ) => {
                const result = await origProcessCommand(
                    command,
                    clientRequestId,
                    attachments,
                    processOptions,
                    requestId,
                );
                try {
                    context.displayLog.logCommandResult(
                        {
                            connectionId,
                            // The actual server-side requestId UUID is
                            // generated inside processCommand and not
                            // exposed to the wrapper, so leave it empty;
                            // consumers correlate via clientRequestId.
                            requestId: "",
                            clientRequestId,
                        },
                        result?.metrics,
                        result?.tokenUsage,
                    );
                    context.displayLog.saveQueued();
                } catch {
                    // best effort
                }
                try {
                    // Notify peer panels (other clients sharing this
                    // session) that the command finished so they can
                    // clear lingering temporary status messages and
                    // apply timing metrics. We deliberately skip the
                    // originator: it already gets the result back via
                    // the resolved processCommand RPC promise, and a
                    // duplicate notify would run completion twice (in
                    // the VS Code webview that produces a stray
                    // "⚠ Cancelled" bubble after the first pass cleared
                    // the request mapping).
                    let sent = 0;
                    for (const [peerId, peerRecord] of clients) {
                        if (peerId === connectionId) continue;
                        if (peerRecord.filter && peerId !== connectionId) {
                            // Filtered clients only receive their own
                            // events; don't leak peer completions.
                            continue;
                        }
                        try {
                            peerRecord.clientIO.notify(
                                {
                                    connectionId,
                                    requestId: "",
                                    clientRequestId,
                                },
                                "commandComplete",
                                { result: result ?? null },
                                "system",
                            );
                            sent++;
                        } catch (e) {
                            debugClientIOError(
                                `commandComplete notify failed for ${peerId}: ${e}`,
                            );
                        }
                    }
                    debugCommand(
                        `commandComplete broadcast: connectionId=${connectionId} clientRequestId=${clientRequestId} sent=${sent} clients=${clients.size}`,
                    );
                } catch (e) {
                    debugCommand(`commandComplete broadcast failed: ${e}`);
                }
                return result;
            };

            // ===== Message-queue integration (Phase 1) =====
            // Save the inner (wrapped) processCommand and replace the
            // public method with one that submits to the queue and
            // awaits completion. Direct callers continue to get
            // Promise<CommandResult> semantics; the queue plus
            // commandLock together preserve the "one in-flight per
            // conversation" invariant.
            const queuedProcessCommand =
                dispatcher.processCommand.bind(dispatcher);
            (dispatcher as any).__queueInnerProcessCommand =
                queuedProcessCommand;
            dispatcher.processCommand = async (
                command: any,
                clientRequestId?: any,
                attachments?: any,
                processOptions?: any,
                requestId?: any,
            ) => {
                // Legacy "fire and await" path: enqueue and wait. If a
                // caller supplied an explicit requestId, honor it by
                // bypassing the queue (used by the queue's own drain
                // loop when it re-enters the wrapped processCommand).
                if (requestId !== undefined) {
                    return queuedProcessCommand(
                        command,
                        clientRequestId,
                        attachments,
                        processOptions,
                        requestId,
                    );
                }
                const submitInput: any = {
                    text: command,
                    originatorConnectionId: connectionId,
                };
                if (attachments !== undefined)
                    submitInput.attachments = attachments;
                if (processOptions !== undefined)
                    submitInput.options = processOptions;
                if (clientRequestId !== undefined)
                    submitInput.clientRequestId = clientRequestId;
                const entry = messageQueue.submit(submitInput);
                return entry.completion;
            };

            dispatcher.submitCommand = async (
                command,
                attachments,
                options,
                clientRequestId,
            ) => {
                const submitInput: any = {
                    text: command,
                    originatorConnectionId: connectionId,
                };
                if (attachments !== undefined)
                    submitInput.attachments = attachments;
                if (options !== undefined) submitInput.options = options;
                if (clientRequestId !== undefined)
                    submitInput.clientRequestId = clientRequestId;
                const entry = messageQueue.submit(submitInput);
                // Don't await completion — submitCommand returns as
                // soon as the entry is queued. The InternalEntry's
                // completion promise is awaited by the legacy
                // processCommand wrapper (above).
                const out: QueuedRequest = {
                    requestId: entry.requestId,
                    originatorConnectionId: entry.originatorConnectionId,
                    text: entry.text,
                    submittedAt: entry.submittedAt,
                    state: entry.state,
                };
                if (entry.clientRequestId !== undefined)
                    out.clientRequestId = entry.clientRequestId;
                if (entry.attachments !== undefined)
                    out.attachments = entry.attachments;
                if (entry.options !== undefined) out.options = entry.options;
                if (entry.startedAt !== undefined)
                    out.startedAt = entry.startedAt;
                if (entry.finishedAt !== undefined)
                    out.finishedAt = entry.finishedAt;
                if (entry.schemaHint !== undefined)
                    out.schemaHint = entry.schemaHint;
                if (entry.activityHint !== undefined)
                    out.activityHint = entry.activityHint;
                if (entry.error !== undefined) out.error = entry.error;
                return out;
            };

            dispatcher.getQueueSnapshot = async () => {
                return messageQueue.getSnapshot();
            };

            // Hook cancellation: a cancel for a queued entry should
            // remove it from the queue (running entries flow through
            // the existing AbortController path unchanged).
            const origCancelCommand = dispatcher.cancelCommand.bind(dispatcher);
            dispatcher.cancelCommand = (rid: string) => {
                if (!messageQueue.cancelQueued(rid, "user")) {
                    origCancelCommand(rid);
                }
            };

            return dispatcher;
        },
        respondToInteraction(response: PendingInteractionResponse): void {
            debugInteraction(
                `respondToInteraction: ${response.interactionId} type=${response.type}`,
            );
            const resolved = pendingInteractions.resolve(
                response.interactionId,
                response.value,
            );
            if (!resolved) {
                debugInteraction(
                    `respondToInteraction: interaction ${response.interactionId} not found (may have expired or been resolved already)`,
                );
            } else {
                // Notify all clients that this interaction was resolved
                broadcast("interactionResolved", undefined, (cio) =>
                    cio.interactionResolved(
                        response.interactionId,
                        response.value,
                    ),
                );

                // Log the resolution
                context.displayLog.logInteractionResolved(
                    response.interactionId,
                    response.value,
                );
                context.displayLog.saveQueued();
            }
        },
        cancelInteraction(interactionId: string): void {
            debugInteraction(`cancelInteraction: ${interactionId}`);
            const cancelled = pendingInteractions.cancel(
                interactionId,
                new Error("Cancelled by client"),
            );
            if (!cancelled) {
                debugInteraction(
                    `cancelInteraction: interaction ${interactionId} not found (may have expired or been resolved already)`,
                );
            } else {
                broadcast("interactionCancelled", undefined, (cio) =>
                    cio.interactionCancelled(interactionId),
                );
                context.displayLog.logInteractionCancelled(interactionId);
                context.displayLog.saveQueued();
            }
        },
        getPendingInteractions(
            connectionId: string,
            filter: boolean,
        ): PendingInteractionRequest[] {
            return pendingInteractions.getPending().filter((r) => {
                const targetConnection = r.requestId?.connectionId;
                if (filter) {
                    // Filtered client: only interactions routed to this connection
                    return targetConnection === connectionId;
                }
                // Unfiltered client: interactions broadcast to all, plus those
                // routed specifically to this connection
                return (
                    targetConnection === undefined ||
                    targetConnection === connectionId
                );
            });
        },
        broadcastSystemMessage(
            message: string,
            excludeConnectionId?: string,
        ): void {
            // "system" is a reserved requestId sentinel used to identify
            // server-broadcast messages (e.g. client join/leave notifications).
            // It can never collide with a real UUID from randomUUID().
            // The renderer (chatView.ts) checks for this sentinel to auto-create
            // a notification MessageGroup — keep these two values in sync.
            const agentMessage = {
                message: {
                    type: "text" as const,
                    content: message,
                    kind: "status" as const,
                },
                requestId: { requestId: "system" },
                source: "system",
            };
            for (const [connectionId, clientRecord] of clients) {
                if (connectionId === excludeConnectionId) {
                    continue;
                }
                try {
                    clientRecord.clientIO.appendDisplay(agentMessage, "block");
                } catch (error) {
                    debugClientIOError(
                        `ClientIO error on broadcastSystemMessage for client ${connectionId}: ${error}`,
                    );
                }
            }
        },
        async leave(connectionId: string) {
            const dispatcher = dispatchers.get(connectionId);
            if (dispatcher) {
                // Remove from clients synchronously so clientCount reflects the
                // post-leave state before any async close work completes.
                // The close callback also calls clients.delete, but that is
                // idempotent so the double-delete is harmless.
                clients.delete(connectionId);
                await dispatcher.close();
            }
        },
        async closeAllClients() {
            const promises: Promise<void>[] = [];
            for (const dispatcher of dispatchers.values()) {
                promises.push(dispatcher.close());
            }
            await Promise.all(promises);
        },
        async close() {
            // Cancel all pending interactions
            pendingInteractions.cancelAll(
                new Error("SharedDispatcher closing"),
            );
            // Drain the message queue so any in-flight or queued
            // entry settles before we tear down the dispatcher.
            try {
                await messageQueue.drainAndStop();
            } catch {
                // best-effort
            }
            await this.closeAllClients();
            await closeCommandHandlerContext(context);
        },
        getQueueSnapshot(): QueueSnapshot {
            return messageQueue.getSnapshot();
        },
        cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
            return messageQueue.cancelQueued(requestId, reason);
        },
    };
    return shared;
}

export type SharedDispatcher = {
    readonly clientCount: number;
    readonly pendingInteractions: PendingInteractionManager;
    join(
        clientIO: ClientIO,
        closeFn: () => void,
        options?: DispatcherConnectOptions,
    ): Dispatcher;
    respondToInteraction(response: PendingInteractionResponse): void;
    cancelInteraction(interactionId: string): void;
    getPendingInteractions(
        connectionId: string,
        filter: boolean,
    ): PendingInteractionRequest[];
    leave(connectionId: string): Promise<void>;
    broadcastSystemMessage(message: string, excludeConnectionId?: string): void;
    closeAllClients(): Promise<void>;
    close(): Promise<void>;
    /** Snapshot of the per-conversation message queue. */
    getQueueSnapshot(): QueueSnapshot;
    /** Cancel a queued (not running) entry by requestId. */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean;
};
