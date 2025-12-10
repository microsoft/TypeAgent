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
    requestId?: string | undefined;
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
    clear(): void;
    exit(): void;

    // Display
    setDisplayInfo(
        source: string,
        requestId: RequestId,
        actionIndex?: number,
        action?: TypeAgentAction | string[],
    ): void;
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
    appendDiagnosticData(requestId: RequestId, data: any): void;
    setDynamicDisplay(
        source: string,
        requestId: RequestId,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;

    // Input
    askYesNo(
        message: string,
        requestId: RequestId,
        defaultValue?: boolean,
    ): Promise<boolean>;
    proposeAction(
        actionTemplates: TemplateEditConfig,
        requestId: RequestId,
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
        event: string,
        requestId: RequestId,
        data: any,
        source: string,
    ): void;
    notify(
        event: "explained",
        requestId: RequestId,
        data: NotifyExplainedData,
        source: string,
    ): void;

    openLocalView(port: number): void;
    closeLocalView(port: number): void;

    // Host specific (TODO: Formalize the API)
    takeAction(action: string, data: unknown): void;
}
