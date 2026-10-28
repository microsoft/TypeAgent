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
    createActionResultFromTextDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";

describe("agent action context RPC", () => {
    test.each([false, true])(
        "closing a context preserves surviving option callbacks (shared options: %s)",
        async (shared) => {
            let clientProvider: ChannelProviderAdapter;
            let serverProvider: ChannelProviderAdapter;
            clientProvider = createChannelProviderAdapter(
                "options-client",
                (message, callback) => {
                    queueMicrotask(() =>
                        serverProvider.notifyMessage(
                            JSON.parse(JSON.stringify(message)),
                        ),
                    );
                    callback?.(null);
                },
            );
            serverProvider = createChannelProviderAdapter(
                "options-server",
                (message, callback) => {
                    queueMicrotask(() =>
                        clientProvider.notifyMessage(
                            JSON.parse(JSON.stringify(message)),
                        ),
                    );
                    callback?.(null);
                },
            );
            const deletedChannels: string[] = [];
            const deleteChannel = clientProvider.deleteChannel;
            clientProvider.deleteChannel = (name) => {
                deletedChannels.push(name);
                deleteChannel(name);
            };
            type Options = { read(): string; fail?: boolean };
            const agent: AppAgent = {
                initializeAgentContext: async (settings) => {
                    const options = settings?.options as Options;
                    if (options.fail) throw new Error("Initialization failed");
                    return options;
                },
                closeAgentContext: async () => {},
                executeAction: async (_, context: ActionContext<Options>) =>
                    createActionResultFromTextDisplay(
                        await context.sessionContext.agentContext.read(),
                    ),
            };
            const server = createAgentRpcServer(
                "retained-options",
                agent,
                serverProvider,
            );
            const client = await createAgentRpcClient(
                "retained-options",
                clientProvider,
                server.agentInterface,
            );
            const first = { read: () => "first" };
            const second = shared ? first : { read: () => "second" };
            let sessionId = 0;
            const initialize = async (options: Options) =>
                ({
                    sessionContextId: `options-${++sessionId}`,
                    agentContext: await client.initializeAgentContext!({
                        options,
                    }),
                }) as SessionContext<unknown>;
            const read = (sessionContext: SessionContext<unknown>) =>
                client.executeAction!(
                    { schemaName: "test", actionName: "read" },
                    { sessionContext } as ActionContext<unknown>,
                );
            try {
                const a = await initialize(first);
                const b = await initialize(second);
                await expect(
                    initialize({ read: () => "", fail: true }),
                ).rejects.toThrow("Initialization failed");
                await client.closeAgentContext!(a);
                expect(deletedChannels).toEqual([]);
                await expect(read(b)).resolves.toMatchObject({
                    displayContent: shared ? "first" : "second",
                });
                await client.closeAgentContext!(b);
                expect(deletedChannels).toContain("options:retained-options");
                const c = await initialize(first);
                await expect(read(c)).resolves.toMatchObject({
                    displayContent: "first",
                });
                await client.closeAgentContext!(c);
            } finally {
                server.closeFn();
                clientProvider.notifyDisconnected();
                serverProvider.notifyDisconnected();
            }
        },
    );

    test("invokes nested initialization option methods with their receiver", async () => {
        let clientProvider: ChannelProviderAdapter;
        let serverProvider: ChannelProviderAdapter;
        clientProvider = createChannelProviderAdapter(
            "options-client",
            (message, callback) => {
                queueMicrotask(() =>
                    serverProvider.notifyMessage(
                        JSON.parse(JSON.stringify(message)),
                    ),
                );
                callback?.(null);
            },
        );
        serverProvider = createChannelProviderAdapter(
            "options-server",
            (message, callback) => {
                queueMicrotask(() =>
                    clientProvider.notifyMessage(
                        JSON.parse(JSON.stringify(message)),
                    ),
                );
                callback?.(null);
            },
        );

        let result: string | undefined;
        const serverAgent: AppAgent = {
            initializeAgentContext: async (settings) => {
                const options = settings?.options as {
                    service: {
                        prefix: string;
                        getValue(value: string): string;
                    };
                };
                result = await options.service.getValue("value");
                return {};
            },
        };
        const server = createAgentRpcServer(
            "nested-options",
            serverAgent,
            serverProvider,
        );
        const client = await createAgentRpcClient(
            "nested-options",
            clientProvider,
            server.agentInterface,
        );

        try {
            await client.initializeAgentContext?.({
                options: {
                    service: {
                        prefix: "nested",
                        getValue(value: string) {
                            return `${this.prefix}:${value}`;
                        },
                    },
                },
            });
            expect(result).toBe("nested:value");
        } finally {
            server.closeFn();
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        }
    });

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

    test("propagates host origin, security approval and session identity across fresh RPC shims", async () => {
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
        const received: SessionContext[] = [];
        const origins: ActionContext["executionOrigin"][] = [];
        const approvals: number[] = [];
        let receivedConversationId: string | undefined;
        const serverAgent: AppAgent = {
            initializeAgentContext: async () => ({}),
            executeAction: async (_action, context) => {
                receivedWorkingDirectory = context.workingDirectory;
                received.push(context.sessionContext);
                origins.push(context.executionOrigin);
                approvals.push(
                    await context.sessionContext.requestSecurityApproval!({
                        message: "Execute?",
                        choices: ["Run", "Cancel"],
                        defaultId: 1,
                    }),
                );
                receivedConversationId = context.sessionContext.conversationId;
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
                conversationId: "owning-conversation",
            } as SessionContext<unknown>;
            sessionContext.requestSecurityApproval = async () => 1;
            const actionContext = {
                sessionContext,
                workingDirectory: "C:\\host-authorized-workspace",
                isFromReasoningLoop: false,
                executionOrigin: "structured",
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
            await clientAgent.executeAction?.(
                { schemaName: "test", actionName: "test" },
                actionContext,
            );
            expect(received[0]).not.toBe(received[1]);
            expect(received.map((s) => s.sessionContextId)).toEqual([
                "rpc-working-directory-test",
                "rpc-working-directory-test",
            ]);
            expect(origins).toEqual(["structured", "structured"]);
            expect(approvals).toEqual([1, 1]);
            delete sessionContext.requestSecurityApproval;
            await expect(
                clientAgent.executeAction!(
                    { schemaName: "test", actionName: "test" },
                    actionContext,
                ),
            ).rejects.toThrow("does not support trusted security approval");
            expect(receivedConversationId).toBe("owning-conversation");
        } finally {
            server.closeFn();
            clientProvider.notifyDisconnected();
            serverProvider.notifyDisconnected();
        }
    });
});
