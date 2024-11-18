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

// A bundle of object stores and indexes etc.
export class ChunkyIndex {
    rootDir: string;
    chatModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    fileDocumenter: FileDocumenter;
    queryMaker: TypeChatJsonTranslator<QuerySpecs>;
    // The rest are asynchronously initialized by initialize().
    chunkFolder!: ObjectFolder<Chunk>;
    summariesIndex!: knowLib.TextIndex<string, ChunkId>;
    keywordsIndex!: knowLib.TextIndex<string, ChunkId>;
    topicsIndex!: knowLib.TextIndex<string, ChunkId>;
    goalsIndex!: knowLib.TextIndex<string, ChunkId>;
    dependenciesIndex!: knowLib.TextIndex<string, ChunkId>;

    private constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.chatModel = openai.createChatModelDefault("spelunkerChat");
        this.embeddingModel = knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(),
            1000,
        );
        this.fileDocumenter = createFileDocumenter(this.chatModel);
        this.queryMaker = createQueryMaker(this.chatModel);
    }

    static async createInstance(rootDir: string): Promise<ChunkyIndex> {
        const instance = new ChunkyIndex(rootDir);
        instance.chunkFolder = await createObjectFolder<Chunk>(
            instance.rootDir + "/chunks",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.summariesIndex = await makeIndex("summaries");
        instance.keywordsIndex = await makeIndex("keywords");
        instance.topicsIndex = await makeIndex("topics");
        instance.goalsIndex = await makeIndex("goals");
        instance.dependenciesIndex = await makeIndex("dependencies");

        return instance;

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

    // TODO: Do this type-safe?
    getIndexByName(name: string): knowLib.TextIndex<string, ChunkId> {
        for (const pair of this.allIndexes()) {
            if (pair.name === name) {
                return pair.index;
            }
        }
        throw new Error(`Unknown index: ${name}`);
    }

    allIndexes(): {
        name: string;
        index: knowLib.TextIndex<string, ChunkId>;
    }[] {
        return [
            { name: "summaries", index: this.summariesIndex },
            { name: "keywords", index: this.keywordsIndex },
            { name: "topics", index: this.topicsIndex },
            { name: "goals", index: this.goalsIndex },
            { name: "dependencies", index: this.dependenciesIndex },
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
