// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Statement } from "better-sqlite3";
import { Result } from "typechat";

import { openai, TextEmbeddingModel } from "aiclient";
import { createLimiter } from "common-utils";
import { createNormalized, dotProduct } from "typeagent";
import { NormalizedEmbedding } from "typeagent";

import { Chunk, ChunkId } from "./chunkSchema.js";
import { console_log } from "./logging.js";
import { retryOn429 } from "./retryLogic.js";
import { makeBatches } from "./batching.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import path from "path";

export function makeEmbeddingModel(): TextEmbeddingModel {
    const apiSettings = openai.apiSettingsFromEnv(openai.ModelType.Embedding);
    apiSettings.maxRetryAttempts = 0;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT_EMBEDDING_3_SMALL;
    if (endpoint) {
        apiSettings.endpoint = endpoint;
    }
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
    // const maxConcurrency =
    //     parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "5") ?? 5;
    const maxConcurrency = 2; // Seems we can do no better, given the low quota.
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
    const embeddings = await retryOn429(() =>
        generateEmbeddingBatch(stringBatch),
    );
    if (embeddings) {
        for (let i = 0; i < embeddings.length; i++) {
            const chunk = batch[i];
            const embedding: NormalizedEmbedding = createNormalized(
                embeddings[i],
            );
            prepInsertEmbeddings.run(chunk.chunkId, Buffer.from(embedding));
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
    const fileName = shortenedFilename(chunk.fileName);
    const line = lines.join("").replace(/\W+/g, " ").trim().slice(0, 20000); // Assuming average 2.5 chars per token
    return `${fileName}\n${line}\n}`;
}

function shortenedFilename(fileName: string): string {
    const prefix = process.env.HOME;
    if (prefix && fileName.startsWith(prefix + path.sep)) {
        return "~" + fileName.slice(prefix.length);
    } else {
        return fileName;
    }
}

export async function preSelectChunks(
    context: SpelunkerContext,
    input: string,
    maxChunks = 1000,
): Promise<ChunkId[]> {
    const tb0 = new Date().getTime();
    const queryEmbedding = await getEmbedding(context, input);
    const tb1 = new Date().getTime();
    const tail = !queryEmbedding ? " (failure)" : "";
    console_log(
        `  [Embedding input of ${input.length} characters took ${((tb1 - tb0) / 1000).toFixed(3)} seconds${tail}]`,
    );
    if (!queryEmbedding) {
        // Fail fast if we can't get an embedding.
        return [];
    }

    const ta0 = new Date().getTime();
    const db = context.queryContext!.database!;
    const prepAllEmbeddings = db.prepare(
        `SELECT chunkId, embedding FROM ChunkEmbeddings`,
    );
    const allEmbeddingRows: {
        chunkId: ChunkId;
        embedding: Buffer;
    }[] = prepAllEmbeddings.all() as any[];
    const ta1 = new Date().getTime();
    console_log(
        `  [Read ${allEmbeddingRows.length} embeddings in ${((ta1 - ta0) / 1000).toFixed(3)} seconds]`,
    );
    if (allEmbeddingRows.length <= maxChunks) {
        console_log(`  [Returning all ${allEmbeddingRows.length} chunk IDs]`);
        return allEmbeddingRows.map((row) => row.chunkId);
    }

    const embeddings = allEmbeddingRows.map(
        (row) => new Float32Array(Buffer.from(row.embedding)),
    );
    const tc0 = new Date().getTime();
    const similarities: { chunkId: ChunkId; score: number }[] = [];
    for (let i = 0; i < embeddings.length; i++) {
        const chunkId = allEmbeddingRows[i].chunkId;
        const score = dotProduct(embeddings[i], queryEmbedding);
        similarities.push({ chunkId, score });
    }
    similarities.sort((a, b) => b.score - a.score);
    similarities.splice(maxChunks);
    const chunkIds = similarities.map((s) => s.chunkId);
    const tc1 = new Date().getTime();
    console_log(
        `  [Found ${chunkIds.length} nearest neighbors in ${((tc1 - tc0) / 1000).toFixed(3)} seconds]`,
    );
    return chunkIds;
}

async function getEmbedding(
    context: SpelunkerContext,
    query: string,
): Promise<NormalizedEmbedding | undefined> {
    const model = context.queryContext!.embeddingModel!;
    const generateEmbeddingBatch = model.generateEmbeddingBatch;
    if (!generateEmbeddingBatch) {
        console_log(`[This embedding model does not support batch operations]`); // TODO: Fix this
        return undefined;
    }

    const rawEmbeddings: number[][] | undefined = await retryOn429(() =>
        generateEmbeddingBatch([query]),
    );
    const rawEmbedding = rawEmbeddings?.[0];
    if (!rawEmbedding) {
        console_log(`[Failed to generate embedding]`);
        return undefined;
    }
    return rawEmbedding ? createNormalized(rawEmbedding) : undefined;
}
