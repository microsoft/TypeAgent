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
    QueuedRequest,
    QueueSnapshot,
    RequestId,
    UserFeedbackCategory,
    UserFeedbackRating,
} from "@typeagent/dispatcher-types";
import type { CompletionDirection } from "@typeagent/agent-sdk";

/**
 * Wire-side variant of `SubmitResult` used by the dispatcher RPC layer.
 *
 * The in-process `SubmitResult.ok:true` carries
 * `completion: Promise<CommandResult | undefined>` — but promises cannot be
 * serialized over RPC. So the server handler returns `WireSubmitResult`
 * (success variant with no `completion`), and the RPC client wrapper
 * synthesizes a fresh `completion` promise wired to `commandComplete` and
 * `requestCancelled` ClientIO push events before handing the result back
 * as the full `SubmitResult` to its caller.
 *
 * This type lives in the RPC layer only — callers of the `Dispatcher`
 * interface never see `WireSubmitResult`; they always see `SubmitResult`
 * with a real completion promise.
 */
export type WireSubmitResult =
    | { ok: true; entry: QueuedRequest }
    | { ok: false; error: "queue_full"; maxDepth: number }
    | { ok: false; error: "server_stopping" };

export type DispatcherInvokeFunctions = {
    submitCommand(
        command: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
        requestId?: string,
    ): Promise<WireSubmitResult>;

    interrupt(
        text: string,
        attachments?: string[],
        options?: ProcessCommandOptions,
        clientRequestId?: unknown,
    ): Promise<WireSubmitResult>;

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
        response: boolean | number[] | { selected: number; remember: boolean },
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
