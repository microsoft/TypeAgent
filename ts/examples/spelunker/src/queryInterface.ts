// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// User interface for querying the index.

import { CodeDocumentation, SemanticCodeIndex } from "code-processor";
import * as iapp from "interactive-app";
import { ObjectFolder } from "typeagent";
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
    options: QueryOptions,
): Promise<void> {
    let hits;
    try {
        hits = await codeIndex.find(input, options.maxHits, options.minScore);
    } catch (error) {
        console.log(`[${error}]`);
        return;
    }
    console.log(
        `Got ${hits.length} hit${hits.length == 0 ? "s." : hits.length === 1 ? ":" : "s:"}`,
    );

    if (!options.verbose) return;

    for (let i = 0; i < hits.length; i++) {
        const hit = hits[i];
        const chunk: Chunk | undefined = await chunkFolder.get(hit.item);
        if (!chunk) {
            console.log(hit, "--> [No data]");
        } else {
            console.log(
                `Hit ${i + 1}: score: ${hit.score.toFixed(3)}, ` +
                    `id: ${chunk.id}, ` +
                    `file: ${path.relative(process.cwd(), chunk.filename!)}, ` +
                    `type: ${chunk.treeName}`,
            );
            const summary: CodeDocumentation | undefined =
                await summaryFolder.get(hit.item);
            if (summary?.comments?.length) {
                for (const comment of summary.comments)
                    console.log(
                        wordWrap(`${comment.comment} (${comment.lineNumber})`),
                    );
            }
            for (const blob of chunk.blobs) {
                for (let index = 0; index < blob.lines.length; index++) {
                    console.log(
                        `${(1 + blob.start + index).toString().padStart(3)}: ${blob.lines[index].trimEnd()}`,
                    );
                }
                console.log("");
                if (!options.verbose) break;
            }
        }
    }
}
