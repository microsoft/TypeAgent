// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    ScoredItem,
    SemanticIndex,
    SimilarityType,
    createEmbeddingFolder,
    createSemanticIndex,
} from "typeagent";
import path from "path";
import { TextIndexSettings } from "../textIndex.js";

export interface MessageIndex<TMessageId> extends SemanticIndex<TMessageId> {
    nearestNeighborsInSubset(
        value: string,
        subsetIds: TMessageId[],
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TMessageId>[]>;

    putMultiple(
        items: [string, TMessageId][],
        onlyIfNew?: boolean,
    ): Promise<[string, TMessageId][]>;
}

export async function createMessageIndex(
    settings: TextIndexSettings,
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<MessageIndex<string>> {
    type MessageId = string;
    const embeddingFolder = await createEmbeddingFolder(
        path.join(folderPath, "embeddings"),
        folderSettings,
        settings.concurrency,
        fSys,
    );
    const semanticIndex = createSemanticIndex(
        embeddingFolder,
        settings.embeddingModel,
    );
    return {
        ...semanticIndex,
        putMultiple,
        nearestNeighborsInSubset,
    };

    async function putMultiple(
        items: [string, MessageId][],
        onlyIfNew?: boolean,
        concurrency?: number,
    ) {
        return semanticIndex.putMultiple(
            items,
            onlyIfNew,
            concurrency ?? settings.concurrency,
        );
    }

    async function nearestNeighborsInSubset(
        value: string,
        subsetIds: MessageId[],
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<MessageId>[]> {
        const embedding = await semanticIndex.getEmbedding(value);
        return embeddingFolder.nearestNeighborsInSubset(
            embedding,
            subsetIds,
            maxMatches,
            SimilarityType.Dot, // We use normalized embeddings
            minScore,
        );
    }
}
