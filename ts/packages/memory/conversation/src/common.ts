// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import { openai } from "aiclient";

export function createEmbeddingModelWithCache(
    cacheSize: number,
    getCache?: () => kpLib.TextEmbeddingCache | undefined,
): [kpLib.TextEmbeddingModelWithCache, number] {
    const embeddingModel = kpLib.createEmbeddingCache(
        openai.createEmbeddingModel(),
        64,
        getCache,
    );

    return [embeddingModel, 1536];
}
