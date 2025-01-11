// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import { ChatModel, openai } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import {
    ActionResult,
    ActionResultSuccess,
    Entity,
} from "@typeagent/agent-sdk";
import { createActionResultFromError } from "@typeagent/agent-sdk/helpers/action";

import { AnswerSpecs } from "./makeAnswerSchema.js";
import { ChunkDescription, SelectorSpecs } from "./makeSelectorSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";
import {
    Chunk,
    ChunkedFile,
    chunkifyPythonFiles,
    ErrorItem,
} from "./pythonChunker.js";

export interface ModelContext {
    chatModel: ChatModel;
    answerMaker: TypeChatJsonTranslator<AnswerSpecs>;
    miniModel: ChatModel;
    chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
}

export function createModelContext(): ModelContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const answerMaker = createAnswerMaker(chatModel);
    const miniModel = openai.createChatModel(
        "GPT_4_0_MINI",
        undefined,
        undefined,
        ["spelunkerMini"],
    );
    const chunkSelector = createChunkSelector(miniModel);
    return { chatModel, answerMaker, miniModel, chunkSelector };
}

// Answer a question; called from request and from answerQuestion action
export async function answerQuestion(
    context: SpelunkerContext,
    input: string,
): Promise<ActionResult> {
    if (!context.focusFolders.length) {
        return createActionResultFromError("Please set the focus to a folder");
    }

    // 1. Find all .py files in the focus directories (locally, using a subprocess).
    console.log("[Step 1: Find .py files]");
    const files: string[] = [];
    for (let i = 0; i < context.focusFolders.length; i++) {
        files.push(...getAllPyFilesSync(context.focusFolders[i]));
    }

    // 2. Chunkify all files found (locally).
    // TODO: Make this into its own function.
    console.log(`[Step 2: Chunking ${files.length} files]`);
    const allItems = await chunkifyPythonFiles(files); //ChunkedFiles and ErrorItems
    const allErrorItems = allItems.filter(
        (item): item is ErrorItem => "error" in item,
    );
    for (const errorItem of allErrorItems) {
        // TODO: Use appendDisplay (requires passing actionContext)
        console.log(
            `[Error: ${errorItem.error}; Output: ${errorItem.output ?? ""}]`,
        );
    }
    const allChunkedFiles = allItems.filter(
        (item): item is ChunkedFile => "chunks" in item,
    );
    const allChunks: Chunk[] = [];
    for (const chunkedFile of allChunkedFiles) {
        for (const chunk of chunkedFile.chunks) {
            chunk.fileName = chunkedFile.fileName;
            allChunks.push(chunk);
        }
    }
    console.log(
        `[Chunked ${allChunkedFiles.length} files into ${allChunks.length} chunks`,
    );

    // 3. Ask a fast LLM for the most relevant chunks, rank them, and keep tthe best 30.
    // This is done concurrently for real-time speed.
    console.log("[Step 3: Select 30 most relevant chunks]");
    const chunkDescs: ChunkDescription[] = await selectChunks(
        context,
        allChunks,
        input,
    );
    if (!chunkDescs.length) {
        throw new Error("No chunks selected");
    }

    // 4. Construct a prompt from those chunks.
    console.log("[Step 4: Construct prompt]");
    const preppedChunks = chunkDescs.map((chunkDesc) =>
        prepChunk(chunkDesc, allChunks),
    );
    const prompt = `\
Please answer the user question using the given context (both given below).

User question: "${input}"

Context:

${JSON.stringify(preppedChunks)}
`;
    // console.log(`[${prompt.slice(0, 1000)}]`);

    // 5. Send prompt to smart, code-savvy LLM.
    console.log(`[Step 5: Ask the smart LLM]`);
    const wrappedResult =
        await context.modelContext.answerMaker.translate(prompt);
    // console.log(`[${JSON.stringify(wrappedResult, undefined, 2).slice(0, 1000)}]`);
    if (!wrappedResult.success) {
        return createActionResultFromError(
            `Failed to get an answer: ${wrappedResult.message}`,
        );
    }
    const result = wrappedResult.data;

    // 6. Extract answer and references from result.
    const answer = result.answer;
    // TODO: References

    // 7. Produce an action result from that.
    const entities: Entity[] = []; // TODO: Construct from references
    return createActionResultFromMarkdownDisplay(answer, entities);
}

function prepChunk(
    chunkDesc: ChunkDescription,
    allChunks: Chunk[],
): Chunk | undefined {
    const chunks = allChunks.filter((chunk) => chunk.id === chunkDesc.chunkid);
    if (chunks.length !== 1) return undefined;
    return chunks[0];
}

