// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, test } from "@jest/globals";
import type {
    AppAgent,
    AppAgentManifest,
    ActionResult,
} from "@typeagent/agent-sdk";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import type { AppAgentProvider } from "agent-dispatcher";
import type {
    ClientIO,
    Dispatcher,
    StructuredActionExecutionResult,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import type { DispatcherConnectOptions } from "@typeagent/agent-server-protocol";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createAgentServerConnection } from "@typeagent/agent-server-client";
import type { MacroManager } from "@typeagent/copilot-macros";
import type { ConversationManager } from "../src/conversationManager.js";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import { createSharedDispatcher } from "../src/sharedDispatcher.js";

const manifest: AppAgentManifest = {
    description: "Offline host execution fixture",
    emojiChar: "",
    schema: {
        description: "Host actions",
        schemaType: "Actions",
        schemaFile: {
            format: "ts",
            content: `
                export type Actions = Read | Write;
                type Params = { mode: "plain" | "question" | "choice" };
                type Read = { actionName: "read"; parameters: Params };
                type Write = { actionName: "write"; parameters: Params };
            `,
        },
        actionPolicies: { read: { effects: "read-only" } },
    },
};

function prompt(result: StructuredActionExecutionResult) {
    if (result.status !== "requires_interaction") {
        throw new Error(`Expected interaction, got ${result.status}`);
    }
    return result;
}

async function fixture() {
    let entered = 0;
    let effects = 0;
    const messages: unknown[] = [];
    const choices = new ChoiceManager();
    const complete = (): ActionResult => ({
        entities: [{ name: "item", type: ["Item"], uniqueId: "item-1" }],
        resultEntity: { name: "item", type: ["Item"], uniqueId: "item-1" },
        resultValue: { ids: ["item-1"] },
        historyText: "Done",
        displayContent: { type: "html", content: "<b>Done</b>" },
    });
    const agent: AppAgent = {
        checkReadiness: async () => ({ state: "ready" }),
        cancelChoice: async (id) => {
            choices.cancelChoice(id);
        },
        handleChoice: (id, response, context) =>
            choices.handleChoice(id, response, context),
        executeAction: async (action, context) => {
            entered++;
            if (action.parameters?.mode === "question") {
                await context.sessionContext.popupQuestion(
                    "Allow?",
                    ["Yes", "No"],
                    0,
                );
            } else if (action.parameters?.mode === "choice") {
                return {
                    entities: [],
                    pendingChoice: {
                        type: "yesNo",
                        message: "Continue?",
                        choiceId: choices.registerChoice(async (response) => {
                            if (response === true) effects++;
                            return complete();
                        }),
                    },
                };
            }
            effects++;
            return complete();
        },
    };
    const provider: AppAgentProvider = {
        getAppAgentNames: () => ["hostTest"],
        getAppAgentManifest: async () => manifest,
        loadAppAgent: async () => agent,
        unloadAppAgent: async () => {},
    };
    const shared = await createSharedDispatcher("structured-host-test", {
        agents: { schemas: ["hostTest"], actions: ["hostTest"] },
        appAgentProviders: [provider],
        translation: { enabled: false },
        explainer: { enabled: false },
        cache: { enabled: false },
        collectCommandResult: true,
        metrics: true,
        conversationMemorySettings: {
            requestKnowledgeExtraction: false,
            actionResultEntityStorage: false,
            actionResultKnowledgeExtraction: false,
        },
    });
    const manager = {
        async resolveConversationId(id?: string) {
            return id ?? "conversation";
        },
        async joinConversation(
            _id: string,
            io: ClientIO,
            close: () => void,
            options?: DispatcherConnectOptions,
        ) {
            const dispatcher = shared.join(io, close, options);
            return {
                dispatcher,
                connectionId: dispatcher.connectionId,
                name: "Test",
                pendingInteractions: shared.getPendingInteractions(
                    dispatcher.connectionId!,
                    true,
                ),
                structuredActions: shared.getStructuredActionBinding(
                    dispatcher.connectionId!,
                ),
            };
        },
        leaveConversation: async (_id: string, connectionId: string) =>
            shared.leave(connectionId),
    } as unknown as ConversationManager;
    const { handler } = createAgentServerConnectionHandler({
        conversationManager: manager,
        macroManager: {} as MacroManager,
        shutdown() {},
        getUserIdentity: () => ({
            username: "test",
            displayName: "Test",
            initial: "T",
        }),
    });
    const io: ClientIO = {
        clear() {},
        exit() {},
        shutdown() {},
        setUserRequest() {},
        setDisplayInfo() {},
        setDisplay: (message) => messages.push(message),
        appendDisplay: (message) => messages.push(message),
        appendDiagnosticData: (_request, data) => messages.push(data),
        setDynamicDisplay() {},
        question: async () => {
            throw new Error("Structured question leaked");
        },
        proposeAction: async () => {
            throw new Error("Structured proposal leaked");
        },
        notify() {},
        openLocalView: async () => {},
        closeLocalView: async () => {},
        requestChoice: (...args) => messages.push(args),
        requestForm: (...args) => messages.push(args),
        requestInteraction: (interaction) => messages.push(interaction),
        interactionResolved() {},
        interactionCancelled() {},
        takeAction() {},
    };
    const closeConnections: (() => Promise<void>)[] = [];
    return {
        shared,
        messages,
        counts: () => ({ entered, effects }),
        async join(structured: { resumeToken?: string } | false = {}) {
            let client: ChannelProviderAdapter | undefined;
            const server = createChannelProviderAdapter(
                "host-test-server",
                (message) => client?.notifyMessage(structuredClone(message)),
            );
            client = createChannelProviderAdapter(
                "host-test-client",
                (message) => server.notifyMessage(structuredClone(message)),
            );
            const clientAdapter = client;
            const disconnect = () => {
                server.notifyDisconnected();
                clientAdapter.notifyDisconnected();
            };
            handler(server, disconnect);
            const connection = createAgentServerConnection(client, disconnect);
            closeConnections.push(() => connection.close());
            const joined = await connection.joinConversation(io, {
                conversationId: "conversation",
                filter: true,
                ...(structured === false
                    ? {}
                    : { structuredActions: structured }),
            });
            return { ...joined, disconnect, connection };
        },
        async close() {
            for (const close of closeConnections) await close();
            await shared.close();
        },
    };
}

