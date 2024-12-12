// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai } from "aiclient";
import { readJsonFile, removeFile, writeJsonFile } from "typeagent";

export type ItemIndexingStats = {
    name?: string | undefined;
    timeMs: number;
    charCount: number;
    tokenStats: openai.CompletionUsageStats;
};

export interface IndexingStats {
    totalStats: ItemIndexingStats;
    itemStats: ItemIndexingStats[];
    clear(): void;
    startItem(name?: string): void;
    updateCurrent(timeMs: number, charCount: number): void;
    updateCurrentTokenStats(stats: openai.CompletionUsageStats): void;
}

export function createIndexingStats(
    existingStats?: IndexingStats,
): IndexingStats {
    let current: ItemIndexingStats | undefined;
    const indexingStats: IndexingStats = {
        totalStats: existingStats?.totalStats ?? emptyStats(),
        itemStats: existingStats?.itemStats ?? [],
        startItem,
        updateCurrent,
        updateCurrentTokenStats,
        clear,
    };
    return indexingStats;

    function startItem(name?: string): void {
        current = emptyStats();
        current.name = name;
        indexingStats.itemStats.push(current);
    }

    function updateCurrent(timeMs: number, charCount: number): void {
        const totalStats = indexingStats.totalStats;
        totalStats.timeMs += timeMs;
        totalStats.charCount += charCount;
        if (current) {
            current.timeMs = timeMs;
            current.charCount = charCount;
        }
    }

    function updateCurrentTokenStats(stats: openai.CompletionUsageStats): void {
        const totalStats = indexingStats.totalStats;
        totalStats.tokenStats.completion_tokens += stats.completion_tokens;
        totalStats.tokenStats.prompt_tokens += stats.prompt_tokens;
        totalStats.tokenStats.total_tokens += stats.total_tokens;
        if (current) {
            current.tokenStats.prompt_tokens += stats.prompt_tokens;
            current.tokenStats.completion_tokens += stats.completion_tokens;
            current.tokenStats.total_tokens += stats.total_tokens;
        }
    }

    function clear() {
        indexingStats.totalStats = emptyStats();
        indexingStats.itemStats = [];
    }

    function emptyStats(): ItemIndexingStats {
        return {
            timeMs: 0,
            charCount: 0,
            tokenStats: emptyTokenStats(),
        };
    }

    function emptyTokenStats(): openai.CompletionUsageStats {
        return {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0,
        };
    }
}

/**
 * Load indexing stats from a file
 * @param statsFilePath
 * @param clean
 * @returns
 */
export async function loadIndexingStats(
    statsFilePath: string,
    clean: boolean,
): Promise<IndexingStats> {
    let stats: IndexingStats | undefined;
    if (clean) {
        await removeFile(statsFilePath);
    } else {
        stats = await readJsonFile<IndexingStats>(statsFilePath);
    }
    return createIndexingStats(stats);
}

export async function saveIndexingStats(
    stats: IndexingStats,
    statsFilePath: string,
    clean: boolean,
) {
    if (clean) {
        await removeFile(statsFilePath);
    }
    await writeJsonFile(statsFilePath, stats);
}
