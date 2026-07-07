// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { ActionSchemaTypeDefinition } from "@typeagent/action-schema";
import { ActionConfig } from "./actionConfig.js";
import { ActionSchemaFile } from "./actionConfigProvider.js";
import {
    generateEmbeddingWithRetry,
    generateTextEmbeddingsWithRetry,
    NormalizedEmbedding,
    ScoredItem,
    similarity,
    SimilarityType,
    TopNCollection,
} from "typeagent";
import {
    TextEmbeddingModel,
    tryCreateEmbeddingModel,
} from "@typeagent/aiclient";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:semantic");
const debugError = registerDebug("typeagent:dispatcher:semantic:error");

type Entry = {
    embedding: NormalizedEmbedding;
    actionSchemaFile: ActionSchemaFile;
    definition: ActionSchemaTypeDefinition;
};

export type EmbeddingCache = Map<string, NormalizedEmbedding>;

export class ActionSchemaSemanticMap {
    private readonly actionSemanticMaps = new Map<string, Map<string, Entry>>();
    private readonly model: TextEmbeddingModel | undefined;
    // Set when no embedding provider is configured, or when embedding
    // generation fails at load time. In that state semantic schema
    // selection is unavailable and callers fall back to inline/search
    // routing instead of the daemon failing to start.
    private disabled: boolean;
    public constructor(model?: TextEmbeddingModel) {
        this.model = model ?? tryCreateEmbeddingModel();
        this.disabled = this.model === undefined;
        if (this.disabled) {
            debug(
                "No embedding provider configured; action semantic map disabled (schema routing falls back to inline/search).",
            );
        }
    }

    /**
     * True when semantic schema selection is available. False when no
     * embedding provider is configured or embeddings failed to load.
     */
    public get enabled(): boolean {
        return !this.disabled && this.model !== undefined;
    }

    public async addActionSchemaFile(
        config: ActionConfig,
        actionSchemaFile: ActionSchemaFile,
        cache?: EmbeddingCache,
    ) {
        if (!this.enabled) {
            return;
        }
        const keys: string[] = [];
        const definitions: ActionSchemaTypeDefinition[] = [];

        if (this.actionSemanticMaps.has(config.schemaName)) {
            throw new Error(
                `Internal Error: Duplicate schemaName ${config.schemaName}`,
            );
        }

        const actionSemanticMap = new Map<string, Entry>();
        this.actionSemanticMaps.set(config.schemaName, actionSemanticMap);
        let reuseCount = 0;
        for (const [name, definition] of actionSchemaFile.parsedActionSchema
            .actionSchemas) {
            const key = `${config.schemaName} ${name} ${definition.comments?.[0] ?? ""}`;
            const embedding = cache?.get(key);
            if (embedding) {
                actionSemanticMap.set(key, {
                    embedding,
                    actionSchemaFile,
                    definition,
                });
                reuseCount++;
            } else {
                keys.push(key);
                definitions.push(definition);
            }
        }

        debug(
            `Reused ${reuseCount}/${actionSchemaFile.parsedActionSchema.actionSchemas.size} embeddings for ${config.schemaName} ${cache === undefined}`,
        );
        if (keys.length > 0) {
            debug(
                `Requesting ${keys.length} missing embeddings for ${config.schemaName}: [${keys.map((k) => JSON.stringify(k)).join(", ")}]`,
            );
            const start = Date.now();
            try {
                const embeddings = await generateTextEmbeddingsWithRetry(
                    this.model!,
                    keys,
                );
                debug(
                    `Received ${embeddings.length} embeddings for ${config.schemaName} in ${Date.now() - start}ms`,
                );
                for (let i = 0; i < keys.length; i++) {
                    actionSemanticMap.set(keys[i], {
                        embedding: embeddings[i],
                        actionSchemaFile,
                        definition: definitions[i],
                    });
                }
            } catch (e: any) {
                // Do not fail agent initialization (which would exit the
                // daemon) when embeddings are unavailable at load time.
                // Disable semantic schema selection and fall back to
                // inline/search routing instead.
                this.disable(
                    `Failed to get embeddings for ${config.schemaName} after ${Date.now() - start}ms: ${e?.message ?? e}`,
                );
            }
        }
    }

    private disable(reason: string): void {
        if (this.disabled) {
            return;
        }
        this.disabled = true;
        this.actionSemanticMaps.clear();
        debugError(reason);
        if (process.env.NODE_ENV !== "test") {
            console.warn(
                `Action semantic map disabled — schema routing falls back to inline/search. ${reason}`,
            );
        }
    }

    public removeActionSchemaFile(schemaName: string) {
        this.actionSemanticMaps.delete(schemaName);
    }

    public async nearestNeighbors(
        request: string,
        maxMatches: number,
        filter: (schemaName: string) => boolean,
        minScore: number = 0,
    ): Promise<ScoredItem<Entry>[]> {
        if (!this.enabled) {
            return [];
        }
        let embedding: NormalizedEmbedding;
        try {
            embedding = await generateEmbeddingWithRetry(this.model!, request);
        } catch (e: any) {
            this.disable(
                `Failed to embed request for semantic schema selection: ${e?.message ?? e}`,
            );
            return [];
        }
        const matches = new TopNCollection<Entry>(maxMatches, {} as Entry);
        for (const [name, actionSemanticMap] of this.actionSemanticMaps) {
            if (!filter(name)) {
                continue;
            }
            for (const entry of actionSemanticMap.values()) {
                const score = similarity(
                    entry.embedding,
                    embedding,
                    SimilarityType.Dot,
                );
                if (score >= minScore) {
                    matches.push(entry, score);
                }
            }
        }
        return matches.byRank();
    }

    public embeddings(): [string, NormalizedEmbedding][] {
        const result: [string, NormalizedEmbedding][] = [];
        for (const actionSemanticMap of this.actionSemanticMaps.values()) {
            for (const [key, entry] of actionSemanticMap) {
                result.push([key, entry.embedding]);
            }
        }
        return result;
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
