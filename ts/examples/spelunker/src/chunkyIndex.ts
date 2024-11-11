// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { openai, ChatModel } from "aiclient";
import {
    CodeDocumenter,
    createSemanticCodeIndex,
    SemanticCodeIndex,
} from "code-processor";
import * as knowLib from "knowledge-processor";
import { createObjectFolder, ObjectFolder } from "typeagent";

import { CodeDocumentation } from "./codeDocSchema.js";
import {
    createFakeCodeDocumenter,
    createFileDocumenter,
    FileDocumenter,
} from "./fileDocumenter.js";
import { Chunk } from "./pythonChunker.js";

// A bundle of object stores and indices etc.
export class ChunkyIndex {
    rootDir: string;
    chatModel: ChatModel;
    fileDocumenter: FileDocumenter;
    fakeCodeDocumenter: CodeDocumenter;
    // The rest are asynchronously initialized by initialize().
    chunkFolder!: ObjectFolder<Chunk>;
    codeIndex!: SemanticCodeIndex;
    summaryFolder!: ObjectFolder<CodeDocumentation>;
    keywordsFolder!: knowLib.KeyValueIndex<string, string>;
    topicsFolder!: knowLib.KeyValueIndex<string, string>;
    goalsFolder!: knowLib.KeyValueIndex<string, string>;
    dependenciesFolder!: knowLib.KeyValueIndex<string, string>;

    private constructor(rootDir: string) {
        this.rootDir = rootDir;
        this.chatModel = openai.createChatModelDefault("spelunkerChat");
        this.fileDocumenter = createFileDocumenter(this.chatModel);
        this.fakeCodeDocumenter = createFakeCodeDocumenter();
    }

    static async createInstance(rootDir: string): Promise<ChunkyIndex> {
        const instance = new ChunkyIndex(rootDir);
        instance.chunkFolder = await createObjectFolder<Chunk>(
            instance.rootDir + "/chunks",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.codeIndex = await createSemanticCodeIndex(
            instance.rootDir + "/index",
            instance.fakeCodeDocumenter,
            undefined,
            (obj) => JSON.stringify(obj, null, 2),
        );
        instance.summaryFolder = await createObjectFolder<CodeDocumentation>(
            instance.rootDir + "/summaries",
            { serializer: (obj) => JSON.stringify(obj, null, 2) },
        );
        instance.keywordsFolder = await knowLib.createIndexFolder<string>(
            instance.rootDir + "/keywords",
        );
        instance.topicsFolder = await knowLib.createIndexFolder<string>(
            instance.rootDir + "/topics",
        );
        instance.goalsFolder = await knowLib.createIndexFolder<string>(
            instance.rootDir + "/goals",
        );
        instance.dependenciesFolder = await knowLib.createIndexFolder<string>(
            instance.rootDir + "/dependencies",
        );
        return instance;
    }
}
