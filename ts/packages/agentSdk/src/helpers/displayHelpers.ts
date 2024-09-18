// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "../agentInterface.js";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayMessageKind,
} from "../display.js";

function gatherMessages(callback: (log: (message?: string) => void) => void) {
    const messages: (string | undefined)[] = [];
    callback((message?: string) => {
        messages.push(message);
    });

    return messages.join("\n");
}

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
