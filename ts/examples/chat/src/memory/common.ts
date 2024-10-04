// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ArgDef } from "interactive-app";
import { conversation } from "knowledge-processor";
import { asyncArray } from "typeagent";

export async function getMessages(
    cm: conversation.ConversationManager,
    maxTurns?: number | undefined,
) {
    return maxTurns !== undefined && maxTurns > 0
        ? await asyncArray.toArray(cm.conversation.messages.entries(), maxTurns)
        : cm.conversation.messages.entries();
}

export function argSourceFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to source file",
        type: "path",
        defaultValue,
    };
}

export function argSourceFileOrFolder(
    defaultValue?: string | undefined,
): ArgDef {
    return {
        description: "Path to source file or folder",
        type: "path",
        defaultValue,
    };
}

export function argDestFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to output file",
        type: "string",
        defaultValue,
    };
}

export function argConcurrency(value: number): ArgDef {
    return {
        description: "Concurrency",
        type: "number",
        defaultValue: value,
    };
}

export function argMinScore(value: number): ArgDef {
    return {
        description: "Minimum score",
        type: "number",
        defaultValue: value,
    };
}

export function argUniqueMessage(defaultValue = false): ArgDef {
    return {
        description: "Ensure that this message was not already imported",
        type: "boolean",
        defaultValue,
    };
}

export function argClean(defaultValue = false): ArgDef {
    return {
        description: "Clean",
        type: "boolean",
        defaultValue,
    };
}

export function argPause(): ArgDef {
    return {
        type: "number",
        defaultValue: 0,
        description: "Throttle calls to model",
    };
}
