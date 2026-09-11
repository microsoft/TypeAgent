// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Uses the same real Dispatcher context/service as the lower-layer offline
// structured execution tests. Only the agent and connection delivery are fake.
import { randomUUID } from "node:crypto";
import type {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import type { AppAgentProvider } from "agent-dispatcher";
import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
    createDispatcherFromContext,
} from "agent-dispatcher/internal";
import type {
    AgentServerConnection,
    DispatcherConnectOptions,
} from "@typeagent/agent-server-client";
import { createClientIO } from "../src/shared/typeagent-client.js";

export const oddValue = '  ID: α/東京 "quoted" \\ path\n@action --flag\t💡  ';
export const form = {
    message: "Supply every USER answer",
    paged: true,
    fields: [
        {
            id: oddValue,
            kind: "pick" as const,
            prompt: "Which one?",
            choices: ["first", oddValue],
            allowFreeText: true,
        },
        {
            id: "many",
            kind: "multiChoice" as const,
            prompt: "Choose",
            choices: [oddValue, "other"],
        },
        {
            id: "yes",
            kind: "yesNo" as const,
            prompt: "Really?",
            defaultValue: true,
        },
    ],
};
const manifest: AppAgentManifest = {
    description: "Offline MCP structured integration",
    emojiChar: "",
    schema: {
        description: "Selected contracts",
        schemaType: "Actions",
        schemaFile: {
            format: "ts",
            content: `
                export type Actions = Read | Write | Clear | Other;
                type Params = { text: string; ids: string[]; nested: Nested; mode?: string };
                type Nested = { name: string; count: number };
                type Read = { actionName: "read"; parameters: Params };
                type Write = { actionName: "write"; parameters: Params };
                type Clear = { actionName: "clear" };
                type Other = { actionName: "other"; parameters: { unrelated: boolean } };
            `,
        },
        actionPolicies: {
            read: { effects: "read-only" },
            write: { effects: "state-changing" },
        },
    },
};

