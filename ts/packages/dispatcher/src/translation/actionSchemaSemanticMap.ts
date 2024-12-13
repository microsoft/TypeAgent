// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { ActionSchemaFile, ActionSchemaTypeDefinition } from "action-schema";
import { ActionConfig } from "./agentTranslators.js";
import {
    generateEmbeddingWithRetry,
    generateTextEmbeddingsWithRetry,
    NormalizedEmbedding,
    ScoredItem,
    similarity,
    SimilarityType,
    TopNCollection,
} from "typeagent";
import { TextEmbeddingModel, openai } from "aiclient";

type Entry = {
    embedding: NormalizedEmbedding;
    actionSchemaFile: ActionSchemaFile;
    definition: ActionSchemaTypeDefinition;
};

export type EmbeddingCache = Map<string, NormalizedEmbedding>;

export class ActionSchemaSemanticMap {
    private readonly actionSemanticMap = new Map<string, Entry>();
    private readonly model: TextEmbeddingModel;
    public constructor(model?: TextEmbeddingModel) {
        this.model = model ?? openai.createEmbeddingModel();
    }
    public async addActionSchemaFile(
        config: ActionConfig,
        actionSchemaFile: ActionSchemaFile,
        cache?: EmbeddingCache,
    ) {
        const keys: string[] = [];
        const definitions: ActionSchemaTypeDefinition[] = [];

        for (const [name, definition] of actionSchemaFile.actionSchemas) {
            const key = `${config.schemaName} ${config.description} ${name} ${definition.comments?.[0] ?? ""}`;
            const embedding = cache?.get(key);
            if (embedding) {
                this.actionSemanticMap.set(key, {
                    embedding,
                    actionSchemaFile,
                    definition,
                });
            } else {
                keys.push(key);
                definitions.push(definition);
            }
        }
        const embeddings = await generateTextEmbeddingsWithRetry(
            this.model,
            keys,
        );
        for (let i = 0; i < keys.length; i++) {
            this.actionSemanticMap.set(keys[i], {
                embedding: embeddings[i],
                actionSchemaFile,
                definition: definitions[i],
            });
        }
    }

    public async nearestNeighbors(
        request: string,
        maxMatches: number,
        filter: (schemaName: string) => boolean,
        minScore: number = 0,
    ): Promise<ScoredItem<Entry>[]> {
        const embedding = await generateEmbeddingWithRetry(this.model, request);
        const matches = new TopNCollection<Entry>(maxMatches, {} as Entry);
        for (const entry of this.actionSemanticMap.values()) {
            if (!filter(entry.actionSchemaFile.schemaName)) {
                continue;
            }
            const score = similarity(
                entry.embedding,
                embedding,
                SimilarityType.Dot,
            );
            if (score >= minScore) {
                matches.push(entry, score);
            }
        }
        return matches.byRank();
    }

    public embeddings(): [string, NormalizedEmbedding][] {
        return Array.from(this.actionSemanticMap.entries()).map(
            ([key, entry]) => [key, entry.embedding],
        );
    }
}

// base64 encoding
type EncodedEmbedding = string;

function encodeEmbedding(embedding: NormalizedEmbedding): EncodedEmbedding {
    return btoa(String.fromCharCode(...new Uint8Array(embedding.buffer)));
}

function decodeEmbedding(embedding: EncodedEmbedding): NormalizedEmbedding {
    return new Float32Array(
        Uint8Array.from(
            [...atob(embedding)].map((c) => c.charCodeAt(0)),
        ).buffer,
    );
}

export async function writeEmbeddingCache(
    fileName: string,
    embeddings: [string, NormalizedEmbedding][],
) {
    const entries: [string, string][] = [];
    for (const embedding of embeddings) {
        entries.push([embedding[0], encodeEmbedding(embedding[1])]);
    }
    return fs.promises.writeFile(fileName, JSON.stringify(entries));
}

export async function readEmbeddingCache(
    fileName: string,
): Promise<EmbeddingCache> {
    const data = JSON.parse(await fs.promises.readFile(fileName, "utf-8"));
    const cache = new Map<string, NormalizedEmbedding>();
    for (const entry of data) {
        cache.set(entry[0], decodeEmbedding(entry[1]));
    }
    return cache;
}
