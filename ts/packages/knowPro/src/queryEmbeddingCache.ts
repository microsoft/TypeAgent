// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AsyncLocalStorage } from "node:async_hooks";
import type { TextEmbeddingModel } from "@typeagent/aiclient";
import type { NormalizedEmbedding } from "@typeagent/agent-runtime";
import { recordSearchTiming } from "./searchTiming.js";

type Cache = WeakMap<
    TextEmbeddingModel,
    Map<string, Promise<NormalizedEmbedding>>
>;
const requests = new AsyncLocalStorage<Cache>();
const maxEntriesPerModel = 256;

export function withQueryEmbeddingCache<T>(
    operation: () => T,
    enabled = true,
): T {
    if (!enabled) return requests.exit(operation);
    return requests.getStore()
        ? operation()
        : requests.run(new WeakMap(), operation);
}

export function queryEmbedding(
    model: TextEmbeddingModel,
    text: string,
    generate: () => Promise<NormalizedEmbedding>,
): Promise<NormalizedEmbedding> {
    return queryEmbeddings(model, [text], async () => [await generate()]).then(
        (embeddings) => embeddings[0]!,
    );
}

export async function queryEmbeddings(
    model: TextEmbeddingModel,
    texts: string[],
    generate: (texts: string[]) => Promise<NormalizedEmbedding[]>,
): Promise<NormalizedEmbedding[]> {
    const request = requests.getStore();
    if (!request) return generate(texts);
    let cache = request.get(model);
    if (!cache) {
        cache = new Map();
        request.set(model, cache);
    }
    const identity = JSON.stringify(model.embeddingIdentity);
    const key = (text: string) => JSON.stringify([identity, text]);
    const missing = [...new Set(texts.filter((text) => !cache.has(key(text))))];
    if (cache.size + missing.length > maxEntriesPerModel)
        return generate(texts);
    recordSearchTiming("knowpro.queryEmbedding.cache", 0, {
        hits: texts.length - missing.length,
        misses: missing.length,
    });
    if (missing.length) {
        const batch = Promise.resolve().then(() => generate(missing));
        for (let index = 0; index < missing.length; index++) {
            const text = missing[index]!;
            const entry = batch.then((embeddings) => {
                if (embeddings.length !== missing.length)
                    throw new Error(
                        "Query embedding batch cardinality mismatch",
                    );
                return embeddings[index]!;
            });
            cache.set(key(text), entry);
            void entry.catch(() => {
                if (cache.get(key(text)) === entry) cache.delete(key(text));
            });
        }
    }
    return Promise.all(texts.map((text) => cache.get(key(text))!));
}
