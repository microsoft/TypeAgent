// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { askYesNo } from "../../utils/interactive.js";
import readline from "readline/promises";
import { SearchMenuItem, ActionTemplateSequence } from "common-utils";
import chalk from "chalk";
import { CommandHandlerContext } from "./commandHandlerContext.js";
import { AppAgentEvent, DisplayContent } from "@typeagent/agent-sdk";
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
    info(message: IAgentMessage): void;
    status(message: IAgentMessage): void;
    success(message: IAgentMessage): void;
    result(message: IAgentMessage): void;
    warn(message: IAgentMessage): void;
    error(message: IAgentMessage): void;
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
    appendDisplay(message: IAgentMessage): void;
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
function getMessage(input: string | LogFn) {
    return typeof input === "function" ? gatherMessages(input) : input;
}

export interface RequestIO {
    type: "html" | "text";
    context: CommandHandlerContext | undefined;
    clear(): void;
    info(message: string | LogFn, source?: string): void;
    status(message: string | LogFn, source?: string): void;
    success(message: string | LogFn, source?: string): void;
    warn(message: string | LogFn, source?: string): void;
    error(message: string | LogFn, source?: string): void;
    result(message: string | LogFn, source?: string): void;

    // Action status
    setDisplay(
        message: DisplayContent,
        actionIndex: number,
        source: string,
    ): void;
    appendDisplay(
        message: DisplayContent,
        actionIndex: number,
        source: string,
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

function displayContentToString(content: DisplayContent): string {
    // TODO: should reject html content
    return typeof content === "string" ? content : content.content;
}

export function getConsoleRequestIO(
    stdio: readline.Interface | undefined,
): RequestIO {
    return {
        type: "text",
        context: undefined,
        clear: () => console.clear(),
        info: (input: string | LogFn) => console.info(getMessage(input)),
        status: (input: string | LogFn) =>
            console.log(chalk.gray(getMessage(input))),
        success: (input: string | LogFn) =>
            console.log(chalk.greenBright(getMessage(input))),
        result: (input: string | LogFn) => console.log(getMessage(input)),
        warn: (input: string | LogFn) =>
            console.warn(chalk.yellow(getMessage(input))),
        error: (input: string | LogFn) =>
            console.error(chalk.red(getMessage(input))),

        setDisplay: (content: DisplayContent) =>
            console.log(chalk.grey(displayContentToString(content))),
        appendDisplay: (content: DisplayContent) =>
            console.log(chalk.grey(displayContentToString(content))),

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
        info: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.info(
                makeClientIOMessage(
                    context,
                    getMessage(input),
                    requestId,
                    source,
                ),
            ),
        status: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.status(
                makeClientIOMessage(
                    context,
                    chalk.grey(getMessage(input)),
                    requestId,
                    source,
                ),
            ),
        success: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.success(
                makeClientIOMessage(
                    context,
                    chalk.green(getMessage(input)),
                    requestId,
                    source,
                ),
            ),
        warn: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.warn(
                makeClientIOMessage(
                    context,
                    chalk.yellow(getMessage(input)),
                    requestId,
                    source,
                ),
            ),
        error: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.error(
                makeClientIOMessage(
                    context,
                    chalk.red(getMessage(input)),
                    requestId,
                    source,
                ),
            ),
        result: (input: string | LogFn, source: string = DispatcherName) =>
            clientIO.result(
                makeClientIOMessage(
                    context,
                    getMessage(input),
                    requestId,
                    source,
                ),
            ),

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
        ) =>
            clientIO.appendDisplay(
                makeClientIOMessage(
                    context,
                    content,
                    requestId,
                    source,
                    actionIndex,
                ),
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
        info: () => {},
        status: () => {},
        success: () => {},
        warn: () => {},
        error: () => {},
        result: () => {},
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
