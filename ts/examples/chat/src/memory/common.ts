// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import { ChalkInstance } from "chalk";
import { ArgDef, askYesNo, InteractiveIo } from "interactive-app";
import {
    conversation,
    ItemIndexingStats,
    SourceTextBlock,
} from "knowledge-processor";
import {
    asyncArray,
    ChatUserInterface,
    dateTime,
    getFileName,
} from "typeagent";
import { ChatMemoryPrinter } from "./chatMemoryPrinter.js";
import path from "path";

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

export function addFileNameSuffixToPath(sourcePath: string, suffix: string) {
    return path.join(
        path.dirname(sourcePath),
        getFileName(sourcePath) + suffix,
    );
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

export function argDestFolder(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to destination folder",
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

export function argPause(defaultValue = 0): ArgDef {
    return {
        type: "number",
        defaultValue,
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

export function argToDate(value: string | undefined): Date | undefined {
    return value ? dateTime.stringToDate(value) : undefined;
}

export function addMinutesToDate(date: Date, minutes: number): Date {
    const time = date.getTime();
    const offsetMs = minutes * 60 * 1000;
    return new Date(time + offsetMs);
}

export function createChatUx(
    io: InteractiveIo,
    inputColor?: ChalkInstance | undefined,
): ChatUserInterface {
    return {
        showMessage,
        askYesNo: (q) => askYesNo(io, q),
        getInput,
    };

    async function showMessage(message: string): Promise<void> {
        io.writer.writeLine(message);
    }

    async function getInput(message: string): Promise<string | undefined> {
        if (inputColor) {
            message = inputColor(message);
        }
        return io.readline.question(message + "\n");
    }
}

export function getSearchQuestion(
    result:
        | conversation.SearchTermsActionResponse
        | conversation.SearchTermsActionResponseV2,
): string | undefined {
    if (result.action && result.action.actionName === "getAnswer") {
        const params = result.action.parameters;
        return (params as any).question;
    }
    return undefined;
}

export async function manageConversationAlias(
    cm: conversation.ConversationManager,
    printer: ChatMemoryPrinter,
    name: string | undefined,
    alias: string | undefined,
) {
    const aliases = (await cm.conversation.getEntityIndex()).nameAliases;
    if (name && alias) {
        await aliases.addAlias(alias, name);
    } else if (alias) {
        const names = await aliases.getByAlias(alias);
        if (names) {
            printer.writeLines(names);
        }
    } else {
        for await (const entry of aliases.entries()) {
            printer.writeLine(entry.name);
            printer.writeList(entry.value, { type: "ul" });
        }
    }
}
