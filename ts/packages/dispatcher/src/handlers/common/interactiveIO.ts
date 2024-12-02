// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { askYesNo } from "../../utils/interactive.js";
import readline from "readline/promises";
import { TemplateEditConfig } from "../../translation/actionTemplate.js";
import chalk from "chalk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    AppAgentEvent,
    DisplayContent,
    DisplayAppendMode,
    MessageContent,
} from "@typeagent/agent-sdk";
import stringWidth from "string-width";
import { RequestMetrics } from "../../utils/metrics.js";

export const DispatcherName = "dispatcher";
export type RequestId = string | undefined;

export enum NotifyCommands {
    ShowSummary = "summarize",
    Clear = "clear",
    ShowUnread = "unread",
    ShowAll = "all",
}

export interface IAgentMessage {
    message: DisplayContent;
    requestId?: string | undefined;
    source: string;
    actionIndex?: number | undefined;
    metrics?: RequestMetrics | undefined;
}

export type NotifyExplainedData = {
    error?: string | undefined;
    fromCache: boolean;
    fromUser: boolean;
    time: string;
};

// Client provided IO
export interface ClientIO {
    clear(): void;
    exit(): void;

    // Display
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
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

    question(
        message: string,
        requestId: RequestId,
    ): Promise<string | undefined>;

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

    // Host specific (TODO: Formalize the API)
    takeAction(action: string, data: unknown): void;
}

// Dispatcher request specific IO

export interface RequestIO {
    type: "html" | "text";
    clear(): void;

    // Action status
    setDisplay(
        message: DisplayContent,
        actionIndex: number | undefined,
        source: string,
    ): void;
    appendDisplay(
        message: DisplayContent,
        actionIndex: number | undefined,
        source: string,
        mode: DisplayAppendMode,
    ): void;

    // Input
    askYesNo(message: string, defaultValue?: boolean): Promise<boolean>;
    proposeAction(
        actionTemplates: TemplateEditConfig,
        source: string,
    ): Promise<unknown>;
    // returns undefined if input is disabled
    question(
        message: string,
        searchMenuId?: string,
    ): Promise<string | undefined>;
    notify(
        event: "explained",
        requestId: RequestId,
        data: NotifyExplainedData,
    ): void;
    notify(
        event: "randomCommandSelected",
        requestId: RequestId,
        data: { message: string },
    ): void;
    notify(
        event: AppAgentEvent,
        requestId: RequestId,
        message: string,
        source?: string,
    ): void;
    notify(
        event: "showNotifications",
        requestId: RequestId,
        filter: NotifyCommands,
    ): void;
    takeAction(action: string, data: unknown): void;
}

function makeClientIOMessage(
    context: CommandHandlerContext | undefined,
    message: DisplayContent,
    requestId: RequestId,
    source: string,
    actionIndex?: number,
): IAgentMessage {
    return {
        message,
        requestId,
        source,
        actionIndex,
        metrics:
            requestId !== undefined
                ? context?.metricsManager?.getMetrics(requestId)
                : undefined,
    };
}

export function createRequestIO(
    context: CommandHandlerContext,
    clientIO: ClientIO,
): RequestIO {
    return {
        type: "html",
        clear: () => clientIO.clear(),
        setDisplay: (
            content: DisplayContent,
            actionIndex: number,
            source: string,
        ) =>
            clientIO.setDisplay(
                makeClientIOMessage(
                    context,
                    content,
                    context.requestId,
                    source,
                    actionIndex,
                ),
            ),
        appendDisplay: (
            content: DisplayContent,
            actionIndex: number,
            source: string,
            mode: DisplayAppendMode,
        ) =>
            clientIO.appendDisplay(
                makeClientIOMessage(
                    context,
                    content,
                    context.requestId,
                    source,
                    actionIndex,
                ),
                mode,
            ),

        askYesNo: async (message: string, defaultValue: boolean = false) =>
            context?.batchMode
                ? defaultValue
                : clientIO.askYesNo(message, context.requestId, defaultValue),

        proposeAction: async (
            actionTemplates: TemplateEditConfig,
            source: string,
        ) => {
            return clientIO.proposeAction(
                actionTemplates,
                context.requestId,
                source,
            );
        },
        question: async (message: string) =>
            context?.batchMode
                ? undefined
                : clientIO.question(message, context.requestId),
        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string = DispatcherName,
        ) {
            clientIO.notify(event, requestId, data, source);
        },
        takeAction(action: string, data: unknown) {
            clientIO.takeAction(action, data);
        },
    };
}

export function getNullRequestIO(): RequestIO {
    return {
        type: "text",
        clear: () => {},
        setDisplay: () => {},
        appendDisplay: () => {},
        askYesNo: async () => false,
        proposeAction: async () => undefined,
        question: async () => undefined,
        notify: () => {},
        takeAction: () => {},
    };
}
