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
        askYesNo: 10 * 60 * 1000,
        proposeAction: 10 * 60 * 1000,
        popupQuestion: 10 * 60 * 1000,
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

        askYesNo: async (requestId, message, defaultValue?) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "askYesNo",
                requestId,
                source: requestId.connectionId ?? "unknown",
                timestamp: Date.now(),
                message,
            };
            if (defaultValue !== undefined) {
                request.defaultValue = defaultValue;
            }

            debugInteraction(
                `askYesNo created: ${interactionId} message="${message}"`,
            );

            // Broadcast to all connected clients
            const notified = broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );
            if (notified === 0) {
                // No clients to handle it — resolve immediately without logging
                // a pending entry (which would have no corresponding resolution).
                return defaultValue ?? false;
            }

            // Log only after we know at least one client was notified
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            return pendingInteractions.create<boolean>(
                request,
                requestId.connectionId,
                INTERACTION_TIMEOUT_MS.askYesNo,
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

            const notified = broadcast("requestInteraction", requestId, (cio) =>
                cio.requestInteraction(request),
            );
            if (notified === 0) {
                throw new Error(
                    "No connected clients available for proposeAction",
                );
            }

            // Log only after we know at least one client was notified
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            return pendingInteractions.create<unknown>(
                request,
                requestId.connectionId,
                INTERACTION_TIMEOUT_MS.proposeAction,
            );
        },

        popupQuestion: async (message, choices, defaultId, source) => {
            const interactionId = randomUUID();
            const request: PendingInteractionRequest = {
                interactionId,
                type: "popupQuestion",
                source,
                timestamp: Date.now(),
                message,
                choices,
            };
            if (defaultId !== undefined) {
                request.defaultId = defaultId;
            }

            debugInteraction(
                `popupQuestion created: ${interactionId} message="${message}"`,
            );

            // popupQuestion has no requestId, so broadcast to all
            const notified = broadcast("requestInteraction", undefined, (cio) =>
                cio.requestInteraction(request),
            );
            if (notified === 0) {
                throw new Error(
                    "No connected clients available for popupQuestion",
                );
            }

            // Log only after we know at least one client was notified
            context.displayLog.logPendingInteraction(request);
            context.displayLog.saveQueued();

            return pendingInteractions.create<number>(
                request,
                undefined, // no specific connection
                INTERACTION_TIMEOUT_MS.popupQuestion,
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

                    // Cancel any pending interactions for this connection
                    // and notify all remaining clients so they can dismiss stale prompts.
                    const cancelled = pendingInteractions.cancelByConnection(
                        connectionId,
                        new Error("Client disconnected"),
                    );
                    for (const interactionId of cancelled) {
                        broadcast("interactionCancelled", undefined, (cio) =>
                            cio.interactionCancelled(interactionId),
                        );
                        context.displayLog.logInteractionCancelled(
                            interactionId,
                        );
                    }
                    if (cancelled.length > 0) {
                        context.displayLog.saveQueued();
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
        async leave(connectionId: string) {
            const dispatcher = dispatchers.get(connectionId);
            if (dispatcher) {
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
    getPendingInteractions(
        connectionId: string,
        filter: boolean,
    ): PendingInteractionRequest[];
    leave(connectionId: string): Promise<void>;
    closeAllClients(): Promise<void>;
    close(): Promise<void>;
};
