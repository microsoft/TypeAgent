// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Result, error, success } from "typechat";
import { TextEmbeddingModel } from "./models.js";
import {
    CopilotModelEndpoint,
    CopilotModelEndpointProvider,
    createCopilotModelEndpointProvider,
} from "./copilotModels.js";
import {
    CopilotApiSettings,
    copilotApiSettingsFromConfig,
} from "./copilotSettings.js";

export const DefaultCopilotEmbeddingModel = "text-embedding-3-small";
const MaxBatchSize = 64;

type EmbeddingEntry = {
    index: number;
    embedding: number[];
};

type EmbeddingsResponse = {
    data?: EmbeddingEntry[];
};

export function createCopilotEmbeddingModel(
    modelName = DefaultCopilotEmbeddingModel,
    settings: CopilotApiSettings = copilotApiSettingsFromConfig(),
    endpointProvider: CopilotModelEndpointProvider = createCopilotModelEndpointProvider(
        settings,
        modelName,
    ),
): TextEmbeddingModel {
    return {
        generateEmbedding,
        generateEmbeddingBatch,
        maxBatchSize: MaxBatchSize,
    };

    async function generateEmbedding(input: string): Promise<Result<number[]>> {
        if (!input) return error("Empty input");
        const result = await generateEmbeddingBatch([input]);
        return result.success ? success(result.data[0]) : result;
    }

    async function generateEmbeddingBatch(
        input: string[],
    ): Promise<Result<number[][]>> {
        if (input.length === 0) return error("Empty input array");
        if (input.length > MaxBatchSize) {
            return error(`Batch size must be <= ${MaxBatchSize}`);
        }

        try {
            let endpoint = await endpointProvider.getEndpoint();
            let response = await request(endpoint, input);
            if (response.status === 401 || response.status === 403) {
                endpoint = await endpointProvider.getEndpoint(true);
                response = await request(endpoint, input);
            }
            if (!response.ok) {
                return error(
                    `Copilot embeddings request failed: HTTP ${response.status}`,
                );
            }
            return decodeResponse(await response.json(), input.length);
        } catch (cause) {
            return error(
                `Copilot embeddings request failed: ${
                    cause instanceof Error ? cause.message : String(cause)
                }`,
            );
        }
    }

    function request(
        endpoint: CopilotModelEndpoint,
        input: string[],
    ): Promise<Response> {
        return fetch(`${endpoint.baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                ...endpoint.headers,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                input,
                model: modelName,
                encoding_format: "float",
            }),
            signal: AbortSignal.timeout(settings.timeout ?? 30_000),
        });
    }
}

function decodeResponse(
    value: unknown,
    expectedCount: number,
): Result<number[][]> {
    const response = value as EmbeddingsResponse;
    if (
        !Array.isArray(response?.data) ||
        response.data.length !== expectedCount
    ) {
        return error(
            `Copilot embeddings response contained ${response?.data?.length ?? 0} vectors; expected ${expectedCount}`,
        );
    }
    const ordered = [...response.data].sort(
        (left, right) => left.index - right.index,
    );
    for (let index = 0; index < ordered.length; index++) {
        const entry = ordered[index];
        if (
            entry.index !== index ||
            !Array.isArray(entry.embedding) ||
            entry.embedding.length === 0 ||
            !entry.embedding.every(Number.isFinite)
        ) {
            return error(
                "Copilot embeddings response has an invalid data entry",
            );
        }
    }
    return success(ordered.map((entry) => entry.embedding));
}
