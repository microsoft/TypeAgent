// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createWebSocketChannelServer } from "websocket-channel-server";
import { createDispatcherRpcServer } from "@typeagent/dispatcher-rpc/dispatcher/server";
import { createSharedDispatcher } from "./sharedDispatcher.js";
import { getInstanceDir, getTraceId } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getIndexingServiceRegistry,
    getDefaultConstructionProvider,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";
import { createClientIORpcClient } from "@typeagent/dispatcher-rpc/clientio/client";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AgentServerInvokeFunctions,
    ChannelName,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-protocol";
import dotenv from "dotenv";
const envPath = new URL("../../../../.env", import.meta.url);
dotenv.config({ path: envPath });

async function main() {
    const instanceDir = getInstanceDir();

    // did the launch request a specific config? (e.g. "test" to load "config.test.json")
    const configName = process.argv[process.argv.indexOf("--config") + 1] || undefined;

    // Create single shared dispatcher with routing ClientIO
    const sharedDispatcher = await createSharedDispatcher("agent server", {
        appAgentProviders: getDefaultAppAgentProviders(instanceDir, configName),
        persistSession: true,
        persistDir: instanceDir,
        storageProvider: getFsStorageProvider(),
        metrics: true,
        dblogging: false,
        traceId: getTraceId(),
        indexingServiceRegistry: await getIndexingServiceRegistry(instanceDir, configName),
        constructionProvider: getDefaultConstructionProvider(),
        conversationMemorySettings: {
            requestKnowledgeExtraction: false,
            actionResultKnowledgeExtraction: false,
        },
        collectCommandResult: true,
    });

    await createWebSocketChannelServer(
        { port: 8999 },
        (channelProvider, closeFn) => {
            const invokeFunctions: AgentServerInvokeFunctions = {
                join: async (options?: DispatcherConnectOptions) => {
                    const dispatcherChannel = channelProvider.createChannel(
                        ChannelName.Dispatcher,
                    );
                    const clientIOChannel = channelProvider.createChannel(
                        ChannelName.ClientIO,
                    );
                    const clientIORpcClient =
                        createClientIORpcClient(clientIOChannel);

                    const dispatcher = sharedDispatcher.join(
                        clientIORpcClient,
                        closeFn,
                        options,
                    );
                    channelProvider.on("disconnect", () => {
                        dispatcher.close();
                    });
                    createDispatcherRpcServer(dispatcher, dispatcherChannel);
                    return dispatcher.connectionId!;
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
