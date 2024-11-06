// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import { CodeDocumentation, SemanticCodeIndex } from "code-processor";
import * as iapp from "interactive-app";
import { ObjectFolder, ScoredItem } from "typeagent";
import { Chunk } from "./pythonChunker.js";
import { wordWrap } from "./pythonImporter.js";
import path from "path";

type QueryOptions = {
    maxHits: number;
    minScore: number;
    verbose: boolean;
};

export async function runQueryInterface(
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    verbose = false,
): Promise<void> {
    const handlers: Record<string, iapp.CommandHandler> = {
        search,
    };
    iapp.addStandardHandlers(handlers);

    function searchDef(): iapp.CommandMetadata {
        return {
            description: "Search for a query string in the code index.",
            args: {
                query: {
                    description: "Natural language query",
                    type: "string",
                },
            },
            options: {
                maxHits: {
                    description: "Maximum number of hits to return",
                    type: "integer",
                    defaultValue: 10,
                },
                minScore: {
                    description: "Minimum score to return",
                    type: "number",
                    defaultValue: 0.7,
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                },
            },
        };
    }
    handlers.search.metadata = searchDef();
    async function search(
        args: string[] | iapp.NamedArgs,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        const namedArgs = iapp.parseNamedArguments(args, searchDef());
        const query: string = namedArgs.query;
        const options: QueryOptions = {
            maxHits: namedArgs.maxHits,
            minScore: namedArgs.minScore,
            verbose: namedArgs.verbose ?? verbose,
        };
        await processQuery(
            query,
            chunkFolder,
            codeIndex,
            summaryFolder,
            io,
            options,
        );
    }

    // Define special handlers, then run the console loop.

    async function onStart(io: iapp.InteractiveIo): Promise<void> {
        io.writer.writeLine("Welcome to the query interface!");
    }
    async function inputHandler(
        input: string,
        io: iapp.InteractiveIo,
    ): Promise<void> {
        io.writer.writeLine("Use @ command prefix; see @help.");
    }

    await iapp.runConsole({
        onStart,
        inputHandler,
        handlers,
    });
}

async function processQuery(
    input: string,
    chunkFolder: ObjectFolder<Chunk>,
    codeIndex: SemanticCodeIndex,
    summaryFolder: ObjectFolder<CodeDocumentation>,
    io: iapp.InteractiveIo,
    options: QueryOptions,
): Promise<void> {
    let hits: ScoredItem<string>[];
    try {
        hits = await codeIndex.find(input, options.maxHits, options.minScore);
    } catch (error) {
        io.writer.writeLine(`[${error}]`);
        return;
    }
    io.writer.writeLine(
        `Got ${hits.length} hit${hits.length == 0 ? "s." : hits.length === 1 ? ":" : "s:"}`,
    );

    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const chunk: Chunk | undefined = await chunkFolder.get(hit.item);
        if (!chunk) {
            io.writer.writeLine(`${hit} --> [No data]`);
            continue;
        }

        io.writer.writeLine(
            `Hit ${i + 1}: score: ${hit.score.toFixed(3)}, ` +
                `id: ${chunk.id}, ` +
                `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                `type: ${chunk.treeName}`,
        );
        const summary: CodeDocumentation | undefined = await summaryFolder.get(
            hit.item,
        );
        if (summary?.comments?.length) {
            for (const comment of summary.comments)
                io.writer.writeLine(
                    wordWrap(`${comment.comment} (${comment.lineNumber})`),
                );
        }
        let lineBudget = options.verbose ? 100 : 10;
        outer: for (const blob of chunk.blobs) {
            for (let i = 0; i < blob.lines.length; i++) {
                if (lineBudget-- <= 0) {
                    io.writer.writeLine("...");
                    break outer;
                }
                io.writer.writeLine(
                    `${(1 + blob.start + i).toString().padStart(6)}: ${blob.lines[i].trimEnd()}`,
                );
            }
        }
    }
}
