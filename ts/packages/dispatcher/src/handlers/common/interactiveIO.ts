// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { askYesNo } from "../../utils/interactive.js";
import readline from "readline/promises";
import { SearchMenuItem, ActionTemplateSequence } from "common-utils";
import chalk from "chalk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import {
    ActionContext,
    AppAgentEvent,
    DisplayContent,
    DisplayAppendMode,
    DisplayMessageKind,
} from "@typeagent/agent-sdk";
import { RequestMetrics } from "../../utils/metrics.js";

export const DispatcherName = "dispatcher";
export type RequestId = string | undefined;

export type SearchMenuCommand =
    | "register"
    | "legend"
    | "complete"
    | "cancel"
    | "show"
    | "remove";

export type ActionUICommand = "register" | "replace" | "remove";

export type SearchMenuState = "active" | "inactive";

export enum NotifyCommands {
    ShowSummary = "summarize",
    Clear = "clear",
    ShowUnread = "unread",
    ShowAll = "all",
}

export type SearchMenuContext = {
    state: SearchMenuState;
    menuId: string;
    lastPrefix: string;
    choices?: string[];
};

export interface IAgentMessage {
    message: DisplayContent;
    requestId?: string | undefined;
    source: string;
    actionIndex?: number | undefined;
    metrics?: RequestMetrics | undefined;
}

// Client provided IO
export interface ClientIO {
    clear(): void;
    actionCommand(
        actionTemplates: ActionTemplateSequence,
        command: ActionUICommand,
        requestId: RequestId,
    ): void;
    searchMenuCommand(
        menuId: string,
        command: SearchMenuCommand,
        prefix?: string,
        choices?: SearchMenuItem[],
        visible?: boolean,
    ): void;
    setDisplay(message: IAgentMessage): void;
    appendDisplay(message: IAgentMessage, mode: DisplayAppendMode): void;
    askYesNo(
        message: string,
        requestId: RequestId,
        defaultValue?: boolean,
    ): Promise<boolean>;
    question(
        message: string,
        requestId: RequestId,
    ): Promise<string | undefined>;
    notify(
        event: string,
        requestId: RequestId,
        data: any,
        source: string,
    ): void;
    notify(
        event: "explained",
        requestId: RequestId,
        data: {
            time: string;
            fromCache: boolean;
            fromUser: boolean;
        },
        source: string,
    ): void;
    setDynamicDisplay(
        source: string,
        requestId: RequestId,
        actionIndex: number,
        displayId: string,
        nextRefreshMs: number,
    ): void;
    exit(): void;
}

// Dispatcher request specific IO

type LogFn = (log: (message?: string) => void) => void;
function getMessage(
    input: string | string[] | LogFn,
    kind?: DisplayMessageKind,
): DisplayContent {
    const content =
        typeof input === "function"
            ? gatherMessages(input)
            : Array.isArray(input)
              ? input.join("\n")
              : input;
    return kind ? { type: "text", content, kind } : content;
}

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

    // returns undefined if input is disabled
    question(
        message: string,
        searchMenuId?: string,
    ): Promise<string | undefined>;
    notify(
        event: "explained",
        requestId: RequestId,
        data: {
            time: string;
            fromCache: boolean;
            fromUser: boolean;
        },
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
        question: async () => undefined,
        notify: () => {},
    };
}

export function gatherMessages(
    callback: (log: (message?: string) => void) => void,
) {
    const messages: (string | undefined)[] = [];
    callback((message?: string) => {
        messages.push(message);
    });

    return messages.join("\n");
}

export async function gatherMessagesAsync(
    callback: (log: (message?: string) => void) => Promise<void>,
) {
    const messages: (string | undefined)[] = [];
    await callback((message?: string) => {
        messages.push(message);
    });

    return messages.join("\n");
}

function displayMessage(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
    kind?: DisplayMessageKind,
    appendMode: DisplayAppendMode = "block",
) {
    context.actionIO.appendDisplay(getMessage(message, kind), appendMode);
}

export async function displayInfo(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "info");
}

export async function displayStatus(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "status", "temporary");
}

export async function displayWarn(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "warning");
}

export async function displayError(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "error");
}

export async function displaySuccess(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "success");
}

export async function displayResult(
    message: string | string[] | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context);
}
