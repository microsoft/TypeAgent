// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextRange } from "./dataFormat.js";
import {
    deserializeEmbedding,
    serializeEmbedding,
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

export interface IConversationThreads {
    readonly threads: Thread[];

    addThread(thread: Thread): Promise<void>;
    lookupThread(
        threadDescription: string,
        maxMatches?: number,
        thresholdScore?: number,
    ): Promise<ScoredThreadIndex[] | undefined>;
    removeThread(threadIndex: ThreadIndex): void;

    serialize(): IConversationThreadData;
    deserialize(data: IConversationThreadData): void;
}

export interface IConversationThreadData {
    threads?: IThreadDataItem[] | undefined;
}

export interface IThreadDataItem {
    thread: Thread;
    embedding: number[];
}

export class ConversationThreads implements IConversationThreads {
    public threads: Thread[];
    public embeddingIndex: TextEmbeddingIndex;

    constructor(public settings: TextEmbeddingIndexSettings) {
        this.threads = [];
        this.embeddingIndex = new TextEmbeddingIndex(settings);
    }

    public async addThread(thread: Thread): Promise<void> {
        this.threads.push(thread);
        await this.embeddingIndex.addText(thread.description);
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
        if (threadIndex >= 0) {
            this.threads.splice(threadIndex, 1);
            this.embeddingIndex.removeAt(threadIndex);
        }
    }

    public clear(): void {
        this.threads = [];
        this.embeddingIndex.clear();
    }

    public async buildIndex(): Promise<void> {
        this.embeddingIndex.clear();
        for (let i = 0; i < this.threads.length; ++i) {
            const thread = this.threads[i];
            await this.embeddingIndex.addText(thread.description);
        }
    }

    public serialize(): IConversationThreadData {
        const threadData: IThreadDataItem[] = [];
        const embeddingIndex = this.embeddingIndex;
        for (let i = 0; i < this.threads.length; ++i) {
            const thread = this.threads[i];
            threadData.push({
                thread,
                embedding: serializeEmbedding(embeddingIndex.get(i)),
            });
        }
        return {
            threads: threadData,
        };
    }

    public deserialize(data: IConversationThreadData): void {
        if (data.threads) {
            this.threads = [];
            this.embeddingIndex.clear();
            for (let i = 0; i < data.threads.length; ++i) {
                this.threads.push(data.threads[i].thread);
                const embedding = deserializeEmbedding(
                    data.threads[i].embedding,
                );
                this.embeddingIndex.add(embedding);
            }
        }
    }
}
