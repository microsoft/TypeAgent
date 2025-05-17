// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TemplateEditConfig } from "../translation/actionTemplate.js";
import {
    CommandHandlerContext,
    getCommandResult,
} from "./commandHandlerContext.js";
import {
    DisplayContent,
    DisplayAppendMode,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { RequestMetrics } from "../utils/metrics.js";

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
        source: string,
    ): Promise<string>;

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

export function makeClientIOMessage(
    context: CommandHandlerContext,
    message: DisplayContent,
    requestId: RequestId,
    source: string,
    actionIndex?: number,
): IAgentMessage {
    if (
        typeof message === "object" &&
        !Array.isArray(message) &&
        message.kind === "error"
    ) {
        const commandResult = getCommandResult(context);
        if (commandResult !== undefined) {
            commandResult.hasError = true;
        }
    }

    return {
        message,
        requestId,
        source,
        actionIndex,
        metrics:
            requestId !== undefined
                ? context.metricsManager?.getMetrics(requestId)
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
    setDisplayInfo: () => {},
    setDisplay: () => {},
    appendDisplay: () => {},
    appendDiagnosticData: () => {},
    setDynamicDisplay: () => {},
    askYesNo: async (
        message: string,
        requestId: RequestId,
        defaultValue: boolean = false,
    ) => defaultValue,
    proposeAction: async () => undefined,
    popupQuestion: async () => {
        throw new Error("popupQuestion not implemented");
    },
    notify: () => {},
    openLocalView: () => {},
    closeLocalView: () => {},
    takeAction: (action: string) => {
        throw new Error(`Action ${action} not supported`);
    },
};
