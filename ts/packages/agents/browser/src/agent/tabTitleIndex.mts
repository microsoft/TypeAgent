// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    indexesOfNearest,
    NormalizedEmbedding,
    SimilarityType,
    generateEmbedding,
    ScoredItem,
    NameValue,
} from "typeagent";
import { TextEmbeddingModel, openai } from "aiclient";

export interface TabTitleIndex {
    addOrUpdate(title: string, tabId: number): Promise<void>;
    remove(tabId: number): Promise<void>;
    reset(): Promise<void>;
    search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<number>>[]>;
}

export function createTabTitleIndex() {
    let tabEmbeddings: Record<number, NormalizedEmbedding> = {};
    let embeddingModel: TextEmbeddingModel;

    const aiSettings = openai.apiSettingsFromEnv(openai.ModelType.Embedding);

    embeddingModel = openai.createEmbeddingModel(aiSettings);

    return {
        addOrUpdate,
        remove,
        reset,
        search,
    };

    async function addOrUpdate(title: string, tabId: number) {
        if (!title) {
            return;
        }

        const embedding = await generateEmbedding(embeddingModel, title);
        tabEmbeddings[tabId] = embedding;
    }

    async function remove(tabId: number): Promise<void> {
        if (tabEmbeddings[tabId]) {
            delete tabEmbeddings[tabId];
        }
    }

    async function reset() {
        tabEmbeddings = {};
    }

    async function search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<number>>[]> {
        const embeddings = Object.values(tabEmbeddings);
        const tabIds = Object.keys(tabEmbeddings);

        const embedding = await generateEmbedding(embeddingModel, query);
        const topN = indexesOfNearest(
            embeddings,
            embedding,
            maxMatches,
            SimilarityType.Dot,
        );

        return topN.map((m) => {
            const itemIndex = Number(m.item);

            return {
                score: m.score,
                item: {
                    name: m.item.toString(),
                    value: Number(tabIds[itemIndex]),
                },
            };
        });
    }
}
