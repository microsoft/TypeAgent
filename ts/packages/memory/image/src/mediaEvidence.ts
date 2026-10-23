// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    EmbeddingIdentity,
    EmbeddingSpacePairing,
    embeddingIdentityKey,
    validateEmbeddingPairing,
    validateEmbeddingVector,
} from "@typeagent/aiclient";

export interface MediaEvidenceLocation {
    kind: "text" | "image";
    messageOrdinal?: number;
    chunkOrdinal?: number;
    assetHash?: string;
    region?: [number, number, number, number];
}

export interface MediaEvidenceRecord {
    sourceId: string;
    revision: string;
    assetHash: string;
    locations: MediaEvidenceLocation[];
    vector: number[];
    [key: string]: unknown;
}

export interface MediaEvidenceQuery {
    identity: EmbeddingIdentity;
    vector: number[];
    kind: "text" | "image" | "mixed";
    pairing: EmbeddingSpacePairing;
    sourceIds?: readonly string[];
    excludeSourceId?: string;
    excludeAssetHash?: string;
    maxResults?: number;
}

export interface MediaEvidenceHit {
    sourceId: string;
    revision: string;
    assetHash: string;
    score: number;
    locations: MediaEvidenceLocation[];
    queryKind: MediaEvidenceQuery["kind"];
    laneIdentity: string;
}

export function mediaAssetHash(bytes: Uint8Array | string): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** Saved-vector lane only: this module performs no model loading or inference. */
export class MediaEvidenceLane {
    public readonly identityKey: string;

    constructor(
        public readonly identity: EmbeddingIdentity,
        private readonly records: readonly MediaEvidenceRecord[],
    ) {
        this.identityKey = embeddingIdentityKey(identity);
        if (identity.task !== "document") {
            throw new Error("Media evidence lane requires document identity");
        }
        for (const record of records) {
            if (
                !record.sourceId ||
                !record.revision ||
                !/^[a-f0-9]{64}$/.test(record.assetHash)
            ) {
                throw new Error(
                    "Media evidence requires stable source, revision and asset hash",
                );
            }
            validateEmbeddingVector(record.vector, identity.dimensions);
            if (!record.locations.length)
                throw new Error("Missing media evidence locations");
        }
    }

    public search(query: MediaEvidenceQuery): MediaEvidenceHit[] {
        if (
            query.maxResults !== undefined &&
            (!Number.isSafeInteger(query.maxResults) || query.maxResults < 0)
        ) {
            throw new Error("maxResults must be a nonnegative integer");
        }
        validateEmbeddingPairing(query.pairing, query.identity, this.identity);
        validateEmbeddingVector(query.vector, query.identity.dimensions);
        const sources = query.sourceIds ? new Set(query.sourceIds) : undefined;
        const ranked = this.records
            .filter(
                (record) =>
                    (!sources || sources.has(record.sourceId)) &&
                    record.sourceId !== query.excludeSourceId &&
                    record.assetHash !== query.excludeAssetHash,
            )
            .map((record) => ({
                ...record,
                score: record.vector.reduce(
                    (sum, value, i) => sum + value * query.vector[i],
                    0,
                ),
            }))
            .sort(
                (a, b) =>
                    b.score - a.score || a.sourceId.localeCompare(b.sourceId),
            );
        const hits = new Map<string, MediaEvidenceHit>();
        for (const record of ranked) {
            const key = JSON.stringify([
                record.sourceId,
                record.revision,
                record.assetHash,
            ]);
            const hit = hits.get(key);
            if (hit) {
                const locations = new Map(
                    [...hit.locations, ...record.locations].map((location) => [
                        JSON.stringify(location),
                        location,
                    ]),
                );
                hit.locations = [...locations.values()];
            } else {
                hits.set(key, {
                    sourceId: record.sourceId,
                    revision: record.revision,
                    assetHash: record.assetHash,
                    score: record.score,
                    locations: [...record.locations],
                    queryKind: query.kind,
                    laneIdentity: this.identityKey,
                });
            }
        }
        return [...hits.values()].slice(0, query.maxResults ?? 10);
    }
}
