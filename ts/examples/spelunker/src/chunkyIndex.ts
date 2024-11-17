// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, ChatModel, TextEmbeddingModel } from "aiclient";
import { CodeDocumenter } from "code-processor";
import * as knowLib from "knowledge-processor";
import { createObjectFolder, ObjectFolder } from "typeagent";

import {
    createFakeCodeDocumenter,
    createFileDocumenter,
    FileDocumenter,
} from "./fileDocumenter.js";
import { Chunk, ChunkId } from "./pythonChunker.js";

// A bundle of object stores and indices etc.
export class ChunkyIndex {
    rootDir: string;
    chatModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    fileDocumenter: FileDocumenter;
    fakeCodeDocumenter: CodeDocumenter;
    // The rest are asynchronously initialized by initialize().
    chunkFolder!: ObjectFolder<Chunk>;
    codeSummariesIndex!: knowLib.TextIndex<string, ChunkId>;
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
        this.fakeCodeDocumenter = createFakeCodeDocumenter();
    }

    static async createInstance(rootDir: string): Promise<ChunkyIndex> {
        const instance = new ChunkyIndex(rootDir);
        instance.chunkFolder = await createObjectFolder<Chunk>(
            instance.rootDir + "/chunks",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.codeSummariesIndex = await makeIndex("code-summaries");
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
}