async function selectChunks(
    context: SpelunkerContext,
    chunks: Chunk[],
    input: string,
): Promise<ChunkDescription[]> {
    console.log("Starting chunk selection ...");
    const promises: Promise<ChunkDescription[]>[] = [];
    // TODO: Throttle if too many concurrent calls (e.g. > AZURE_OPENAI_MAX_CONCURRENCY)
    console.log(`max = ${process.env.AZURE_OPENAI_MAX_CONCURRENCY}`);
    const max = parseInt(process.env.AZURE_OPENAI_MAX_CONCURRENCY ?? "0") ?? 40;
    const chunksPerJob =
        chunks.length / max < 10 ? 10 : Math.ceil(chunks.length / max);
    for (let i = 0; i < chunks.length; i += chunksPerJob) {
        const slice = chunks.slice(i, i + chunksPerJob);
        const p = selectRelevantChunks(
            context.modelContext.chunkSelector,
            slice,
            input,
        );
        promises.push(p);
    }
    const allChunks: ChunkDescription[] = [];
    for (const p of promises) {
        const chunks = await p;
        if (chunks.length) {
            console.log(
                "Pushing",
                chunks.length,
                "for",
                chunks[0].chunkid,
                "--",
                chunks[chunks.length - 1].chunkid,
            );
            allChunks.push(...chunks);
        }
    }
    console.log("Total", allChunks.length, "chunks");
    allChunks.sort((a, b) => b.relevance - a.relevance);
    allChunks.splice(30);
    console.log("Keeping", allChunks.length, "chunks");
    // console.log(allChunks.map((c) => [c.chunkid, c.relevance]));
    return allChunks;
}

async function selectRelevantChunks(
    selector: TypeChatJsonTranslator<SelectorSpecs>,
    chunks: Chunk[],
    input: string,
): Promise<ChunkDescription[]> {
    const prompt = `\
Please select up to 30 chunks that are relevant to the user question.
Consider carefully how relevant each chunk is to the user question.
Provide a relevance scsore between 0 and 1 (float).
Report only the chunk ID and relevance for each selected chunk.
Omit irrelevant chunks. It's fine to select fewer than 30.

User question: "{input}"

Chunks: ${prepareChunks(chunks)}
`;
    // console.log(prompt);
    const wrappedResult = await selector.translate(prompt);
    // console.log(wrappedResult);
    if (!wrappedResult.success) {
        console.log(`[Error selecting chunks: ${wrappedResult.message}]`);
        return [];
    }
    const result = wrappedResult.data;
    return result.chunks;
}

function prepareChunks(chunks: Chunk[]): string {
    return JSON.stringify(chunks, undefined, 2);
}

function createAnswerMaker(
    model: ChatModel,
): TypeChatJsonTranslator<AnswerSpecs> {
    const typeName = "AnswerSpecs";
    const schema = loadSchema(["makeAnswerSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<AnswerSpecs>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<AnswerSpecs>(model, validator);
    return translator;
}

function createChunkSelector(
    model: ChatModel,
): TypeChatJsonTranslator<SelectorSpecs> {
    const typeName = "SelectorSpecs";
    const schema = loadSchema(["makeSelectorSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<SelectorSpecs>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<SelectorSpecs>(model, validator);
    return translator;
}

/**
 * Recursively gathers all .py files under a given directory synchronously.
 *
 * @param dir - The directory to search within.
 * @returns An array of absolute paths to .py files.
 *
 * (Written by ChatGPT)
 */
function getAllPyFilesSync(dir: string): string[] {
    let results: string[] = [];

    // Resolve the directory to an absolute path
    const absoluteDir = path.isAbsolute(dir) ? dir : path.resolve(dir);

    // Read the contents of the directory
    const list = fs.readdirSync(absoluteDir);

    list.forEach((file) => {
        const filePath = path.join(absoluteDir, file);
        const stat = fs.statSync(filePath);

        if (stat && !stat.isSymbolicLink() && stat.isDirectory()) {
            // Recursively search in subdirectories
            results = results.concat(getAllPyFilesSync(filePath));
        } else if (stat && stat.isFile() && path.extname(file) === ".py") {
            // If it's a .py file, add to the results
            results.push(filePath);
        }
    });

    return results;
}

// Should be in actionHelpers.ts
function createActionResultFromMarkdownDisplay(
    markdownText: string,
    entities?: Entity[],
): ActionResultSuccess {
    return {
        literalText: markdownText,
        entities: entities ?? [],
        displayContent: { type: "markdown", content: markdownText },
    };
}
