// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ActionContext,
    AppAgent,
    SessionContext,
} from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "../src/client.js";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "../src/common.js";
import { createAgentRpcServer } from "../src/server.js";

describe("agent action context RPC", () => {
    test("propagates workingDirectory to the out-of-process agent", async () => {
        let clientProvider: ChannelProviderAdapter;
        let serverProvider: ChannelProviderAdapter;
        clientProvider = createChannelProviderAdapter(
            "test-client",
            (message, callback) => {
                queueMicrotask(() => serverProvider.notifyMessage(message));
                callback?.(null);
            },
        );
        serverProvider = createChannelProviderAdapter(
            "test-server",
            (message, callback) => {
                queueMicrotask(() => clientProvider.notifyMessage(message));
                callback?.(null);
            },
        );

        let receivedWorkingDirectory: string | undefined;
        const serverAgent: AppAgent = {
            initializeAgentContext: async () => ({}),
            executeAction: async (_action, context) => {
                receivedWorkingDirectory = context.workingDirectory;
                return undefined;
            },
        };
        const server = createAgentRpcServer(
            "test",
            serverAgent,
            serverProvider,
        );
        const clientAgent = await createAgentRpcClient(
            "test",
            clientProvider,
            server.agentInterface,
        );

        try {
            const agentContext = await clientAgent.initializeAgentContext?.();
            const sessionContext = {
                agentContext,
                sessionContextId: "rpc-working-directory-test",
            } as SessionContext<unknown>;
            const actionContext = {
                sessionContext,
                workingDirectory: "C:\\host-authorized-workspace",
                isFromReasoningLoop: false,
            } as ActionContext<unknown>;

            await clientAgent.executeAction?.(
                {
                    schemaName: "test",
                    actionName: "test",
                    parameters: {},
                },
                actionContext,
            );

            expect(receivedWorkingDirectory).toBe(
                "C:\\host-authorized-workspace",
            );
        } finally {
            server.closeFn();
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        }
    });
});
