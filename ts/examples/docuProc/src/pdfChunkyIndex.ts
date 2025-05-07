// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, ChatModel, TextEmbeddingModel } from "aiclient";
import * as knowLib from "knowledge-processor";
import { createObjectFolder, loadSchema, ObjectFolder } from "typeagent";

import { createPdfDocumenter, PdfFileDocumenter } from "./pdfFileDocumenter.js";
import { Chunk, ChunkId } from "./pdfChunker.js";
import { QuerySpecs } from "./pdfDocQuerySchema.js";
import { createJsonTranslator, TypeChatJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { AnswerSpecs } from "./pdfDocAnswerSchema.js";

export const IndexNames = [
    "summaries",
    "keywords",
    "tags",
    "synonyms",
    "docinfos",
];
export type IndexType = (typeof IndexNames)[number];
export type NamedIndex = [IndexType, knowLib.TextIndex<string, ChunkId>];

// A bundle of object stores and indexes etc.
export class ChunkyIndex {
    chatModel: ChatModel;
    miniModel: ChatModel; // E.g. gpt-3.5-turbo or gpt-4-mini or o1-mini.
    embeddingModel: TextEmbeddingModel;
    fileDocumenter: PdfFileDocumenter;
    queryMaker: TypeChatJsonTranslator<QuerySpecs>;
    answerMaker: TypeChatJsonTranslator<AnswerSpecs>;

    // The rest are asynchronously initialized by reInitialize(rootDir).
    rootDir!: string;
    answerFolder!: ObjectFolder<AnswerSpecs>;
    chunkFolder!: ObjectFolder<Chunk>;
    indexes!: Map<IndexType, knowLib.TextIndex<string, ChunkId>>;

    private constructor() {
        this.chatModel = openai.createJsonChatModel("GPT_4_O_MINI", [
            "DocuProc",
        ]);
        this.miniModel = openai.createChatModel(
            "GPT_35_TURBO",
            undefined,
            undefined,
            ["DocuProcMini"],
        );
        this.embeddingModel = knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(),
            1000,
        );
        this.fileDocumenter = createPdfDocumenter(this.chatModel);
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
        instance.answerFolder = await createObjectFolder<AnswerSpecs>(
            instance.rootDir + "/answers",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.indexes = new Map();
        for (const name of IndexNames) {
            instance.indexes.set(name, await makeIndex(name));
        }

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
        return [...this.indexes.entries()];
    }
}

function createQueryMaker(
    model: ChatModel,
): TypeChatJsonTranslator<QuerySpecs> {
    const typeName = "QuerySpecs";
    const schema = loadSchema(
        ["pdfDocQuerySchema.ts", "pdfDocAnswerSchema.ts"],
        import.meta.url,
    );
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
    const schema = loadSchema(["pdfDocAnswerSchema.ts"], import.meta.url);
    const validator = createTypeScriptJsonValidator<AnswerSpecs>(
        schema,
        typeName,
    );
    const translator = createJsonTranslator<AnswerSpecs>(model, validator);
    return translator;
}
