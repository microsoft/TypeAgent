// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import { ChatModel, openai } from "aiclient";
import { loadSchema } from "typeagent";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { ActionResult, ActionResultSuccess, Entity } from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";

import { AnswerSpecs } from "./makeAnswerSchema.js";
import { SpelunkerContext } from "./spelunkerActionHandler.js";

export interface ModelContext {
    chatModel: ChatModel;
    answerMaker: TypeChatJsonTranslator<AnswerSpecs>;
    // miniModel: ChatModel;
    // chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
}

export function createModelContext(): ModelContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    const answerMaker = createAnswerMaker(chatModel);
    return { chatModel, answerMaker };
}

// Answer a question; called from request and from answerQuestion action
export async function answerQuestion(
    context: SpelunkerContext,
    input: string,
): Promise<ActionResult> {
    if (!context.focusFolders.length) {
        return createActionResultFromError("Please set the focus to a folder");
    }
    // 1. Find all .py files in the focus directories
    const files: string[] = [];
    for (let i = 0; i < context.focusFolders.length; i++) {
        files.push(...getAllPyFilesSync(context.focusFolders[i]));
    }

    // 2. Construct a prompt from those files
    const preppedFiles = files.map((file) => prepareFile(file)).join("\n\n");
    const prompt = `\
Please answer the user question using the given context (both given below).

User question: "${input.trim()}"

Context (use the filename as ChunkId):

${preppedFiles}
`;

    // 3. Send prompt to LLM
    const wrappedResult = await context.modelContext.answerMaker.translate(prompt);
    if (!wrappedResult.success) {
        return createActionResultFromError(
            `Failed to get an answer: ${wrappedResult.message}`,
        );
    }
    const result = wrappedResult.data;

    // 4. Extract answer and references from result
    const answer = result.answer;

    // 5. Produce an action result from that
    const entities: Entity[] = []; // TODO
    return createActionResultFromMarkdownDisplay(answer, entities);
}

// Given a file name, return the contents of the file,
// marked up with line numbers and preceded by the full file name
// block identifier.
function prepareFile(file: string): string {
    const contents = fs.readFileSync(file, "utf8");
    const lines = contents.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        lines[i] = `${i + 1}. ${lines[i]}`;
    }
    lines.splice(0, 0, `#### ${file} ####`);
    lines.push("###### end ######");
    return lines.join("\n");
}

// For SpelunkerContext
export function createAnswerMaker(
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
