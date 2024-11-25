// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, ChatModel, TextEmbeddingModel } from "aiclient";
import * as knowLib from "knowledge-processor";
import { createObjectFolder, loadSchema, ObjectFolder } from "typeagent";

import { createFileDocumenter, FileDocumenter } from "./fileDocumenter.js";
import { Chunk, ChunkId } from "./pythonChunker.js";
import { QuerySpecs } from "./makeQuerySchema.js";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { AnswerSpecs } from "./makeAnswerSchema.js";

export type IndexType =
    | "summaries"
    | "keywords"
    | "topics"
    | "goals"
    | "dependencies";
export type NamedIndex = [IndexType, knowLib.TextIndex<string, ChunkId>];

// A bundle of object stores and indexes etc.
export class ChunkyIndex {
    chatModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    fileDocumenter: FileDocumenter;
    queryMaker: TypeChatJsonTranslator<QuerySpecs>;
    answerMaker: TypeChatJsonTranslator<AnswerSpecs>;

    // The rest are asynchronously initialized by reInitialize(rootDir).
    rootDir!: string;
    chunkFolder!: ObjectFolder<Chunk>;
    summariesIndex!: knowLib.TextIndex<string, ChunkId>;
    keywordsIndex!: knowLib.TextIndex<string, ChunkId>;
    topicsIndex!: knowLib.TextIndex<string, ChunkId>;
    goalsIndex!: knowLib.TextIndex<string, ChunkId>;
    dependenciesIndex!: knowLib.TextIndex<string, ChunkId>;

    private constructor() {
        this.chatModel = openai.createChatModelDefault("spelunkerChat");
        this.embeddingModel = knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(),
            1000,
        );
        this.fileDocumenter = createFileDocumenter(this.chatModel);
        this.queryMaker = createQueryMaker(this.chatModel);
        this.answerMaker = createAnswerMaker(this.chatModel);
    }

    static async createInstance(rootDir: string): Promise<ChunkyIndex> {
        const instance = new ChunkyIndex();
        await instance.reInitialize(rootDir);
        return instance;
    }

    async reInitialize(rootDir: string): Promise<void> {
        const instance = this; // So makeIndex can see it.
        instance.rootDir = rootDir;
        instance.chunkFolder = await createObjectFolder<Chunk>(
            instance.rootDir + "/chunks",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.summariesIndex = await makeIndex("summaries");
        instance.keywordsIndex = await makeIndex("keywords");
        instance.topicsIndex = await makeIndex("topics");
        instance.goalsIndex = await makeIndex("goals");
        instance.dependenciesIndex = await makeIndex("dependencies");

        async function makeIndex(
            name: string,
        ): Promise<knowLib.TextIndex<string, ChunkId>> {
            return await knowLib.createTextIndex<ChunkId>(
                {
                    caseSensitive: false,
                    concurrency: 4,
                    semanticIndex: true,
                    embeddingModel: instance.embeddingModel,
                },
                instance.rootDir + "/" + name,
            );
        }
    }

    getIndexByName(indexName: IndexType): knowLib.TextIndex<string, ChunkId> {
        for (const [name, index] of this.allIndexes()) {
            if (name === indexName) {
                return index;
            }
        }
        throw new Error(`Unknown index: ${indexName}`);
    }

    allIndexes(): NamedIndex[] {
        return [
            ["summaries", this.summariesIndex],
            ["keywords", this.keywordsIndex],
            ["topics", this.topicsIndex],
            ["goals", this.goalsIndex],
            ["dependencies", this.dependenciesIndex],
        ];
    }
}

function createQueryMaker(
    model: ChatModel,
): TypeChatJsonTranslator<QuerySpecs> {
    const typeName = "QuerySpecs";
    const schema = loadSchema(["makeQuerySchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<QuerySpecs>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<QuerySpecs>(model, validator);
    return translator;
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
