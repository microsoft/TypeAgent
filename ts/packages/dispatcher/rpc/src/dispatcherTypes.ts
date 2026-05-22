// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DisplayType,
    DynamicDisplay,
    TemplateSchema,
} from "@typeagent/agent-sdk";
import type {
    AgentSchemaInfo,
    CancelResult,
    CommandCompletionResult,
    CommandResult,
    DisplayLogEntry,
    DispatcherStatus,
    ProcessCommandOptions,
    PendingInteractionResponse,
    QueueSnapshot,
    RequestId,
    SubmitResult,
    UserFeedbackCategory,
    UserFeedbackRating,
} from "@typeagent/dispatcher-types";
import type { CompletionDirection } from "@typeagent/agent-sdk";

export type DispatcherInvokeFunctions = {
    processCommand(
        command: string,
        clientRequestId?: unknown,
        attachments?: string[],
        options?: ProcessCommandOptions,
        requestId?: string,
    ): Promise<CommandResult | undefined>;

    submitCommand(
        command: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;

    interrupt(
        text: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<SubmitResult>;

    cancelCommand(requestId: string): Promise<CancelResult>;

    getQueueSnapshot(): Promise<QueueSnapshot>;

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

    recordUserFeedback(
        requestId: RequestId,
        rating: UserFeedbackRating,
        category?: UserFeedbackCategory,
        comment?: string,
        includeContext?: boolean,
    ): Promise<void>;

    recordUserHide(
        requestId: RequestId,
        hidden: boolean,
        target?: "user" | "agent",
        permanent?: boolean,
    ): Promise<void>;

    restoreAllHidden(): Promise<number>;
    flushHidden(): Promise<number>;
};

export type DispatcherCallFunctions = {
    cancelCommandByClientId(clientRequestId: unknown): void;
    cancelInteraction(interactionId: string): void;
};