async function execute(
    dispatcher: Dispatcher,
    actionName: "write" | "read",
    mode = "plain",
) {
    const found = await dispatcher.getActionContract({
        schemaName: "hostTest",
        actionName,
    });
    if (found.status !== "found") throw new Error("Expected action contract");
    return dispatcher.executeAction({
        protocolVersion: found.protocolVersion,
        scopeId: found.scopeId,
        schemaName: found.contract.schemaName,
        actionName: found.contract.actionName,
        fingerprint: found.contract.fingerprint,
        parameters: { mode },
    });
}

function respond(
    dispatcher: Dispatcher,
    result: StructuredActionExecutionResult,
    response: StructuredActionResponse,
) {
    const interaction = prompt(result);
    return dispatcher.continueAction({
        protocolVersion: interaction.protocolVersion,
        scopeId: interaction.scopeId,
        operationId: interaction.operationId,
        interactionId: interaction.interactionId,
        response,
    });
}

describe("real structured shared host and dispatcher RPC", () => {
    test("resumes confirmation after takeover, preserving actual values and private prompts", async () => {
        const host = await fixture();
        try {
            const first = await host.join();
            const pending = prompt(await execute(first.dispatcher, "write"));
            expect(host.counts()).toEqual({ entered: 0, effects: 0 });
            if (first.structuredActions === undefined)
                throw new Error("Expected binding");
            const second = await host.join(first.structuredActions);
            const stale = await respond(first.dispatcher, pending, {
                type: "confirmation",
                approved: true,
            });
            expect(stale.status).not.toBe("completed");
            expect(host.counts().effects).toBe(0);
            const completed = await respond(second.dispatcher, pending, {
                type: "confirmation",
                approved: true,
            });
            expect(completed.status).toBe("completed");
            expect(completed.results[0].result).toMatchObject({
                resultValue: { ids: ["item-1"] },
                resultEntity: { uniqueId: "item-1" },
            });
            expect(host.counts()).toEqual({ entered: 1, effects: 1 });
            expect(host.shared.pendingInteractions.size).toBe(0);
            const broadcast = JSON.stringify(host.messages);
            expect(broadcast).not.toContain(pending.interactionId);
            expect(broadcast).not.toContain(
                first.structuredActions?.resumeToken,
            );
        } finally {
            await host.close();
        }
    });

    test.each(["question", "choice"])(
        "resumes the actual %s callback after the originator disconnects",
        async (mode) => {
            const host = await fixture();
            try {
                const first = await host.join();
                const pending = prompt(
                    await execute(first.dispatcher, "read", mode),
                );
                if (first.structuredActions === undefined)
                    throw new Error("Expected binding");
                first.disconnect();
                const second = await host.join(first.structuredActions);
                const completed = await respond(
                    second.dispatcher,
                    pending,
                    mode === "question"
                        ? { type: "question", selected: 0 }
                        : { type: "yesNo", value: true },
                );
                expect(completed.status).toBe("completed");
                expect(host.counts()).toEqual({ entered: 1, effects: 1 });
                const repeated = await respond(
                    second.dispatcher,
                    pending,
                    mode === "question"
                        ? { type: "question", selected: 0 }
                        : { type: "yesNo", value: true },
                );
                expect(repeated).toEqual(completed);
                expect(host.counts().effects).toBe(1);
            } finally {
                await host.close();
            }
        },
    );

    test("no-client grace cancels a default-affirmative prompt without executing it", async () => {
        const host = await fixture();
        try {
            host.shared.__testSetNoClientsGraceMs(5);
            const first = await host.join();
            const pending = prompt(
                await execute(first.dispatcher, "read", "question"),
            );
            if (first.structuredActions === undefined)
                throw new Error("Expected binding");
            first.disconnect();
            await new Promise((resolve) => setTimeout(resolve, 30));
            const second = await host.join(first.structuredActions);
            const cancelled = await respond(second.dispatcher, pending, {
                type: "question",
                selected: 0,
            });
            expect(cancelled.status).toBe("execution_uncertain");
            expect(host.counts()).toEqual({ entered: 1, effects: 0 });
            expect(host.shared.getQueueSnapshot().running).toBeNull();
        } finally {
            await host.close();
        }
    });

    test("legacy new-command supersession unblocks structured work without answering", async () => {
        const host = await fixture();
        try {
            const owner = await host.join();
            const pending = prompt(
                await execute(owner.dispatcher, "read", "question"),
            );
            const submission = await owner.dispatcher.submitCommand("@help");
            if (!submission.ok)
                throw new Error("Expected queued legacy command");
            await submission.entry.completion;
            const cancelled = await respond(owner.dispatcher, pending, {
                type: "question",
                selected: 0,
            });
            expect(cancelled.status).toBe("execution_uncertain");
            expect(host.counts().effects).toBe(0);
            expect(host.shared.getQueueSnapshot().running).toBeNull();
        } finally {
            await host.close();
        }
    });

    test("non-opt-in clients can discover but cannot execute", async () => {
        const host = await fixture();
        try {
            const legacy = await host.join(false);
            expect(legacy.structuredActions).toBeUndefined();
            const denied = await execute(legacy.dispatcher, "read");
            expect(denied.status).toBe("unavailable");
            expect(host.counts()).toEqual({ entered: 0, effects: 0 });
        } finally {
            await host.close();
        }
    });

    test("a different logical owner cannot consume or cancel a confirmation", async () => {
        const host = await fixture();
        try {
            const owner = await host.join();
            const pending = prompt(await execute(owner.dispatcher, "write"));
            const outsider = await host.join();
            expect(
                (
                    await respond(outsider.dispatcher, pending, {
                        type: "confirmation",
                        approved: true,
                    })
                ).status,
            ).not.toBe("completed");
            expect(
                (
                    await outsider.dispatcher.cancelAction({
                        protocolVersion: pending.protocolVersion,
                        scopeId: pending.scopeId,
                        operationId: pending.operationId,
                    })
                ).status,
            ).toBe("failed");
            expect(host.counts()).toEqual({ entered: 0, effects: 0 });
            expect(
                (
                    await respond(owner.dispatcher, pending, {
                        type: "confirmation",
                        approved: true,
                    })
                ).status,
            ).toBe("completed");
            expect(host.counts()).toEqual({ entered: 1, effects: 1 });
        } finally {
            await host.close();
        }
    });
});
