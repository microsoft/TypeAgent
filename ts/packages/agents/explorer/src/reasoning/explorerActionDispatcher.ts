// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentManifest, DisplayContent } from "@typeagent/agent-sdk";
import {
    awaitCommand,
    createDispatcher,
    type AppAgentProvider,
    type ClientIO,
    type IAgentMessage,
    type RequestId,
} from "agent-dispatcher";
import { randomUUID } from "node:crypto";
import {
    EXPLORER_AGENT_NAME,
    ExplorerActionSession,
    getExplorerActionSchema,
    instantiate,
} from "../actionHandler.js";

export interface ExplorerActionDispatcher {
    discoverActions(schemaName: string): Promise<string>;
    executeAction(
        schemaName: string,
        actionName: string,
        parameters: Record<string, unknown>,
    ): Promise<{ text: string; isError: boolean; submitted: boolean }>;
    close(): Promise<void>;
}

export async function createExplorerActionDispatcher(
    session: ExplorerActionSession,
): Promise<ExplorerActionDispatcher> {
    const messages = new Map<string, IAgentMessage[]>();
    const dispatcher = await createDispatcher("typeagent-explorer", {
        appAgentProviders: [createSessionProvider()],
        agents: {
            schemas: [EXPLORER_AGENT_NAME],
            actions: [EXPLORER_AGENT_NAME],
            commands: false,
        },
        translation: { enabled: false },
        explainer: { enabled: false },
        cache: { enabled: false },
        enableActionSchemaSemanticMap: false,
        agentInitOptions: {
            [EXPLORER_AGENT_NAME]: { session },
        },
        clientIO: createClientIO(messages),
        collectCommandResult: true,
        dblogging: false,
        conversationMemorySettings: {
            requestKnowledgeExtraction: false,
            actionResultEntityStorage: false,
            actionResultKnowledgeExtraction: false,
        },
    });
    let unusable = false;
    let closePromise: Promise<void> | undefined;

    return {
        async discoverActions(schemaName) {
            requireOpen();
            requireExplorerSchema(schemaName);
            const schemas = await dispatcher.getAgentSchemas(schemaName);
            const schema = schemas
                .flatMap((agent) => agent.subSchemas)
                .find((candidate) => candidate.schemaName === schemaName);
            if (!schema?.schemaText) {
                throw new Error(
                    `TypeAgent returned no action schema for ${schemaName}`,
                );
            }
            return schema.schemaText;
        },
        async executeAction(schemaName, actionName, parameters) {
            requireOpen();
            requireExplorerSchema(schemaName);
            if (!/^[$A-Z_a-z][$\w]*$/u.test(actionName)) {
                return {
                    text: `Invalid Explorer action name: ${actionName}`,
                    isError: true,
                    submitted: false,
                };
            }
            const requestId = randomUUID();
            messages.set(requestId, []);
            try {
                const json = JSON.stringify(parameters).replaceAll(
                    "'",
                    "\\u0027",
                );
                const result = await awaitCommand(
                    dispatcher,
                    `@action ${schemaName} ${actionName} --parameters '${json}'`,
                    undefined,
                    { noReasoning: true },
                    undefined,
                    requestId,
                );
                if (result?.lastError) {
                    return {
                        text: result.lastError,
                        isError: true,
                        submitted: false,
                    };
                }
                const text = (messages.get(requestId) ?? [])
                    .filter((message) => message.source === schemaName)
                    .map((message) => displayContentToText(message.message))
                    .filter(Boolean)
                    .join("\n");
                return text
                    ? {
                          text,
                          isError: false,
                          submitted: session.snapshot().submitted,
                      }
                    : {
                          text: `Explorer action ${actionName} returned no result`,
                          isError: true,
                          submitted: false,
                      };
            } finally {
                messages.delete(requestId);
            }
        },
        async close() {
            unusable = true;
            if (!closePromise) {
                closePromise = dispatcher.close().catch((error) => {
                    closePromise = undefined;
                    throw error;
                });
            }
            await closePromise;
        },
    };

    function requireOpen(): void {
        if (unusable) {
            throw new Error("Explorer action dispatcher is closing or closed");
        }
    }
}

function createSessionProvider(): AppAgentProvider {
    const manifest: AppAgentManifest = {
        emojiChar: "🔎",
        description: "Read-only repository exploration",
        defaultEnabled: true,
        schema: {
            description:
                "Run bounded read-only Code Mode programs and submit repository-grounded locations.",
            schemaType: "ExplorerActions",
            schemaFile: {
                format: "ts",
                content: getExplorerActionSchema(),
            },
            cached: false,
        },
    };
    return {
        getAppAgentNames: () => [EXPLORER_AGENT_NAME],
        getAppAgentManifest: async (appAgentName) => {
            requireExplorerSchema(appAgentName);
            return manifest;
        },
        loadAppAgent: async (appAgentName) => {
            requireExplorerSchema(appAgentName);
            return instantiate();
        },
        unloadAppAgent: async (appAgentName) => {
            requireExplorerSchema(appAgentName);
        },
    };
}

function createClientIO(messages: Map<string, IAgentMessage[]>): ClientIO {
    const capture = (message: IAgentMessage): void => {
        messages.get(message.requestId.requestId)?.push(message);
    };
    return {
        clear: () => undefined,
        exit: () => {
            throw new Error("Explorer dispatcher cannot exit its host");
        },
        shutdown: () => {
            throw new Error("Explorer dispatcher cannot shut down its host");
        },
        setUserRequest: () => undefined,
        setDisplayInfo: () => undefined,
        setDisplay: capture,
        appendDisplay: capture,
        appendDiagnosticData: () => undefined,
        setDynamicDisplay: () => undefined,
        question: async (
            _requestId: RequestId | undefined,
            _message: string,
            _choices: string[],
            defaultId?: number,
        ) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: () => undefined,
        openLocalView: async () => undefined,
        closeLocalView: async () => undefined,
        requestChoice: () => undefined,
        requestInteraction: () => undefined,
        interactionResolved: () => undefined,
        interactionCancelled: () => undefined,
        takeAction: (_requestId, action) => {
            throw new Error(`Explorer dispatcher action ${action} is disabled`);
        },
    };
}

function requireExplorerSchema(schemaName: string): void {
    if (schemaName !== EXPLORER_AGENT_NAME) {
        throw new Error(`Unknown action schema: ${schemaName}`);
    }
}

function displayContentToText(content: DisplayContent): string {
    const value =
        typeof content === "object" && !Array.isArray(content)
            ? content.content
            : content;
    if (typeof value === "string") {
        return value;
    }
    if (value.length === 0) {
        return "";
    }
    return Array.isArray(value[0])
        ? (value as string[][]).map((row) => row.join("\t")).join("\n")
        : (value as string[]).join("\n");
}
