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

export interface VscodeActionsIndex {
    addOrUpdate(actionName: string): Promise<void>;
    remove(actionName: string): Promise<void>;
    reset(): Promise<void>;
    search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<number>>[]>;
}

export function createVscodeActionsIndex() {
    let vscodeActionEmbeddings: Record<string, NormalizedEmbedding> = {};
    let embeddingModel: TextEmbeddingModel;

    embeddingModel = openai.createEmbeddingModel();
    return {
        addOrUpdate,
        remove,
        reset,
        search,
    };

    async function addOrUpdate(
        actionName: string,
        actionData: any,
    ): Promise<Float32Array> {
        const actionString: string = `${actionData.typeName} ${actionData.actionName} ${actionData.comments.join(" ")}`;
        let embedding = await generateEmbedding(
            embeddingModel,
            JSON.stringify(actionString, null, 2),
        );
        vscodeActionEmbeddings[actionName] = embedding;
        return embedding;
    }

    async function remove(actionName: string): Promise<void> {
        if (vscodeActionEmbeddings[actionName]) {
            delete vscodeActionEmbeddings[actionName];
        }
    }

    async function reset() {
        vscodeActionEmbeddings = {};
    }

    async function search(
        query: string | NormalizedEmbedding,
        maxMatches: number,
    ): Promise<ScoredItem<NameValue<string>>[]> {
        const embeddings = Object.values(vscodeActionEmbeddings);
        const actionNames = Object.keys(vscodeActionEmbeddings);

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
                    value: actionNames[itemIndex],
                },
            };
        });
    }
}
