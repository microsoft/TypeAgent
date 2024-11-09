// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import { ArgDef } from "interactive-app";
import { conversation, SourceTextBlock } from "knowledge-processor";
import { asyncArray } from "typeagent";

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

export function argChunkSize(defaultValue?: number | undefined): ArgDef {
    return {
        type: "number",
        defaultValue,
        description: "Text chunk size",
    };
}

export interface IndexingStats {
    totalMs: number;
    totalChars: number;
    tokenStats: openai.CompletionUsageStats;

    clear(): void;
    addTokens(tokens: openai.CompletionUsageStats): void;
}

export function createIndexingStats(): IndexingStats {
    const indexingStats = {
        totalMs: 0,
        totalChars: 0,
        tokenStats: emptyTokenStats(),
        addTokens,
        clear,
    };
    return indexingStats;

    function addTokens(stats: openai.CompletionUsageStats): void {
        indexingStats.tokenStats.completion_tokens += stats.completion_tokens;
        indexingStats.tokenStats.prompt_tokens += stats.prompt_tokens;
        indexingStats.tokenStats.total_tokens += stats.total_tokens;
    }

    function clear() {
        indexingStats.totalMs = 0;
        indexingStats.totalChars = 0;
        indexingStats.tokenStats = emptyTokenStats();
    }

    function emptyTokenStats(): openai.CompletionUsageStats {
        return {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0,
        };
    }
}
