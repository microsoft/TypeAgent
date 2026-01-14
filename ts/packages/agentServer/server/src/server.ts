// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { ClientIO, createDispatcher, RequestId } from "agent-dispatcher";
import { getInstanceDir, getClientId } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { ChannelProvider } from "@typeagent/agent-rpc/channel";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { createPromiseWithResolvers } from "@typeagent/common-utils";
import {
    AgentServerInvokeFunctions,
    ChannelName,
} from "@typeagent/agent-server-protocol";
import dotenv from "dotenv";
const envPath = new URL("../../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const nullClientIO: ClientIO = {
    clear: () => {},
    exit: () => {},
    setDisplayInfo: () => {},
    setDisplay: () => {},
    appendDisplay: () => {},
    appendDiagnosticData: () => {},
    setDynamicDisplay: () => {},
    askYesNo: async (
        message: string,
        requestId: RequestId,
        defaultValue: boolean = false,
    ) => defaultValue,
    proposeAction: async () => undefined,
    popupQuestion: async () => {
        throw new Error("popupQuestion not implemented");
    },
    notify: () => {},
    openLocalView: () => {},
    closeLocalView: () => {},
    takeAction: (action: string) => {
        throw new Error(`Action ${action} not supported`);
    },
};

async function main() {
    const clientIO = {
        ...nullClientIO,
    };
    const instanceDir = getInstanceDir();

    const dispatcher = await createDispatcher("agent server", {
        appAgentProviders: getDefaultAppAgentProviders(instanceDir),
        persistSession: true,
        persistDir: instanceDir,
        storageProvider: getFsStorageProvider(),
        metrics: true,
        dblogging: true,
        clientId: getClientId(),
        clientIO,
        indexingServiceRegistry: await getIndexingServiceRegistry(instanceDir),
        constructionProvider: getDefaultConstructionProvider(),
    });

    // Ignore dispatcher close requests
    dispatcher.close = async () => {};

    let currentChannelProvider: ChannelProvider | undefined;
    let currentCloseFn: (() => void) | undefined;
    await createWebSocketChannelServer(
        { port: 8999 },
        (channelProvider, closeFn) => {
            const invokeFunctions: AgentServerInvokeFunctions = {
                join: async () => {
                    if (currentChannelProvider !== undefined) {
                        if (channelProvider === currentChannelProvider) {
                            throw new Error("Already joined");
                        }

                        const promiseWithResolvers =
                            createPromiseWithResolvers<void>();
                        currentChannelProvider.on("disconnect", () => {
                            promiseWithResolvers.resolve();
                        });
                        currentCloseFn!();
                        await promiseWithResolvers.promise;
                    }

                    if (currentChannelProvider) {
                        throw new Error("Unable to disconnect");
                    }

                    currentChannelProvider = channelProvider;
                    currentCloseFn = closeFn;
                    channelProvider.on("disconnect", () => {
                        currentChannelProvider = undefined;
                        currentCloseFn = undefined;
                        Object.assign(clientIO, nullClientIO);
                    });

                    const dispatcherChannel = channelProvider.createChannel(
                        ChannelName.Dispatcher,
                    );
                    const clientIOChannel = channelProvider.createChannel(
                        ChannelName.ClientIO,
                    );
                    const clientIORpcClient =
                        createClientIORpcClient(clientIOChannel);
                    Object.assign(clientIO, clientIORpcClient);
                    createDispatcherRpcServer(dispatcher, dispatcherChannel);
                },
            };

            createRpc(
                "agent-server",
                channelProvider.createChannel(ChannelName.AgentServer),
                invokeFunctions,
            );
        },
    );

    console.log("Agent server started at ws://localhost:8999");
}

await main();
