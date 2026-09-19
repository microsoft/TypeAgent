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
import {
    ChoiceManager,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";

describe("agent action context RPC", () => {
    test("cancels a real SDK choice over agent RPC without invoking its callback", async () => {
        let clientProvider: ChannelProviderAdapter;
        let serverProvider: ChannelProviderAdapter;
        clientProvider = createChannelProviderAdapter(
            "choice-client",
            (message, callback) => {
                queueMicrotask(() =>
                    serverProvider.notifyMessage(structuredClone(message)),
                );
                callback?.(null);
            },
        );
        serverProvider = createChannelProviderAdapter(
            "choice-server",
            (message, callback) => {
                queueMicrotask(() =>
                    clientProvider.notifyMessage(structuredClone(message)),
                );
                callback?.(null);
            },
        );
        const choices = new ChoiceManager();
        let invoked = 0;
        const agent: AppAgent = {
            initializeAgentContext: async () => ({}),
            executeAction: async () =>
                createYesNoChoiceResult(choices, "Confirm", async () => {
                    invoked++;
                    return undefined;
                }),
            handleChoice: (id, response, context) =>
                choices.handleChoice(id, response, context),
            cancelChoice: async (id) => {
                choices.cancelChoice(id);
            },
        };
        const server = createAgentRpcServer("choice", agent, serverProvider);
        const client = await createAgentRpcClient(
            "choice",
            clientProvider,
            server.agentInterface,
        );
        try {
            const agentContext = await client.initializeAgentContext?.();
            const sessionContext = {
                agentContext,
                sessionContextId: "choice-session",
            } as SessionContext<unknown>;
            const actionContext = {
                sessionContext,
                isFromReasoningLoop: false,
            } as ActionContext<unknown>;
            const result = await client.executeAction!(
                { schemaName: "choice", actionName: "test" },
                actionContext,
            );
            if (
                result === undefined ||
                result.error !== undefined ||
                result.pendingChoice === undefined
            )
                throw new Error("Expected a pending choice");
            const id = result.pendingChoice.choiceId;
            await client.cancelChoice!(id, sessionContext);
            await expect(
                client.handleChoice!(id, true, actionContext),
            ).rejects.toThrow("Choice not found or expired");
            expect(invoked).toBe(0);
        } finally {
            server.closeFn();
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        }
    });

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
            { channelName: "agent:test:registration-1" },
        );
        const clientAgent = await createAgentRpcClient(
            "test",
            clientProvider,
            server.agentInterface,
            { channelName: "agent:test:registration-1" },
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
