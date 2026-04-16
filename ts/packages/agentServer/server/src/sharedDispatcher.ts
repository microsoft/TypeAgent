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
} from "@typeagent/dispatcher-types";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";
import { PendingInteractionManager } from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugConnect = registerDebug("agent-server:connect");
const debugClientIOError = registerDebug("agent-server:clientIO:error");
const debugInteraction = registerDebug("agent-server:interaction");

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
            log.logSetDisplay(message);
            log.saveQueued();
        };

        const origAppendDisplay = orig.appendDisplay.bind(orig);
        orig.appendDisplay = (message, mode, ...rest) => {
            origAppendDisplay(message, mode, ...rest);
            log.logAppendDisplay(message, mode);
            log.saveQueued();
        };
    }

    const dispatchers = new Map<string, Dispatcher>();
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
            await this.closeAllClients();
            await closeCommandHandlerContext(context);
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
};
