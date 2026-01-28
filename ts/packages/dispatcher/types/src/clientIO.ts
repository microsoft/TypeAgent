// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DisplayAppendMode,
    DisplayContent,
    TemplateSchema,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { RequestId, RequestMetrics } from "./dispatcher.js";

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
    setDisplayInfo(
        requestId: RequestId,
        source: string,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ): void;
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
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
    ): void;
    notify(
        requestId: RequestId,
        event: "explained",
        data: NotifyExplainedData,
        source: string,
    ): void;

    openLocalView(requestId: RequestId, port: number): Promise<void>;
    closeLocalView(requestId: RequestId, port: number): Promise<void>;

    // Host specific (TODO: Formalize the API)
    takeAction(requestId: RequestId, action: string, data: unknown): void;
}
