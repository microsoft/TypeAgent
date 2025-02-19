// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

import { createLimiter } from "common-utils";

import { Chunk, ChunkId } from "./chunkSchema.js";
import { console_log } from "./logging.js";
import { retryOn429 } from "./retryLogic.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";

export async function summarizeChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    console_log(`[Step 1d: Summarizing ${chunks.length} chunks]`);
    // NOTE: We cannot stuff the buffer, because the completion size
    // is limited to 4096 tokens, and we expect a certain number of
    // tokens per chunk. Experimentally, 40 chunks per job works great.
    const maxConcurrency =
        parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 5;
    let chunksPerJob = 40;
    let numJobs = Math.ceil(chunks.length / chunksPerJob);
    console_log(
        `  [${chunksPerJob} chunks/job, ${numJobs} jobs, maxConcurrency ${maxConcurrency}]`,
    );
    const limiter = createLimiter(maxConcurrency);
    const promises: Promise<void>[] = [];
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        promises.push(limiter(() => summarizeChunkSlice(context, slice)));
    }
    await Promise.all(promises);
}

async function summarizeChunkSlice(
    context: SpelunkerContext,
    chunks: Chunk[],
): Promise<void> {
    const summarizer = context.queryContext!.chunkSummarizer;
    // TODO: Prompt engineering
    const prompt = `\
    Please summarize each of the given chunks.
    A summary should be a one-line description of the chunk.
    Also include the signature of the chunk.

    Chunks:
    ${prepareChunks(chunks)}
    `;
    // console_log(prompt);
    const result = await retryOn429(() => summarizer.translate(prompt));
    if (!result) {
        console_log(
            `  [Failed to summarize chunks for ${chunks.length} chunks]`,
        );
        return;
    }

    const summarizeSpecs = result;
    // console_log(`  [Received ${result.summaries.length} summaries]`);
    // Enter them into the database
    const db = context.queryContext!.database!;
    const prepInsertSummary = db.prepare(
        `INSERT OR REPLACE INTO Summaries (chunkId, language, summary, signature) VALUES (?, ?, ?, ?)`,
    );
    const prepGetBlobWithBreadcrumb = db.prepare(
        `SELECT lines, breadcrumb FROM Blobs WHERE breadcrumb = ?`,
    );
    const prepUpdateBlob = db.prepare(
        "UPDATE Blobs SET lines = ? WHERE breadcrumb = ?",
    );
    let errors = 0;
    for (const summary of summarizeSpecs.summaries) {
        // console_log(summary);
        try {
            prepInsertSummary.run(
                summary.chunkId,
                summary.language,
                summary.summary,
                summary.signature,
            );
        } catch (error) {
            console_log(
                `*** Db error for insert summary ${JSON.stringify(summary)}: ${error}`,
            );
            errors += 1;
        }
        try {
            type BlobRowType = { lines: string; breadcrumb: ChunkId };
            const blobRow: BlobRowType = prepGetBlobWithBreadcrumb.get(
                summary.chunkId,
            ) as any;
            if (blobRow) {
                let blobLines: string = blobRow.lines;
                // Assume it doesn't start with a blank line /(^\s*\r?\n)*/
                const indent = blobLines?.match(/^(\s*)\S/)?.[1] ?? ""; // Whitespace followed by non-whitespace
                blobLines =
                    `${indent}${languageCommentMap[summary.language ?? "python"]} ${summary.summary}\n` +
                    `${indent}${summary.signature} ...\n`;
                // console_log(
                //     `  [Replacing\n'''\n${blobRow.lines}'''\nwith\n'''\n${blobLines}\n''']`,
                // );
                const res = prepUpdateBlob.run(blobLines, summary.chunkId);
                if (res.changes !== 1) {
                    console_log(
                        `  [*** Failed to update blob lines for ${summary.chunkId}]`,
                    );
                }
            }
        } catch (error) {
            console_log(
                `*** Db error for update blob ${JSON.stringify(summary)}: ${error}`,
            );
            errors += 1;
        }
    }
    if (errors) console_log(`  [${errors} errors]`);
}

export function prepareChunks(chunks: Chunk[]): string {
    chunks.sort(
        // Sort by file name and chunk ID (should order by line number)
        (a, b) => {
            let cmp = a.fileName.localeCompare(b.fileName);
            if (!cmp) {
                cmp = a.lineNo - b.lineNo;
            }
            return cmp;
        },
    );
    const output: string[] = [];
    function put(line: string): void {
        // console_log(line.trimEnd());
        output.push(line);
    }
    let lastFn = "";
    let lineNo = 0;
    for (const chunk of chunks) {
        if (chunk.fileName !== lastFn) {
            lastFn = chunk.fileName;
            lineNo = 0;
            put("\n");
            put(`** file=${chunk.fileName}\n`);
        }
        put(
            `* chunkId=${chunk.chunkId} kind=${chunk.treeName} name=${chunk.codeName}\n`,
        );
        for (const blob of chunk.blobs) {
            lineNo = blob.start;
            for (const line of blob.lines) {
                lineNo += 1;
                put(`${lineNo} ${line}`);
            }
        }
    }
    return output.join("");
}

// TODO: Remove export once we're using summaries again.
export function prepareSummaries(db: sqlite.Database): string {
    const selectAllSummaries = db.prepare(`SELECT * FROM Summaries`);
    const summaryRows: any[] = selectAllSummaries.all();
    if (summaryRows.length > 100) {
        console_log(`  [Over 100 summary rows, skipping summaries in prompt]`);
        return "";
    }
    const lines: string[] = [];
    for (const summaryRow of summaryRows) {
        const comment = languageCommentMap[summaryRow.language] ?? "#";
        lines.push("");
        lines.push(`${comment} ${summaryRow.summary}`);
        lines.push(summaryRow.signature);
    }
    return lines.join("\n");
}

// TODO: Make the values two elements, comment start and comment end
// (and then caller should ensure comment end doesn't occur in the comment text).
const languageCommentMap: { [key: string]: string } = {
    python: "#",
    typescript: "//",
};
