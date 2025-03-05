// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";

import * as sqlite from "better-sqlite3";

import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

import { ChatModel, openai, TextEmbeddingModel } from "aiclient";
import { loadSchema } from "typeagent";

import { makeEmbeddingModel } from "./embeddings.js";
import { console_log } from "./logging.js";
import { OracleSpecs } from "./oracleSchema.js";
import { SelectorSpecs } from "./selectorSchema.js";
import { SummarizerSpecs } from "./summarizerSchema.js";

export interface QueryContext {
    chatModel: ChatModel;
    miniModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    oracle: TypeChatJsonTranslator<OracleSpecs>;
    chunkSelector: TypeChatJsonTranslator<SelectorSpecs>;
    chunkSummarizer: TypeChatJsonTranslator<SummarizerSpecs>;
    databaseLocation: string;
    database: sqlite.Database | undefined;
}

function captureTokenStats(req: any, response: any): void {
    const inputTokens = response.usage.prompt_tokens;
    const outputTokens = response.usage.completion_tokens;
    const cost = inputTokens * 0.000005 + outputTokens * 0.000015;
    console_log(
        `    [Tokens used: prompt=${inputTokens}, ` +
            `completion=${outputTokens}, ` +
            `cost=\$${cost.toFixed(2)}]`,
    );
}

export function createQueryContext(dbFile?: string): QueryContext {
    const chatModel = openai.createChatModelDefault("spelunkerChat");
    chatModel.completionCallback = captureTokenStats;
    chatModel.retryMaxAttempts = 0;

    const miniModel = openai.createChatModel(
        undefined, // "GPT_4_O_MINI" is slower than default model?!
        undefined,
        undefined,
        ["spelunkerMini"],
    );
    miniModel.completionCallback = captureTokenStats;
    miniModel.retryMaxAttempts = 0;

    const embeddingModel = makeEmbeddingModel();

    const oracle = createTranslator<OracleSpecs>(
        chatModel,
        "oracleSchema.ts",
        "OracleSpecs",
    );
    const chunkSelector = createTranslator<SelectorSpecs>(
        miniModel,
        "selectorSchema.ts",
        "SelectorSpecs",
    );
    const chunkSummarizer = createTranslator<SummarizerSpecs>(
        miniModel,
        "summarizerSchema.ts",
        "SummarizerSpecs",
    );

    const databaseFolder = path.join(
        process.env.HOME ?? "",
        ".typeagent",
        "agents",
        "spelunker",
    );
    const mkdirOptions: fs.MakeDirectoryOptions = {
        recursive: true,
        mode: 0o700,
    };
    fs.mkdirSync(databaseFolder, mkdirOptions);

    const databaseLocation =
        dbFile || path.join(makeDatabaseFolder(), "codeSearchDatabase.db");
    const database = undefined;
    return {
        chatModel,
        miniModel,
        embeddingModel,
        oracle,
        chunkSelector,
        chunkSummarizer,
        databaseLocation,
        database,
    };
}

function makeDatabaseFolder(): string {
    const databaseFolder = path.join(
        process.env.HOME ?? "",
        ".typeagent",
        "agents",
        "spelunker",
    );
    const mkdirOptions: fs.MakeDirectoryOptions = {
        recursive: true,
        mode: 0o700,
    };
    fs.mkdirSync(databaseFolder, mkdirOptions);
    return databaseFolder;
}

function createTranslator<T extends object>(
    model: ChatModel,
    schemaFile: string,
    typeName: string,
): TypeChatJsonTranslator<T> {
    const schema = loadSchema([schemaFile], import.meta.url);
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);
    return translator;
}
