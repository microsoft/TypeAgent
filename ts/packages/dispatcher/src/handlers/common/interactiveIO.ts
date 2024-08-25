// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { askYesNo } from "../../utils/interactive.js";
import readline from "readline/promises";
import { SearchMenuItem, ActionTemplateSequence, StopWatch } from "common-utils";
import chalk from "chalk";
import { CommandHandlerContext } from "./commandHandlerContext.js";

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

export type SearchMenuContext = {
    state: SearchMenuState;
    menuId: string;
    lastPrefix: string;
    choices?: string[];
};

export interface IAgentMessage {
    message: string;
    requestId: string | undefined;
    source: string;
    actionIndex?: number | undefined;
    groupId?: string | undefined;
    metrics?: IMessageMetrics;
}

export interface IMessageMetrics {
    duration: number | undefined;
    marks?: Map<string, number> | undefined;
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
    setActionStatus(message: IAgentMessage): void;
    updateActionStatus(message: string, groupId: string): void;
    askYesNo(
        message: string,
        requestId: RequestId,
        defaultValue?: boolean,
    ): Promise<boolean>;
    question(
        message: string,
        requestId: RequestId,
    ): Promise<string | undefined>;
    notify(event: string, requestId: RequestId, data: any): void;
    notify(
        event: "explained",
        requestId: RequestId,
        data: {
            time: string;
            fromCache: boolean;
            fromUser: boolean;
        },
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
    getRequestId(): RequestId;
    clear(): void;
    info(message: string | LogFn): void;
    status(message: string | LogFn): void;
    success(message: string | LogFn): void;
    warn(message: string | LogFn): void;
    error(message: string | LogFn): void;
    result(message: string | LogFn): void;

    // Action status
    setActionStatus(
        message: string,
        actionIndex: number,
        source: string,
        groupId?: string,
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
        data: {
            time: string;
            fromCache: boolean;
            fromUser: boolean;
        },
    ): void;
    notify(event: "randomCommandSelected", data: { message: string }): void;
}

export function getConsoleRequestIO(
    stdio: readline.Interface | undefined,
): RequestIO {
    return {
        type: "text",
        context: undefined,
        getRequestId: () => undefined,
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

        setActionStatus: (status: string) => console.log(chalk.grey(status)),

        isInputEnabled: () => stdio !== undefined,
        askYesNo: async (message: string, defaultValue?: boolean) => {
            return await askYesNo(message, stdio, defaultValue);
        },
        question: async (message: string) => {
            return await stdio?.question(`${message}: `);
        },
        notify: (event: string, data: any) => {
            // ignored.
        },
    };
}

function makeClientIOMessage(context: CommandHandlerContext | undefined, message: string, requestId: RequestId, source: string, actionIndex?: number, groupId?: string) : IAgentMessage {
    return { message, requestId, source, actionIndex, groupId, metrics: { duration: context?.profiler?.get(requestId)?.elapsedMs } };
}

export function getRequestIO(
    context: CommandHandlerContext | undefined,
    clientIO: ClientIO,
    requestId: RequestId,
    source: string,
): RequestIO {
    return {
        type: "html",
        context: context,
        getRequestId: () => requestId,
        clear: () => clientIO.clear(),
        info: (input: string | LogFn) =>
            clientIO.info(makeClientIOMessage(context, getMessage(input), requestId, source)),
        status: (input: string | LogFn) =>
            clientIO.status(makeClientIOMessage(context, chalk.grey(getMessage(input)), requestId, source)),
        success: (input: string | LogFn) =>
            clientIO.success(makeClientIOMessage(context, chalk.green(getMessage(input)), requestId, source)),
        warn: (input: string | LogFn) =>
            clientIO.warn(makeClientIOMessage(context, chalk.yellow(getMessage(input)), requestId, source)),
        error: (input: string | LogFn) =>
            clientIO.error(makeClientIOMessage(context, chalk.red(getMessage(input)), requestId, source)),
        result: (input: string | LogFn) =>
            clientIO.result(makeClientIOMessage(context, getMessage(input), requestId, source)),

        setActionStatus: (
            status: string,
            actionIndex: number,
            source: string,
            groupId?: string,
        ) =>
            clientIO.setActionStatus(
                makeClientIOMessage(
                    context,
                    status,
                    requestId,
                    source,
                    actionIndex,
                    groupId,
                )
            ),

        isInputEnabled: () => true,
        askYesNo: async (message: string, defaultValue?: boolean) =>
            clientIO.askYesNo(message, requestId, defaultValue),
        question: async (message: string) =>
            clientIO.question(message, requestId),
        notify(event: string, data: any) {
            clientIO.notify(event, requestId, data);
        },
    };
}

export function getNullRequestIO(): RequestIO {
    return {
        type: "text",
        context: undefined,
        getRequestId: () => undefined,
        clear: () => {},
        info: () => {},
        status: () => {},
        success: () => {},
        warn: () => {},
        error: () => {},
        result: () => {},
        setActionStatus: () => {},
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
