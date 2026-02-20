// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
import {
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";

import registerDebug from "debug";
const debugConnect = registerDebug("agent-server:connect");
const debugClientIOError = registerDebug("agent-server:clientIO:error");

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
    const broadcast = (
        name: string,
        requestId: RequestId | undefined,
        fn: (clientIO: ClientIO) => void,
    ) => {
        for (const [connectionId, clientRecord] of clients) {
            if (
                clientRecord.filter &&
                requestId?.connectionId !== connectionId
            ) {
                continue;
            }
            try {
                fn(clientRecord.clientIO);
            } catch (error) {
                // Ignore errors in server mode.
                debugClientIOError(
                    `ClientIO error on ${name} for client ${connectionId}: ${error}`,
                );
            }
        }
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
        askYesNo: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.askYesNo(requestId, ...args),
            ),
        proposeAction: async (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.proposeAction(requestId, ...args),
            ),

        popupQuestion: async () => {
            throw new Error("Not supported in server mode");
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
        takeAction: (requestId, ...args) =>
            callback(requestId, (clientIO) =>
                clientIO.takeAction(requestId, ...args),
            ),
    };
    const context = await initializeCommandHandlerContext(hostName, {
        ...options,
        clientIO,
    });
    return {
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
                    unregisterClient(connectionId);
                    closeFn();
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
