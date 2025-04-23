// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ScoredItem } from "../memory.js";
import {
    Embedding,
    SimilarityType,
    indexOfNearest,
    indexesOfNearest,
} from "../vector/embeddings.js";
import { Path } from "../objStream.js";
import {
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
    createObjectFolder,
} from "./objectFolder.js";
import { VectorIndex } from "../vector/vectorIndex.js";
import { asyncArray } from "../index.js";

/**
 * EmbeddingFolder stores embeddings in folder, one per file.
 * The name of the file is the key associated with the embedding.
 * Nearest neighbor matches return the names of the matching files.
 */
export interface EmbeddingFolder
    extends ObjectFolder<Embedding>,
        VectorIndex<string> {
    nearestNeighborsInSubset(
        embedding: Embedding,
        subsetIds: string[],
        maxMatches: number,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<string>[]>;
}

export async function createEmbeddingFolder(
    folderPath: Path,
    folderSettings?: ObjectFolderSettings,
    concurrency?: number,
    fSys?: FileSystem,
): Promise<EmbeddingFolder> {
    concurrency ??= 2;
    const settings: ObjectFolderSettings = {
        serializer: (obj) => obj,
        deserializer: (buffer) => new Float32Array(buffer.buffer),
    };
    if (folderSettings) {
        settings.cacheNames = folderSettings.cacheNames;
        settings.useWeakRefs = folderSettings.useWeakRefs;
    }
    const folder = await createObjectFolder<Embedding>(
        folderPath,
        settings,
        fSys,
    );
    return {
        ...folder,
        nearestNeighbor,
        nearestNeighbors,
        nearestNeighborsInSubset,
    };

    async function nearestNeighbor(
        embedding: Embedding,
        similarity: SimilarityType,
    ): Promise<ScoredItem<string> | undefined> {
        const entries = await loadEntries();
        const match = indexOfNearest(entries.embeddings, embedding, similarity);
        if (match.item < 0) {
            return undefined;
        }
        return {
            item: entries.names[match.item],
            score: match.score,
        };
    }

    async function nearestNeighbors(
        embedding: Embedding,
        maxMatches: number,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<string>[]> {
        if (maxMatches === 1) {
            const match = await nearestNeighbor(embedding, similarity);
            if (!match) {
                return [];
            }

            const matches: ScoredItem<string>[] = [];
            if (!minScore || match.score >= minScore) {
                matches.push(match);
            }
            return matches;
        }

        const entries = await loadEntries();
        const matches = indexesOfNearest(
            entries.embeddings,
            embedding,
            maxMatches,
            similarity,
            minScore ?? Number.MIN_VALUE,
        );
        return matches.map((m) => {
            return {
                item: entries.names[m.item],
                score: m.score,
            };
        });
    }

    async function nearestNeighborsInSubset(
        embedding: Embedding,
        subsetIds: string[],
        maxMatches: number,
        similarity: SimilarityType,
        minScore?: number,
    ): Promise<ScoredItem<string>[]> {
        const entries = await loadEntriesSubset(subsetIds);
        const matches = indexesOfNearest(
            entries.embeddings,
            embedding,
            maxMatches,
            similarity,
            minScore ?? Number.MIN_VALUE,
        );
        return matches.map((m) => {
            return {
                item: entries.names[m.item],
                score: m.score,
            };
        });
    }

    async function loadEntries(): Promise<{
        names: string[];
        embeddings: Embedding[];
    }> {
        const names: string[] = await folder.allNames();
        let loadedEmbeddings = await asyncArray.mapAsync(
            names,
            concurrency!,
            (name) => folder.get(name),
        );
        let embeddings = loadedEmbeddings.filter(
            (e) => e !== undefined,
        ) as Embedding[];
        return { names, embeddings };
    }

    async function loadEntriesSubset(nameSubset: string[]): Promise<{
        names: string[];
        embeddings: Embedding[];
    }> {
        // TODO: parallelize
        let names: string[] = [];
        let embeddings: Embedding[] = [];
        for (const name of nameSubset) {
            const entry = await folder.get(name);
            if (entry) {
                names.push(name);
                embeddings.push(entry);
            }
        }
        return { names, embeddings };
    }
}
