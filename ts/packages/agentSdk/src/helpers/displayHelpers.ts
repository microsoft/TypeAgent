// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "../agentInterface.js";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayMessageKind,
    DisplayType,
    MessageContent,
    TypedDisplayContent,
} from "../display.js";

/**
 * Given a TypedDisplayContent, find the content for a preferred type.
 * Checks alternates first, then falls back to the primary content if it matches.
 * Returns undefined if the preferred type is not available.
 */
export function getContentForType(
    content: TypedDisplayContent,
    preferredType: DisplayType,
): MessageContent | undefined {
    if (content.alternates) {
        for (const alt of content.alternates) {
            if (alt.type === preferredType) {
                return alt.content;
            }
        }
    }
    if (content.type === preferredType) {
        return content.content;
    }
    return undefined;
}

function gatherMessages(callback: (log: (message?: string) => void) => void) {
    const messages: (string | undefined)[] = [];
    callback((message?: string) => {
        messages.push(message);
    });

    return messages.join("\n");
}

type LogFn = (log: (message?: string) => void) => void;
export function getMessage(
    input: MessageContent | LogFn,
    kind?: DisplayMessageKind,
): DisplayContent {
    const content = typeof input === "function" ? gatherMessages(input) : input;
    return kind ? { type: "text", content, kind } : content;
}

function displayMessage(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
    kind?: DisplayMessageKind,
    appendMode: DisplayAppendMode = "block",
) {
    context.actionIO.appendDisplay(getMessage(message, kind), appendMode);
}

export async function displayInfo(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "info");
}

export async function displayStatus(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "status", "temporary");
}

export async function displayWarn(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "warning");
}

export async function displayError(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "error");
}

export async function displaySuccess(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context, "success");
}

/*
 * Displays a message without any adornment.
 */
export async function displayResult(
    message: MessageContent | LogFn,
    context: ActionContext<unknown>,
) {
    displayMessage(message, context);
}
