// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ObjectFolderSettings,
    ObjectSerializer,
    ScoredItem,
    createEmbeddingFolder,
    createObjectFolder,
    createSemanticIndex,
} from "typeagent";
import { CodeBlock, StoredCodeBlock } from "./code.js";
import { TextEmbeddingModel } from "aiclient";
import path from "path";
import { CodeDocumentation } from "./codeDocSchema.js";

export interface SemanticCodeIndex {
    find(
        question: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<string>[]>;
    get(name: string): Promise<StoredCodeBlock | undefined>;
    put(
        code: CodeBlock,
        name: string,
        sourcePath?: string | undefined,
    ): Promise<CodeDocumentation>;
    remove(name: string): Promise<void>;
}

// A subset of CodeReviewer -- this is all we use of the latter.
export interface CodeDocumenter {
    document(code: CodeBlock): Promise<CodeDocumentation>;
}

export async function createSemanticCodeIndex(
    folderPath: string,
    codeReviewer: CodeDocumenter,
    embeddingModel?: TextEmbeddingModel,
    objectSerializer?: ObjectSerializer,
): Promise<SemanticCodeIndex> {
    const embeddingFolder = await createEmbeddingFolder(
        path.join(folderPath, "embeddings"),
    );
    const codeIndex = createSemanticIndex(embeddingFolder, embeddingModel);
    const codeStoreSettings: ObjectFolderSettings = {};
    if (objectSerializer) {
        codeStoreSettings.serializer = objectSerializer;
    }
    const codeStore = await createObjectFolder<StoredCodeBlock>(
        path.join(folderPath, "code"),
        codeStoreSettings,
    );
    return {
        find,
        get: (name) => codeStore.get(name),
        put,
        remove,
    };

    async function find(
        question: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<string>[]> {
        return codeIndex.nearestNeighbors(question, maxMatches, minScore);
    }

    async function put(
        code: CodeBlock,
        name: string,
        sourcePath?: string | undefined,
    ): Promise<CodeDocumentation> {
        const docs = await codeReviewer.document(code);
        let text = name;
        if (docs.comments) {
            for (const docLine of docs.comments) {
                text += `\n${docLine.lineNumber}: ${docLine.comment}`;
            }
        }
        await codeIndex.put(text, name);
        await codeStore.put({ code, sourcePath }, name);
        return docs;
    }

    function remove(name: string): Promise<void> {
        return codeIndex.store.remove(name);
    }
}
