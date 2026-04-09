// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import type {
    AgentSchemaInfo,
    CommandCompletionResult,
    CommandResult,
    DisplayLogEntry,
    DispatcherStatus,
    ProcessCommandOptions,
    PendingInteractionResponse,
} from "@typeagent/dispatcher-types";
import type { CompletionDirection } from "@typeagent/agent-sdk";

export type DispatcherInvokeFunctions = {
    processCommand(
        command: string,
        clientRequestId?: unknown,
        attachments?: string[],
        options?: ProcessCommandOptions,
    ): Promise<CommandResult | undefined>;

    getDynamicDisplay(
        appAgentName: string,
        type: DisplayType,
        id: string,
    ): Promise<DynamicDisplay>;
    getTemplateSchema(
        templateAgentName: string,
        templateName: string,
        data: unknown,
    ): Promise<TemplateSchema>;

    getTemplateCompletion(
        templateAgentName: string,
        templateName: string,
        data: unknown,
        propertyName: string,
    ): Promise<string[] | undefined>;

    getCommandCompletion(
        prefix: string,
        direction: CompletionDirection,
    ): Promise<CommandCompletionResult>;

    checkCache(request: string): Promise<CommandResult | undefined>;

    close(): Promise<void>;

    getStatus(): Promise<DispatcherStatus>;

    getAgentSchemas(agentName?: string): Promise<AgentSchemaInfo[]>;

    respondToChoice(
        choiceId: string,
        response: boolean | number[],
    ): Promise<CommandResult | undefined>;

    getDisplayHistory(afterSeq?: number): Promise<DisplayLogEntry[]>;

    respondToInteraction(response: PendingInteractionResponse): Promise<void>;
};

export type DispatcherCallFunctions = {
    cancelCommand(requestId: string): void;
};
