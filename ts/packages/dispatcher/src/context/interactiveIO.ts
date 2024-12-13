// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TemplateEditConfig } from "../translation/actionTemplate.js";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import { DisplayContent, DisplayAppendMode } from "@typeagent/agent-sdk";
import { RequestMetrics } from "../utils/metrics.js";

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

export function makeClientIOMessage(
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

export async function askYesNoWithContext(
    context: CommandHandlerContext,
    message: string,
    defaultValue: boolean = false,
) {
    return context?.batchMode
        ? defaultValue
        : context.clientIO.askYesNo(message, context.requestId, defaultValue);
}

export const nullClientIO: ClientIO = {
    clear: () => {},
    exit: () => process.exit(0),
    setDisplay: () => {},
    appendDisplay: () => {},
    setDynamicDisplay: () => {},
    askYesNo: async (
        message: string,
        requestId: RequestId,
        defaultValue: boolean = false,
    ) => defaultValue,
    proposeAction: async () => undefined,
    notify: () => {},
    takeAction: (action: string) => {
        throw new Error(`Action ${action} not supported`);
    },
};
