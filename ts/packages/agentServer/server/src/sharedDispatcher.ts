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
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
    prewarmReasoning as prewarmDispatcherReasoning,
} from "agent-dispatcher/internal";
import { PendingInteractionManager } from "agent-dispatcher/internal";

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

    // Grace period before the queue cancels its contents after the last client
    // disconnects. Tunable per-test via `__testSetNoClientsGraceMs`.
    let noClientsGraceMs = 30 * 1000;

    // Returns the number of clients the message was sent to.
    const broadcast = (
        name: string,
        requestId: RequestId | undefined,
        fn: (clientIO: ClientIO) => void,
        options?: { skipOriginator?: boolean },
    ): number => {
        let count = 0;
        for (const [connectionId, clientRecord] of clients) {
            if (
                clientRecord.filter &&
                requestId?.connectionId !== connectionId
            ) {
                continue;
            }
            if (
                options?.skipOriginator === true &&
                requestId?.connectionId === connectionId
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
        restart: (requestId, ...args) =>
            callback(requestId, (clientIO) => {
                if (clientIO.restart === undefined) {
                    throw new Error(
                        "The connected host does not support restart.",
                    );
                }
                return clientIO.restart(requestId, ...args);
            }),
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
        // Create a deferred promise and broadcast to all clients; the first
        // client to respondToInteraction resolves it.

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

            // Mark the running entry blocked so the queue snapshot and
            // no-clients grace timer can react.
            const rid = requestId?.requestId;
            if (rid !== undefined)
                context.requestQueue.markBlocked(rid, "interaction");
            try {
                return await pendingInteractions.create<number>(
                    request,
                    INTERACTION_TIMEOUT_MS.question,
                );
            } finally {
                if (rid !== undefined) context.requestQueue.markUnblocked(rid);
            }
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

            // Log + queue unconditionally so the interaction survives in
            // DisplayLog and is included in JoinSessionResult on next join.
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );

            const rid = requestId?.requestId;
            if (rid !== undefined)
                context.requestQueue.markBlocked(rid, "interaction");
            try {
                return await pendingInteractions.create<unknown>(
                    request,
                    INTERACTION_TIMEOUT_MS.proposeAction,
                );
            } finally {
                if (rid !== undefined) context.requestQueue.markUnblocked(rid);
            }
        },

        notify: (notificationId, ...args) => {
            broadcast(
                "notify",
                typeof notificationId === "string" ? undefined : notificationId,
                (clientIO) => clientIO.notify(notificationId, ...args),
            );
        },
        requestQueued: (entry, version) => {
            broadcast("requestQueued", undefined, (cio) =>
                cio.requestQueued?.(entry, version),
            );
        },
        requestStarted: (entry, version) => {
            broadcast("requestStarted", undefined, (cio) =>
                cio.requestStarted?.(entry, version),
            );
        },
        requestCancelled: (requestId, reason, version) => {
            broadcast("requestCancelled", undefined, (cio) =>
                cio.requestCancelled?.(requestId, reason, version),
            );
        },
        queueStateChanged: (snapshot) => {
            broadcast("queueStateChanged", undefined, (cio) =>
                cio.queueStateChanged?.(snapshot),
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
            // Fan out to every connected client (including the originator —
            // dispatcher relies on the broadcast for its own local UI update).
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

    // Intercept display methods on the shared clientIO to mirror display
    // traffic into the DisplayLog for later replay. Patches context.clientIO
    // (which IS the broadcast `clientIO` above) so future references through
    // context also see the patched version.
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
            // Skip ephemeral toast/inline kinds so they don't replay on reconnect.
            if (message.kind !== "toast" && message.kind !== "inline") {
                log.logSetDisplay(message);
                log.saveQueued();
            }
        };

        const origAppendDisplay = orig.appendDisplay.bind(orig);
        orig.appendDisplay = (message, mode, ...rest) => {
            origAppendDisplay(message, mode, ...rest);
            // Skip ephemeral output: toast/inline kinds and mode === "temporary"
            // (transient status like "Thinking..."). Persisting causes replayed
            // duplicate bubbles and DisplayLog bloat proportional to stream tokens.
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
        // explicitly opts in via options.persist.
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

    // No-clients grace timer: when the last client disconnects, give a brief
    // window for reconnect before cancelling in-flight/queued entries that
    // would otherwise stall forever (e.g. blocked on a clientIO interaction).
    let noClientsGraceTimer: NodeJS.Timeout | undefined;
    const cancelNoClientsGraceTimer = () => {
        if (noClientsGraceTimer !== undefined) {
            clearTimeout(noClientsGraceTimer);
            noClientsGraceTimer = undefined;
        }
    };

    const shared: SharedDispatcher = {
        get clientCount() {
            return clients.size;
        },
        get pendingInteractions() {
            return pendingInteractions;
        },
        prewarmReasoning() {
            prewarmDispatcherReasoning(context);
        },
        join(
            clientIO: ClientIO,
            closeFn: () => void,
            options?: DispatcherConnectOptions,
        ): Dispatcher {
            // TODO: Support a stable clientId so a reconnecting client can
            // reclaim its old connectionId. Currently connectionId is ephemeral,
            // so interactions created before disconnect are unroutable after
            // reconnect. See docs/async-clientio-design.md §Open Questions.
            const connectionId = (nextConnectionId++).toString();
            const wasEmpty = clients.size === 0;
            clients.set(connectionId, {
                clientIO,
                filter: options?.filter ?? false,
            });
            // First (re)joining client — clear any pending grace timer.
            if (wasEmpty) {
                cancelNoClientsGraceTimer();
            }
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
                    // Last client gone — start grace timer. On expiry cancel
                    // queued entries and any running entry blocked on a
                    // clientIO interaction (which would otherwise stall
                    // forever waiting for a non-existent client).
                    if (clients.size === 0) {
                        cancelNoClientsGraceTimer();
                        noClientsGraceTimer = setTimeout(() => {
                            noClientsGraceTimer = undefined;
                            const snap = context.requestQueue.getSnapshot();
                            for (const queued of snap.queued) {
                                context.requestQueue.cancelQueued(
                                    queued.requestId,
                                    "no_clients",
                                );
                            }
                            const head = snap.running;
                            if (head && head.blockedOn === "interaction") {
                                const rid = head.requestId;
                                // Cancel pending interactions for this rid so
                                // the awaiting deferred rejects with AbortError
                                // (which command.ts classifies as cancelled).
                                const abortErr = new Error(
                                    "Cancelled by server: no clients connected",
                                );
                                abortErr.name = "AbortError";
                                try {
                                    for (const pend of pendingInteractions
                                        .getPending()
                                        .filter(
                                            (r) =>
                                                r.requestId?.requestId === rid,
                                        )) {
                                        pendingInteractions.cancel(
                                            pend.interactionId,
                                            abortErr,
                                        );
                                    }
                                } catch (e) {
                                    debugCommand(
                                        `no_clients: failed to cancel pending interactions: ${e}`,
                                    );
                                }
                                context.requestQueue.cancelRunning(
                                    rid,
                                    "no_clients",
                                );
                                const controller =
                                    context.activeRequests.get(rid);
                                controller?.abort();
                            }
                        }, noClientsGraceMs);
                        noClientsGraceTimer.unref?.();
                    }

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
            // "system" is a reserved requestId sentinel for server-broadcast
            // messages. The renderer (chatView.ts) checks for it to auto-create
            // a notification MessageGroup — keep these in sync.
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
                // Remove synchronously so clientCount reflects post-leave state
                // before any async close work completes. The close callback
                // also calls clients.delete; the double-delete is idempotent.
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
            cancelNoClientsGraceTimer();
            pendingInteractions.cancelAll(
                new Error("SharedDispatcher closing"),
            );
            await this.closeAllClients();
            // closeCommandHandlerContext drains the queue before tearing down.
            await closeCommandHandlerContext(context);
        },
        getQueueSnapshot(): QueueSnapshot {
            return context.requestQueue.getSnapshot();
        },
        isQueueIdle(): boolean {
            return context.requestQueue.isIdle();
        },
        cancelQueued(requestId: string, reason: QueueCancelReason): boolean {
            return context.requestQueue.cancelQueued(requestId, reason);
        },
        __testSetNoClientsGraceMs(ms: number): void {
            noClientsGraceMs = ms;
        },
    };
    return shared;
}

export type SharedDispatcher = {
    readonly clientCount: number;
    readonly pendingInteractions: PendingInteractionManager;
    /**
     * Prewarm the configured reasoning engine's CLI in the background.
     * Best-effort and non-blocking. Called by the host AFTER the conversation
     * has finished reloading so reasoning cold-start work (module load + CLI
     * spawn) doesn't slow the initial load.
     */
    prewarmReasoning(): void;
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
    /** True iff the queue has nothing running and nothing queued. */
    isQueueIdle(): boolean;
    /** Cancel a queued (not running) entry by requestId. */
    cancelQueued(requestId: string, reason: QueueCancelReason): boolean;
    /** @internal Test-only: tighten the no-clients grace window. */
    __testSetNoClientsGraceMs(ms: number): void;
};
