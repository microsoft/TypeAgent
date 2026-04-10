// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayAppendMode,
    DisplayContent,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { RequestId, RequestMetrics } from "./dispatcher.js";
import type { PendingInteractionRequest } from "./pendingInteraction.js";

export type TemplateData = {
    schema: TemplateSchema;
    data: unknown;
};

export type TemplateEditConfig = {
    templateAgentName: string;
    templateName: string;
    templateData: TemplateData | TemplateData[];
    defaultTemplate: TemplateSchema;
    preface?: string;
    editPreface?: string;
    completion?: boolean;
};

export interface IAgentMessage {
    message: DisplayContent;
    requestId: RequestId;
    source: string;
    sourceIcon?: string | undefined;
    actionIndex?: number | undefined;
    metrics?: RequestMetrics | undefined;
}

export type NotifyExplainedData = {
    error?: string | undefined;
    fromCache: "construction" | "grammar" | false;
    fromUser: boolean;
    time: string;
};

// Client provided IO
export interface ClientIO {
    clear(requestId: RequestId): void;
    exit(requestId: RequestId): void;

    // Display
    setUserRequest(requestId: RequestId, command: string, seq?: number): void;
    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
        seq?: number,
    ): void;
    setDisplay(message: IAgentMessage, seq?: number): void;
    appendDisplay(
        message: IAgentMessage,
        mode: DisplayAppendMode,
        seq?: number,
    ): void;
    appendDiagnosticData(requestId: RequestId, data: any): void;
    setDynamicDisplay(
        requestId: RequestId,
        source: string,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;

    // Input
    askYesNo(
        requestId: RequestId,
        message: string,
        defaultValue?: boolean,
    ): Promise<boolean>;
    proposeAction(
        requestId: RequestId,
        actionTemplates: TemplateEditConfig,
        source: string,
    ): Promise<unknown>;

    // A question outside of the request
    popupQuestion(
        message: string,
        choices: string[],
        defaultId: number | undefined,
        source: string,
    ): Promise<number>;

    // Notification (TODO: turn these in to dispatcher events)
    notify(
        notificationId: string | RequestId | undefined,
        event: string,
        data: any,
        source: string,
        seq?: number,
    ): void;
    notify(
        requestId: RequestId,
        event: "explained",
        data: NotifyExplainedData,
        source: string,
        seq?: number,
    ): void;

    openLocalView(requestId: RequestId, port: number): Promise<void>;
    closeLocalView(requestId: RequestId, port: number): Promise<void>;

    // Non-blocking choice request (yes/no buttons or multi-select checkboxes)
    requestChoice(
        requestId: RequestId,
        choiceId: string,
        type: "yesNo" | "multiChoice",
        message: string,
        choices: string[],
        source: string,
    ): void;

    // Non-blocking interaction requests (async deferred pattern)
    requestInteraction(interaction: PendingInteractionRequest): void;
    interactionResolved(interactionId: string, response: unknown): void;
    interactionCancelled(interactionId: string): void;

    // Host specific (TODO: Formalize the API)
    takeAction(requestId: RequestId, action: string, data: unknown): void;
}
