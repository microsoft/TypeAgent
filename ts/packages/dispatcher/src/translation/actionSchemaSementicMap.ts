// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { ActionSchemaFile, ActionSchemaTypeDefinition } from "action-schema";
import { ActionConfig } from "./agentTranslators.js";
import {
    createSemanticMap,
    EmbeddedValue,
    NormalizedEmbedding,
} from "typeagent";

type SementicValue = {
    actionSchemaFile: ActionSchemaFile;
    definition: ActionSchemaTypeDefinition;
};

export type EmbeddingCache = Map<string, NormalizedEmbedding>;

export class ActionSchemaSementicMap {
    private readonly actionSementicMap = createSemanticMap<SementicValue>();

    public async addActionSchemaFile(
        config: ActionConfig,
        actionSchemaFile: ActionSchemaFile,
        cache?: EmbeddingCache,
    ) {
        const entries: [string, SementicValue][] = [];
        for (const [name, definition] of actionSchemaFile.actionSchemas) {
            const key = `${config.schemaName} ${config.description} ${name} ${definition.comments?.[0] ?? ""}`;
            const value = { actionSchemaFile, definition };
            const embedding = cache?.get(key);
            if (embedding) {
                this.actionSementicMap.setValue(
                    { value: key, embedding },
                    value,
                );
            } else {
                entries.push([key, { actionSchemaFile, definition }]);
            }
        }
        await this.actionSementicMap.setMultiple(entries);
    }

    public async nearestNeighbors(
        request: string,
        maxMatches: number,
        minScore?: number,
    ) {
        return this.actionSementicMap.nearestNeighbors(
            request,
            maxMatches,
            minScore,
        );
    }

    public embeddings(): IterableIterator<EmbeddedValue<string>> {
        return this.actionSementicMap.keys();
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
    embeddings: IterableIterator<EmbeddedValue<string>>,
) {
    const entries: [string, string][] = [];
    for (const embedding of embeddings) {
        entries.push([embedding.value, encodeEmbedding(embedding.embedding)]);
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
