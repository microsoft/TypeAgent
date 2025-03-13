// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversationThreads,
    ScoredThreadOrdinal,
    Thread,
    ThreadOrdinal,
} from "./interfaces.js";
import {
    deserializeEmbedding,
    serializeEmbedding,
    TextEmbeddingIndex,
    TextEmbeddingIndexSettings,
} from "./fuzzyIndex.js";
import { NormalizedEmbedding } from "typeagent";

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
    ): Promise<ScoredThreadOrdinal[]> {
        const matches = await this.embeddingIndex.getIndexesOfNearest(
            text,
            maxMatches,
            thresholdScore,
        );
        return matches.map((m) => {
            return { threadOrdinal: m.item, score: m.score };
        });
    }

    public removeThread(threadOrdinal: ThreadOrdinal) {
        if (threadOrdinal >= 0) {
            this.threads.splice(threadOrdinal, 1);
            this.embeddingIndex.removeAt(threadOrdinal);
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
                embedding:
                    embeddingIndex.size > 0
                        ? serializeEmbedding(embeddingIndex.get(i))
                        : [],
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
            const embeddings: NormalizedEmbedding[] = [];
            for (let i = 0; i < data.threads.length; ++i) {
                this.threads.push(data.threads[i].thread);
                if (data.threads[i].embedding.length > 0) {
                    const embedding = deserializeEmbedding(
                        data.threads[i].embedding,
                    );
                    embeddings.push(embedding);
                }
            }
            this.embeddingIndex.deserialize(embeddings);
        }
    }
}
