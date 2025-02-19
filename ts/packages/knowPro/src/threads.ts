// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRange } from "./dataFormat.js";
import {
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

/**
 * A Thread is a set of text ranges in a conversation
 */
export type Thread = {
    description: string;
    ranges: TextRange[];
};

export type ThreadIndex = number;

export type ScoredThreadIndex = {
    threadIndex: ThreadIndex;
    score: number;
};

export interface IThreadDescriptionIndexFuzzy {
    addThread(
        description: string,
        threadIndex: ThreadIndex | ScoredThreadIndex,
    ): Promise<void>;
    lookupThread(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[] | undefined>;
}

export class ThreadDescriptionEmbeddingIndex
    implements IThreadDescriptionIndexFuzzy
{
    private threads: ScoredThreadIndex[];
    private embeddingIndex: TextEmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.threads = [];
        this.embeddingIndex = new TextEmbeddingIndex(settings);
    }

    public async addThread(
        description: string,
        threadIndex: ThreadIndex | ScoredThreadIndex,
    ): Promise<void> {
        if (typeof threadIndex === "number") {
            threadIndex = {
                threadIndex: threadIndex,
                score: 1,
            };
        }
        await this.embeddingIndex.addText(description);
        this.threads.push(threadIndex);
    }

    public async lookupThread(
        text: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[]> {
        const matches = await this.embeddingIndex.getIndexesOfNearest(
            text,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return { threadIndex: m.item, score: m.score };
        });
    }

    public removeThread(threadIndex: ThreadIndex) {
        const indexOf = this.threads.findIndex(
            (t) => t.threadIndex === threadIndex,
        );
        if (indexOf >= 0) {
            this.threads.splice(indexOf, 1);
            this.embeddingIndex.removeAt(indexOf);
        }
    }
}
