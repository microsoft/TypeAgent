// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";

import dotenv from "dotenv";

import { createDatabase } from "./databaseUtils.js";
import { console_log, getDirName, resetEpoch } from "./logging.js";
import { createQueryContext } from "./queryContext.js";
import {
    loadDatabase,
    readAllChunksFromDatabase,
    selectChunks,
} from "./searchCode.js";
import {
    initializeSpelunkerContext,
    SpelunkerContext,
} from "./spelunkerActionHandler.js";
import { ChunkId } from "./chunkSchema.js";

const __dirname = getDirName(); // .../ts/packages/agents/spelunker/dist
dotenv.config({ path: path.join(__dirname, "../../../../.env") }); // .../ts/.env

type ConfigRecord = Record<string, any>;

// TODO: Read this from a file that can be edited before each run,
// or alternatively, read from command line args.
const CONFIG: ConfigRecord = {
    evalFolder: "evals/eval-2",
    questionId: 2,
};

async function main() {
    resetEpoch();
    console_log("Starting eval script.");
    console_log(`CONFIG = ${JSON.stringify(CONFIG, undefined, 4)}`);
    const context = await initializeSpelunkerContext();
    fillSpelunkerContext(context, CONFIG);
    const question = readQuestion(context, CONFIG);
    await loadDatabase(context);
    await conductEval(context, CONFIG, question);
    console_log("Eval script finished.");
}

function fillSpelunkerContext(
    context: SpelunkerContext,
    config: ConfigRecord,
): void {
    const evalFolder = path.join(path.dirname(__dirname), config.evalFolder);
    const focusFolder = path.join(evalFolder, "source");
    context.focusFolders = [focusFolder];
    const dbFile = path.join(evalFolder, "eval.db");
    context.queryContext = createQueryContext(dbFile);
    createDatabase(context);
}

function readQuestion(context: SpelunkerContext, config: ConfigRecord): string {
    const db = context.queryContext!.database!;
    const row = db
        .prepare<
            [number],
            { question: string }
        >("SELECT question FROM Questions WHERE questionId = ?")
        .get(CONFIG.questionId);
    if (!row) {
        throw new Error(
            `No question found for questionId ${CONFIG.questionId}`,
        );
    }
    return row.question;
}

async function conductEval(
    context: SpelunkerContext,
    config: ConfigRecord,
    question: string,
): Promise<void> {
    console_log("*** Conducting eval ***");
    console_log(`Question: ${question}`);
    const db = context.queryContext!.database!;
    const allChunks = await readAllChunksFromDatabase(db);
    const chunks = await selectChunks(context, allChunks, question);
    // if (!chunks.length) {
    //     throw new Error("No chunks returned from selectChunks!");
    // }
    const selectedHashes = new Set<string>();
    for (const chunk of chunks) {
        const hash = lookupHashFromChunkId(context, chunk.chunkId);
        selectedHashes.add(hash);
    }
    const correctHashes = new Set<string>();
    const prep = db.prepare<[number], { chunkHash: string }>(
        "SELECT chunkHash FROM Scores WHERE score == 1 AND questionId == ?",
    );
    for (const row of prep.iterate(CONFIG.questionId)) {
        const hash = row.chunkHash;
        correctHashes.add(hash);
    }
    console_log("Computing F1 score:");
    // precision = len(selectedHashes ∩ correctHashes) / len(selectedHashes)
    // recall = len(selectedHashes ∩ correctHashes) / len(correctHashes)
    // F1 = 2 * (precision * recall) / (precision + recall)
    const intersection = intersect<string>(selectedHashes, correctHashes);
    const precision = intersection.size / selectedHashes.size || 0; // If NaN
    const recall = intersection.size / correctHashes.size || 0; // If NaN
    const F1 = (2 * (precision * recall)) / (precision + recall) || 0; // If NaN
    console_log(
        `precision: ${precision.toFixed(3)}, recall: ${recall.toFixed(3)}, F1: ${F1.toFixed(3)}`,
    );
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
    return new Set([...a].filter((x) => b.has(x)));
}

function lookupHashFromChunkId(
    context: SpelunkerContext,
    chunkId: ChunkId,
): string {
    const db = context.queryContext!.database!;
    const row = db
        .prepare<
            [string],
            { chunkHash: string }
        >("SELECT chunkHash FROM Hashes WHERE chunkId = ?")
        .get(chunkId);
    if (!row) {
        throw new Error(`No hash found for chunkId ${chunkId}`);
    }
    return row.chunkHash;
}

// function lookupChunkIdFromHash(
//     context: SpelunkerContext,
//     chunkHash: string,
// ): ChunkId {
//     const db = context.queryContext!.database!;
//     const row = db
//         .prepare<
//             [string],
//             {chunkId: string}
//         >("SELECT chunkId FROM Hashes WHERE chunkHash = ?")
//         .get(chunkHash);
//     if (!row) {
//         throw new Error(`No chunkId found for hash ${chunkHash}`);
//     }
//     return row.chunkId;
// }

await main();
