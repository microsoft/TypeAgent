// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

export type EmbeddingRole = "query" | "document";

export interface EmbeddingIdentity {
    schemaVersion: 1;
    provider: string;
    model: string;
    revision: string;
    dimensions: number;
    task: EmbeddingRole;
    prompt: string;
    pooling: string;
    normalization: "l2";
    preprocessing: string;
    artifactHash: string;
}

export interface EmbeddingSpacePairing {
    queryIdentity: string;
    documentIdentity: string;
    evidenceSha256: string;
}

export type EmbeddingPart =
    | { type: "text"; text: string }
    | {
          type: "image";
          bytes: Uint8Array;
          sha256: string;
          mimeType: string;
      };

export interface MediaEmbeddingInput {
    task: EmbeddingRole;
    parts: EmbeddingPart[];
}

export function embeddingIdentityKey(identity: EmbeddingIdentity): string {
    if (
        identity.schemaVersion !== 1 ||
        !Number.isSafeInteger(identity.dimensions) ||
        identity.dimensions <= 0 ||
        identity.normalization !== "l2" ||
        !["query", "document"].includes(identity.task)
    ) {
        throw new Error("Invalid embedding identity");
    }
    for (const value of [
        identity.provider,
        identity.model,
        identity.revision,
        identity.pooling,
        identity.preprocessing,
    ]) {
        if (typeof value !== "string" || value.length === 0) {
            throw new Error("Incomplete embedding identity");
        }
    }
    if (
        typeof identity.prompt !== "string" ||
        !/^[a-f0-9]{64}$/.test(identity.artifactHash)
    ) {
        throw new Error("Invalid embedding prompt or artifact hash");
    }
    const fields: (keyof EmbeddingIdentity)[] = [
        "artifactHash",
        "dimensions",
        "model",
        "normalization",
        "pooling",
        "preprocessing",
        "prompt",
        "provider",
        "revision",
        "schemaVersion",
        "task",
    ];
    const canonical = Object.fromEntries(
        fields.map((field) => [field, identity[field]]),
    );
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function validateEmbeddingVector(
    values: readonly number[],
    dimensions: number,
): void {
    if (
        values.length !== dimensions ||
        !Array.from(values).every(Number.isFinite) ||
        Math.abs(
            Math.sqrt(
                Array.from(values).reduce(
                    (sum, value) => sum + value * value,
                    0,
                ),
            ) - 1,
        ) > 0.001
    ) {
        throw new Error(
            `Expected a finite, nonzero, normalized ${dimensions}-dimensional embedding`,
        );
    }
}

export function validateEmbeddingPairing(
    pairing: EmbeddingSpacePairing,
    query: EmbeddingIdentity,
    document: EmbeddingIdentity,
): void {
    if (
        query.task !== "query" ||
        document.task !== "document" ||
        query.dimensions !== document.dimensions ||
        pairing.queryIdentity !== embeddingIdentityKey(query) ||
        pairing.documentIdentity !== embeddingIdentityKey(document) ||
        !/^[a-f0-9]{64}$/.test(pairing.evidenceSha256)
    ) {
        throw new Error("Uncertified query/document embedding-space pairing");
    }
}
