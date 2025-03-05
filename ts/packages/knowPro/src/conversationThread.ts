// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversationThreads,
    ScoredThreadIndex,
    Thread,
    ThreadIndex,
} from "./interfaces.js";
import {
    deserializeEmbedding,
    serializeEmbedding,
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";

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
