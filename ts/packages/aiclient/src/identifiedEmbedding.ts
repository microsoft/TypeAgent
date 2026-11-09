// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { error, Result, success } from "typechat";
import {
    EmbeddingIdentity,
    EmbeddingRole,
    validateEmbeddingVector,
} from "./embeddingIdentity.js";
import { TextEmbeddingModel } from "./models.js";

export function identifyEmbeddingModel(
    inner: TextEmbeddingModel,
    settings: Omit<
        EmbeddingIdentity,
        "schemaVersion" | "task" | "prompt" | "artifactHash"
    > & {
        configuration: unknown;
    },
): TextEmbeddingModel {
    const { configuration, ...fields } = settings;
    const artifactHash = createHash("sha256")
        .update(JSON.stringify({ ...fields, configuration }))
        .digest("hex");
    const roles = new Map<EmbeddingRole, TextEmbeddingModel>();
    function forRole(role: EmbeddingRole): TextEmbeddingModel {
        const previous = roles.get(role);
        if (previous) return previous;
        const embeddingIdentity: EmbeddingIdentity = Object.freeze({
            ...fields,
            schemaVersion: 1,
            task: role,
            prompt: "",
            artifactHash,
        });
        const model: TextEmbeddingModel = {
            maxBatchSize: inner.maxBatchSize,
            embeddingIdentity,
            embeddingCapabilities: Object.freeze({
                inputModalities: Object.freeze(["text"] as const),
                mixedInputs: false,
            }),
            forRole,
            async resolve() {
                await inner.resolve?.();
                return model;
            },
            async generateEmbedding(text) {
                const result = await inner.generateEmbedding(text);
                if (!result.success) return result;
                const validated = validate([result.data]);
                return validated.success
                    ? success(validated.data[0])
                    : validated;
            },
            ...(inner.generateEmbeddingBatch
                ? {
                      async generateEmbeddingBatch(texts: string[]) {
                          const result =
                              await inner.generateEmbeddingBatch!(texts);
                          if (!result.success) return result;
                          if (result.data.length !== texts.length) {
                              return error(
                                  "Embedding batch cardinality mismatch",
                              );
                          }
                          return validate(result.data);
                      },
                  }
                : {}),
            ...(inner.dispose ? { dispose: () => inner.dispose!() } : {}),
        };
        roles.set(role, model);
        return model;
    }
    function validate(vectors: number[][]): Result<number[][]> {
        try {
            vectors.forEach((vector) =>
                validateEmbeddingVector(vector, fields.dimensions),
            );
            return success(vectors);
        } catch (cause) {
            return error(
                `Configured embedding output is incompatible: ${cause}`,
            );
        }
    }
    return forRole("document");
}
