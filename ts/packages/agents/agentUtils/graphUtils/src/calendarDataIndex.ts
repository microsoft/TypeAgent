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
    tryCreateEmbeddingModel,
} from "@typeagent/aiclient";

export type EventInfo = {
    eventId: string;
    eventData: string;
};

export interface CalendarDataIndex {
    addOrUpdate(eventData: string): Promise<void>;
    remove(eventId: EventInfo): Promise<void>;
    reset(): Promise<void>;
    search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<number>>[]>;
}

export function createCalendarDataIndex() {
    let eventEmbeddings: Record<string, NormalizedEmbedding> = {};
    // Undefined when no embedding provider is configured (e.g. Copilot /
    // self-host "none" mode). Semantic event lookup is then disabled and
    // search returns no matches instead of failing.
    const embeddingModel: TextEmbeddingModel | undefined =
        tryCreateEmbeddingModel();
    return {
        addOrUpdate,
        remove,
        reset,
        search,
    };

    async function addOrUpdate(eventInfo: EventInfo) {
        if (embeddingModel === undefined) {
            return;
        }
        const embedding = await generateEmbedding(
            embeddingModel,
            String(eventInfo.eventData),
        );
        eventEmbeddings[eventInfo.eventId] = embedding;
    }

    async function remove(eventId: string): Promise<void> {
        if (eventEmbeddings[eventId]) {
            delete eventEmbeddings[eventId];
        }
    }

    async function reset() {
        eventEmbeddings = {};
    }

    async function search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]> {
        if (embeddingModel === undefined) {
            return [];
        }
        const embeddings = Object.values(eventEmbeddings);
        const eventIds = Object.keys(eventEmbeddings);

        const embedding = await generateEmbedding(embeddingModel, query);
        const topN = indexesOfNearest(
            embeddings,
            embedding,
            maxMatches,
            SimilarityType.Dot,
        );

        return topN.map((m: { item: { toString: () => any }; score: any }) => {
            const itemIndex = Number(m.item);
            return {
                score: m.score,
                item: {
                    name: m.item.toString(),
                    value: eventIds[itemIndex],
                },
            };
        });
    }
}
