// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import { ArgDef } from "interactive-app";
import {
    conversation,
    ItemIndexingStats,
    SourceTextBlock,
} from "knowledge-processor";
import { asyncArray } from "typeagent";

export async function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getMessages(
    cm: conversation.ConversationManager,
    maxTurns?: number | undefined,
) {
    return maxTurns !== undefined && maxTurns > 0
        ? await asyncArray.toArray(cm.conversation.messages.entries(), maxTurns)
        : cm.conversation.messages.entries();
}

export async function getMessagesAndCount(
    cm: conversation.ConversationManager,
    maxTurns?: number | undefined,
): Promise<[any[] | AsyncIterableIterator<SourceTextBlock>, number]> {
    const items = await getMessages(cm, maxTurns);
    const count = Array.isArray(items)
        ? items.length
        : await cm.conversation.messages.size();
    return [items, count];
}

export function indexingStatsToCsv(
    stats: ItemIndexingStats | ItemIndexingStats[],
): string {
    let csv = "";
    if (Array.isArray(stats)) {
        const hasName = stats.some((v) => v.name !== undefined);
        if (hasName) {
            csv += "Name, ";
        }
        csv +=
            "Time Ms, Char Count, Prompt Tokens, Completion Tokens, Total Tokens\n";
        for (const stat of stats) {
            csv += statsToCsv(stat, hasName) + "\n";
        }
    } else {
        csv = statsToCsv(stats, stats.name !== undefined);
    }
    return csv;

    function statsToCsv(
        stats: ItemIndexingStats,
        includeName: boolean,
    ): string {
        let csv = includeName ? `${stats.name}, ` : "";
        csv += `${stats.timeMs},${stats.charCount},`;
        csv += completionStatsToCsv(stats.tokenStats);
        return csv;
    }
}

export function completionStatsToCsv(stats: openai.CompletionUsageStats) {
    return `${stats.prompt_tokens},${stats.completion_tokens},${stats.total_tokens}`;
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
        description: "Pause for given milliseconds after each iteration",
    };
}

export function argChunkSize(defaultValue?: number | undefined): ArgDef {
    return {
        type: "number",
        defaultValue,
        description: "Text chunk size",
    };
}
