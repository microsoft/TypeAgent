// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createObjectFolder, ObjectFolder } from "typeagent";
import { Chunk } from "./pythonChunker.js";
import { openai, ChatModel } from "aiclient";
import { createFakeCodeDocumenter, createFileDocumenter, FileDocumenter } from "./fileDocumenter.js";
import { CodeDocumentation, CodeDocumenter, createSemanticCodeIndex, SemanticCodeIndex } from "code-processor";

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
        return instance;
    }
}
