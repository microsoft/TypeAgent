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
} from "@typeagent/agent-sdk";
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
    takeAction(action: string): void;
}

// Dispatcher request specific IO

export interface RequestIO {
    type: "html" | "text";
    context: CommandHandlerContext | undefined;
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
    isInputEnabled(): boolean;
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
    takeAction(action: string): void;
}

let lastAppendMode: DisplayAppendMode | undefined;
function displayContent(
    content: DisplayContent,
    appendMode?: DisplayAppendMode,
) {
    let message: string;
    if (typeof content === "string") {
        message = content;
    } else {
        // TODO: should reject html content
        message = content.content;
        switch (content.kind) {
            case "status":
                message = chalk.grey(content.content);
                break;
            case "error":
                message = chalk.red(content.content);
                break;
            case "warning":
                message = chalk.yellow(content.content);
                break;
            case "info":
                message = chalk.grey(content.content);
                break;
            case "success":
                message = chalk.greenBright(content.content);
                break;
            default:
                message = chalk.green(content.content);
                break;
        }
    }

    if (appendMode !== "inline") {
        if (lastAppendMode === "inline") {
            process.stdout.write("\n");
        }
        process.stdout.write(message);
        process.stdout.write("\n");
    } else {
        process.stdout.write(message);
    }

    lastAppendMode = appendMode;
}

export function getConsoleRequestIO(
    stdio: readline.Interface | undefined,
): RequestIO {
    return {
        type: "text",
        context: undefined,
        clear: () => console.clear(),
        setDisplay: (content: DisplayContent) => displayContent(content),

        appendDisplay: (
            content: DisplayContent,
            _actionIndex: number | undefined,
            _source: string,
            mode: DisplayAppendMode,
        ) => displayContent(content, mode),

        isInputEnabled: () => stdio !== undefined,
        askYesNo: async (message: string, defaultValue?: boolean) => {
            return await askYesNo(message, stdio, defaultValue);
        },
        proposeAction: async (
            actionTemplates: TemplateEditConfig,
            source: string,
        ) => {
            // TODO: Not implemented
            return undefined;
        },
        question: async (message: string) => {
            return await stdio?.question(`${message}: `);
        },
        notify: (event: string, requestId: RequestId, data: any) => {
            switch (event) {
                case AppAgentEvent.Error:
                    console.error(chalk.red(data));
                    break;
                case AppAgentEvent.Warning:
                    console.warn(chalk.yellow(data));
                    break;
                case AppAgentEvent.Info:
                    console.info(data);
                    break;
                default:
                // ignored.
            }
        },
        takeAction: (action: string) => {
            return stdio?.write("This command is not supported in the CLI.\n");
        },
    };
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

export function getRequestIO(
    context: CommandHandlerContext | undefined,
    clientIO: ClientIO,
): RequestIO {
    const requestId = context?.requestId;
    return {
        type: "html",
        context: context,
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
                    requestId,
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
                    requestId,
                    source,
                    actionIndex,
                ),
                mode,
            ),

        isInputEnabled: () => true,
        askYesNo: async (message: string, defaultValue?: boolean) =>
            clientIO.askYesNo(message, requestId, defaultValue),
        proposeAction: async (
            actionTemplates: TemplateEditConfig,
            source: string,
        ) => clientIO.proposeAction(actionTemplates, requestId, source),
        question: async (message: string) =>
            clientIO.question(message, requestId),
        notify(
            event: string,
            requestId: RequestId,
            data: any,
            source: string = DispatcherName,
        ) {
            clientIO.notify(event, requestId, data, source);
        },
        takeAction(action: string) {
            clientIO.takeAction(action);
        },
    };
}

export function getNullRequestIO(): RequestIO {
    return {
        type: "text",
        context: undefined,
        clear: () => {},
        setDisplay: () => {},
        appendDisplay: () => {},
        isInputEnabled: () => false,
        askYesNo: async () => false,
        proposeAction: async () => undefined,
        question: async () => undefined,
        notify: () => {},
        takeAction: () => {},
    };
}
