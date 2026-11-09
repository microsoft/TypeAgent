// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EmbeddingRole, TextEmbeddingModel } from "@typeagent/aiclient";

export function createOfflineEmbeddingModel(
    calls: string[],
    role: EmbeddingRole = "document",
): TextEmbeddingModel {
    return {
        maxBatchSize: 8,
        embeddingIdentity: {
            schemaVersion: 1,
            provider: "synthetic",
            model: "memory-service-fixture",
            revision: "1",
            dimensions: 1536,
            task: role,
            prompt: "",
            pooling: "fixture",
            normalization: "l2",
            preprocessing: "fixture-v1",
            artifactHash: "a".repeat(64),
        },
        forRole: (selected) => createOfflineEmbeddingModel(calls, selected),
        async generateEmbedding(text) {
            calls.push(text);
            return {
                success: true,
                data: Array.from({ length: 1536 }, (_, index) =>
                    index === 0 ? 1 : 0,
                ),
            };
        },
    };
}
