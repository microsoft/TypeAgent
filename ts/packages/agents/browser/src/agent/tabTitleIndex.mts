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
import {
    TextEmbeddingModel,
    openai,
    isEmbeddingAvailable,
} from "@typeagent/aiclient";

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
    // Undefined when no embedding provider is configured; tab-title fuzzy
    // search is then disabled and returns no matches instead of failing.
    const embeddingModel: TextEmbeddingModel | undefined =
        isEmbeddingAvailable()
            ? openai.createEmbeddingModel(
                  openai.apiSettingsFromEnv(openai.ModelType.Embedding),
              )
            : undefined;

    return {
        addOrUpdate,
        remove,
        reset,
        search,
    };

    async function addOrUpdate(title: string, tabId: number) {
        if (!title || embeddingModel === undefined) {
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
        if (embeddingModel === undefined) {
            return [];
        }
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