export async function structuredFixture() {
    let readiness: ReadinessReport = { state: "ready" };
    let effects = 0;
    let handlers = 0;
    let callbacks = 0;
    const submitted: unknown[] = [];
    const joins: DispatcherConnectOptions[] = [];
    const created: string[] = [];
    const choices = new ChoiceManager();
    const disconnects: (() => void)[] = [];
    const owners = new Map<string, { scope: object; conversationId: string }>();
    let rejectResume = false;
    let resumeRejection: string | undefined;
    let failExecute = false;
    let waitForExecution: (() => void) | undefined;
    let releaseExecution: (() => void) | undefined;
    let lastResponse: unknown;
    const complete = (): ActionResult => ({
        displayContent: { type: "html", content: `<b>${oddValue}</b>` },
        historyText: "Real result",
        entities: [{ name: oddValue, type: ["Item"], uniqueId: oddValue }],
        resultEntity: { name: oddValue, type: ["Item"], uniqueId: oddValue },
        resultValue: {
            ids: [oddValue, "", "007"],
            nested: { values: [null, true, { name: oddValue }] },
        },
    });
    const agent: AppAgent = {
        checkReadiness: async () => readiness,
        handleChoice: (id, response, context) =>
            choices.handleChoice(id, response, context),
        cancelChoice: async (id) => {
            choices.cancelChoice(id);
        },
        executeAction: async (action, actionContext) => {
            handlers++;
            submitted.push(structuredClone(action));
            const mode = action.parameters?.mode;
            if (mode === "throw") throw new Error("fixture action failed");
            if (mode === "hold") {
                await new Promise<void>((resolve) => {
                    releaseExecution = resolve;
                    waitForExecution?.();
                });
            }
            if (mode === "question") {
                lastResponse = await actionContext.sessionContext.popupQuestion(
                    oddValue,
                    [oddValue, "No"],
                    0,
                );
            }
            if (mode === "blockingForm") {
                lastResponse = await context.clientIO.askForm!(
                    context.currentRequestId,
                    form,
                    "fixture",
                );
            }
            if (mode === "child") {
                effects++;
                return {
                    ...complete(),
                    additionalActions: [
                        {
                            actionName: "read",
                            parameters: {
                                text: "child",
                                ids: [oddValue],
                                nested: { name: oddValue, count: 1 },
                            },
                        },
                    ],
                };
            }
            if (mode === "choice" || mode === "form") {
                const choiceId = choices.registerChoice(async (response) => {
                    callbacks++;
                    lastResponse = response;
                    effects++;
                    return complete();
                });
                return {
                    entities: [],
                    pendingChoice:
                        mode === "form"
                            ? { type: "form", choiceId, ...form }
                            : {
                                  type: "multiChoice",
                                  choiceId,
                                  message: oddValue,
                                  choices: [oddValue, "second"],
                              },
                };
            }
            effects++;
            return complete();
        },
    };
    const provider: AppAgentProvider = {
        getAppAgentNames: () => ["fixture"],
        getAppAgentManifest: async () => manifest,
        loadAppAgent: async () => agent,
        unloadAppAgent: async () => {},
    };
    const context = await initializeCommandHandlerContext(
        "plugin-structured-test",
        {
            agents: { schemas: ["fixture"], actions: ["fixture"] },
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
            clientIO: createClientIO({}),
        },
    );

    const connect = async (onDisconnect: () => void) => {
        let active = true;
        const disconnect = () => {
            active = false;
            onDisconnect();
        };
        disconnects.push(disconnect);
        const connection: Pick<
            AgentServerConnection,
            | "listConversations"
            | "createConversation"
            | "joinConversation"
            | "close"
        > = {
            listConversations: async () => [],
            createConversation: async (name: string) => {
                created.push(name);
                return {
                    conversationId: randomUUID(),
                    name,
                    clientCount: 0,
                    messageCount: 0,
                    createdAt: new Date().toISOString(),
                };
            },
            joinConversation: async (_io, options) => {
                if (
                    !options?.conversationId ||
                    options.structuredActions === undefined
                ) {
                    throw new Error("Explicit bound join required");
                }
                joins.push(structuredClone(options));
                const token = options.structuredActions.resumeToken;
                let owner = token === undefined ? undefined : owners.get(token);
                if (
                    token !== undefined &&
                    (rejectResume ||
                        !owner ||
                        owner.conversationId !== options.conversationId)
                ) {
                    throw new Error(
                        resumeRejection ??
                            `Invalid private capability ${token}`,
                    );
                }
                if (!owner) {
                    owner = {
                        scope: {},
                        conversationId: options.conversationId,
                    };
                }
                const resumeToken = token ?? randomUUID();
                owners.set(resumeToken, owner);
                const scope = owner.scope;
                const dispatcher = createDispatcherFromContext(
                    context,
                    randomUUID(),
                    undefined,
                    () => ({
                        scope,
                        isActive: () => active,
                        canDiscoverSchema: () => true,
                    }),
                );
                const execute = dispatcher.executeAction.bind(dispatcher);
                dispatcher.executeAction = async (request) => {
                    const value = await execute(request);
                    if (failExecute) {
                        disconnect();
                        throw new Error("Lost effect reply");
                    }
                    return value;
                };
                return {
                    dispatcher,
                    conversationId: options.conversationId,
                    name: "Test",
                    connectionId: randomUUID(),
                    structuredActions: { resumeToken },
                };
            },
            close: async () => disconnect(),
        };
        return connection as AgentServerConnection;
    };
    return {
        connect,
        joins,
        created,
        submitted,
        context,
        get effects() {
            return effects;
        },
        get handlers() {
            return handlers;
        },
        get callbacks() {
            return callbacks;
        },
        get lastResponse() {
            return lastResponse;
        },
        get owners() {
            return owners.size;
        },
        disconnect: () => disconnects.at(-1)!(),
        rejectResume: (message?: string) => {
            rejectResume = true;
            resumeRejection = message;
        },
        loseEffectReply: () => {
            failExecute = true;
        },
        held: () =>
            new Promise<void>((resolve) => {
                waitForExecution = resolve;
            }),
        release: () => releaseExecution?.(),
        unready: async () => {
            readiness = { state: "setup-required", message: "Setup required" };
            await context.agents.refreshReadiness("fixture");
        },
        disable: () => {
            const agents = context.agents as unknown as {
                agents: Map<string, { actions: Set<string> }>;
            };
            agents.agents.get("fixture")!.actions.delete("fixture");
        },
        close: () => closeCommandHandlerContext(context),
    };
}
