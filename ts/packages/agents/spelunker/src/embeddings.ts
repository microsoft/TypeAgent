// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Statement } from "better-sqlite3";
import { Result } from "typechat";

import { openai, TextEmbeddingModel } from "aiclient";
import { createLimiter } from "common-utils";
import { createNormalized } from "typeagent";
import { NormalizedEmbedding } from "typeagent";

import { Chunk } from "./chunkSchema.js";
import { console_log, makeBatches, retryTranslateOn429 } from "./searchCode.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";

export function makeEmbeddingModel(): TextEmbeddingModel {
    const apiSettings = openai.apiSettingsFromEnv(openai.ModelType.Embedding);
    apiSettings.maxRetryAttempts = 0;
    const embeddingModel = openai.createEmbeddingModel(apiSettings);
    console_log(`[Max embedding batch size: ${embeddingModel.maxBatchSize}]`);
    return embeddingModel;
}

export async function loadEmbeddings(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    const model = context.queryContext!.embeddingModel;
    if (!model.generateEmbeddingBatch) {
        console_log(`[This embedding model does not support batch operations]`); // TODO: Fix this
        return;
    }

    console_log(`[Step 1c: Store chunk embeddings]`);
    const generateEmbeddingBatch = model.generateEmbeddingBatch;
    const db = context.queryContext!.database!;
    const prepInsertEmbeddings = db.prepare(
        `INSERT OR REPLACE INTO ChunkEmbeddings (chunkId, embedding) VALUES (?, ?)`,
    );
    const maxCharacters = 100000; // TODO: tune
    const batches = makeBatches(chunks, maxCharacters, model.maxBatchSize);
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 5;
    console_log(
        `  [${batches.length} batches, maxConcurrency ${maxConcurrency}]`,
    );
    const limiter = createLimiter(maxConcurrency);
    const promises: Promise<void>[] = [];
    for (const batch of batches) {
        const p = limiter(() =>
            generateAndInsertEmbeddings(
                generateEmbeddingBatch,
                prepInsertEmbeddings,
                batch,
            ),
        );
        promises.push(p);
    }
    await Promise.all(promises);
}

async function generateAndInsertEmbeddings(
    generateEmbeddingBatch: (a: string[]) => Promise<Result<number[][]>>,
    prepInsertEmbeddings: Statement,
    batch: Chunk[],
): Promise<void> {
    const t0 = new Date().getTime();
    const stringBatch = batch.map(blobText);
    const data = await retryTranslateOn429(() =>
        generateEmbeddingBatch(stringBatch),
    );
    if (data) {
        for (let i = 0; i < data.length; i++) {
            const chunk = batch[i];
            const embedding: NormalizedEmbedding = createNormalized(data[i]);
            prepInsertEmbeddings.run(chunk.chunkId, embedding);
        }
        const t1 = new Date().getTime();
        const dtms = t1 - t0;
        const dtStr =
            dtms < 1000 ? `${dtms}ms` : `${(dtms / 1000).toFixed(3)}s`;
        console_log(
            `  [Generated and inserted embedding batch of ${batch.length} in ${dtStr}]`,
        );
    } else {
        const t1 = new Date().getTime();
        const dtms = t1 - t0;
        const dtStr =
            dtms < 1000 ? `${dtms}ms` : `${(dtms / 1000).toFixed(3)}s`;
        console_log(`  [Failed to generate embedding batch in ${dtStr}]`);
    }
}

function blobText(chunk: Chunk): string {
    const lines: string[] = [];
    for (const blob of chunk.blobs) {
        lines.push(...blob.lines);
    }
    // Keep only alphanumerical words; everything else is removed (hoping to reduce the cost)
    const line = lines.join("").replace(/\W+/g, " ").slice(0, 20000); // Assuming average 2.5 chars per token
    return line || "(blank)";
}
