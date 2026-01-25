// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Dispatcher,
    DispatcherOptions,
    ClientIO,
    ConnectionId,
} from "agent-dispatcher";
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugConnect = registerDebug("agent-server:connect");
const debugClientIOError = registerDebug("agent-server:clientIO:error");

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
    const clients = new Map<string, ClientIO>();
    const broadcast = (
        name: string,
        fn: (clientIO: ClientIO, connectionId: ConnectionId) => void,
    ) =>
        clients.forEach((client, connectionId) => {
            try {
                fn(client, connectionId);
            } catch (error) {
                // Ignore errors in server mode.
                debugClientIOError(
                    `ClientIO error on ${name} for client ${connectionId}: ${error}`,
                );
            }
        });

    // Create a routing ClientIO that forwards calls to the current request's client
    // Wraps all methods to catch "Agent channel disconnected" errors gracefully
    const clientIO: ClientIO = {
        clear: (...args) => {
            broadcast("clear", (clientIO) => clientIO.clear(...args));
        },
        exit: (...args) => {
            broadcast("exit", (clientIO) => clientIO.exit(...args));
        },
        setDisplayInfo: (...args) => {
            broadcast("setDisplayInfo", (clientIO) =>
                clientIO.setDisplayInfo(...args),
            );
        },
        setDisplay: (...args) => {
            broadcast("setDisplay", (clientIO) => clientIO.setDisplay(...args));
        },
        appendDisplay: (...args) => {
            broadcast("appendDisplay", (clientIO) =>
                clientIO.appendDisplay(...args),
            );
        },
        appendDiagnosticData: (...args) => {
            broadcast("appendDiagnosticData", (clientIO) =>
                clientIO.appendDiagnosticData(...args),
            );
        },
        setDynamicDisplay: (...args) => {
            broadcast("setDynamicDisplay", (clientIO) =>
                clientIO.setDynamicDisplay(...args),
            );
        },
        askYesNo: async () => {
            throw new Error("askYesNo not supported in SharedDispatcher");
        },
        proposeAction: async () => {
            throw new Error("proposeAction not supported in SharedDispatcher");
        },
        popupQuestion: async () => {
            throw new Error("popupQuestion not supported in SharedDispatcher");
        },
        notify: (...args) => {
            broadcast("notify", (clientIO) => clientIO.notify(...args));
        },
        openLocalView: () => {
            throw new Error("openLocalView not supported in SharedDispatcher");
        },
        closeLocalView: () => {
            throw new Error("closeLocalView not supported in SharedDispatcher");
        },
        takeAction: () => {
            throw new Error("takeAction not supported in SharedDispatcher");
        },
    };
    const context = await initializeCommandHandlerContext(hostName, {
        ...options,
        clientIO,
    });
    return {
        join(clientIO: ClientIO, closeFn?: () => void): Dispatcher {
            const connectionId = (nextConnectionId++).toString();
            clients.set(connectionId, clientIO);
            const dispatcher = createDispatcherFromContext(
                context,
                connectionId,
                async () => {
                    clients.delete(connectionId);
                    closeFn?.();
                    debugConnect(
                        `Client disconnected: ${connectionId} (total clients: ${clients.size})`,
                    );
                },
            );
            debugConnect(
                `Client connected: ${connectionId} (total clients: ${clients.size})`,
            );
            return dispatcher;
        },
        async close() {
            await closeCommandHandlerContext(context);
        },
    };
}
