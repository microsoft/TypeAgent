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
    similarity,
    SimilarityType,
} from "@typeagent/agent-runtime";
import {
    TextEmbeddingModel,
    tryCreateEmbeddingModel,
} from "@typeagent/aiclient";
import registerDebug from "debug";
import {
    compareActionCandidateIdentity,
    type ActionCandidateFilter,
    type ActionCandidateRanker,
    type ActionCandidateResult,
} from "./actionCandidateRanker.js";

const debug = registerDebug("typeagent:dispatcher:semantic");
const debugError = registerDebug("typeagent:dispatcher:semantic:error");

type Entry = {
    embedding: NormalizedEmbedding;
    schemaName: string;
    actionName: string;
    definition: ActionSchemaTypeDefinition;
};

type PendingEntry = {
    key: string;
    actionName: string;
    definition: ActionSchemaTypeDefinition;
};

export type EmbeddingCache = Map<string, NormalizedEmbedding>;

export class ActionSchemaSemanticMap implements ActionCandidateRanker {
    private readonly actionSemanticMaps = new Map<string, Map<string, Entry>>();
    private readonly schemaVersions = new Map<string, number>();
    private readonly model: TextEmbeddingModel | undefined;
    // Set when no embedding provider is configured, or when embedding
    // generation fails at load time. In that state semantic schema
    // selection is unavailable and callers fall back to inline/search
    // routing instead of the daemon failing to start.
    private disabled: boolean;
    public constructor(model?: TextEmbeddingModel | null) {
        this.model =
            model === null ? undefined : (model ?? tryCreateEmbeddingModel());
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

        if (this.actionSemanticMaps.has(config.schemaName)) {
            throw new Error(
                `Internal Error: Duplicate schemaName ${config.schemaName}`,
            );
        }

        const version = this.beginSchemaUpdate(config.schemaName);
        const actionSemanticMap = await this.createActionSemanticMap(
            config,
            actionSchemaFile,
            cache,
        );
        if (
            actionSemanticMap !== undefined &&
            this.enabled &&
            this.schemaVersions.get(config.schemaName) === version
        ) {
            if (this.actionSemanticMaps.has(config.schemaName)) {
                throw new Error(
                    `Internal Error: Duplicate schemaName ${config.schemaName}`,
                );
            }
            this.actionSemanticMaps.set(config.schemaName, actionSemanticMap);
        }
    }

    /**
     * Rebuilds a schema's entries off to the side and swaps them in together.
     * Searches continue to see the previous complete schema until the new
     * embeddings are ready.
     */
    public async replaceActionSchemaFile(
        config: ActionConfig,
        actionSchemaFile: ActionSchemaFile,
        cache?: EmbeddingCache,
    ): Promise<void> {
        if (!this.enabled) {
            return;
        }
        const version = this.beginSchemaUpdate(config.schemaName);
        const actionSemanticMap = await this.createActionSemanticMap(
            config,
            actionSchemaFile,
            cache,
        );
        if (
            actionSemanticMap !== undefined &&
            this.enabled &&
            this.schemaVersions.get(config.schemaName) === version
        ) {
            this.actionSemanticMaps.set(config.schemaName, actionSemanticMap);
        }
    }

    private beginSchemaUpdate(schemaName: string): number {
        const version = (this.schemaVersions.get(schemaName) ?? 0) + 1;
        this.schemaVersions.set(schemaName, version);
        return version;
    }

    private async createActionSemanticMap(
        config: ActionConfig,
        actionSchemaFile: ActionSchemaFile,
        cache?: EmbeddingCache,
    ): Promise<Map<string, Entry> | undefined> {
        const actionSemanticMap = new Map<string, Entry>();
        const keys: string[] = [];
        const pendingEntries: PendingEntry[] = [];
        let reuseCount = 0;
        for (const [name, definition] of actionSchemaFile.parsedActionSchema
            .actionSchemas) {
            const key = `${config.schemaName} ${name} ${definition.comments?.[0] ?? ""}`;
            const embedding = cache?.get(key);
            if (embedding) {
                actionSemanticMap.set(key, {
                    embedding,
                    schemaName: config.schemaName,
                    actionName: name,
                    definition,
                });
                reuseCount++;
            } else {
                keys.push(key);
                pendingEntries.push({
                    key,
                    actionName: name,
                    definition,
                });
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
                for (let i = 0; i < pendingEntries.length; i++) {
                    const pending = pendingEntries[i];
                    actionSemanticMap.set(pending.key, {
                        embedding: embeddings[i],
                        schemaName: config.schemaName,
                        actionName: pending.actionName,
                        definition: pending.definition,
                    });
                }
            } catch (e: any) {
                const reason = `Failed to get embeddings for ${config.schemaName} after ${Date.now() - start}ms: ${e?.message ?? e}`;
                // Do not fail agent initialization (which would exit the
                // daemon) when embeddings are unavailable at load time.
                // Disable semantic schema selection and fall back to
                // inline/search routing instead.
                this.disable(reason);
                return undefined;
            }
        }
        return actionSemanticMap;
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
        this.beginSchemaUpdate(schemaName);
        this.actionSemanticMaps.delete(schemaName);
    }

    public async rankActionCandidates(
        request: string,
        maxCandidates: number,
        filter: ActionCandidateFilter,
        minScore: number = 0,
    ): Promise<ActionCandidateResult[] | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        let embedding: NormalizedEmbedding;
        try {
            embedding = await generateEmbeddingWithRetry(this.model!, request);
        } catch (e: any) {
            this.disable(
                `Failed to embed request for semantic schema selection: ${e?.message ?? e}`,
            );
            return undefined;
        }
        const matches: ActionCandidateResult[] = [];
        for (const actionSemanticMap of this.actionSemanticMaps.values()) {
            for (const entry of actionSemanticMap.values()) {
                if (!filter(entry.schemaName, entry.actionName)) {
                    continue;
                }
                const score = similarity(
                    entry.embedding,
                    embedding,
                    SimilarityType.Dot,
                );
                if (score >= minScore) {
                    matches.push({
                        schemaName: entry.schemaName,
                        actionName: entry.actionName,
                        score,
                        definition: entry.definition,
                    });
                }
            }
        }
        return matches
            .sort(
                (a, b) =>
                    b.score - a.score || compareActionCandidateIdentity(a, b),
            )
            .slice(0, maxCandidates);
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
