// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ScoredItem,
    createEmbeddingFolder,
    createObjectFolder,
    createSemanticIndex,
} from "typeagent";
import { CodeBlock, StoredCodeBlock } from "./code.js";
import { CodeReviewer } from "./codeReviewer.js";
import { TextEmbeddingModel } from "aiclient";
import path from "path";

export interface SemanticCodeIndex {
    find(question: string, maxMatches: number): Promise<ScoredItem<string>[]>;
    get(name: string): Promise<StoredCodeBlock | undefined>;
    put(
        code: CodeBlock,
        name: string,
        sourcePath?: string | undefined,
    ): Promise<string>;
    remove(name: string): Promise<void>;
}

export async function createSemanticCodeIndex(
    folderPath: string,
    codeReviewer: CodeReviewer,
    embeddingModel?: TextEmbeddingModel,
): Promise<SemanticCodeIndex> {
    const embeddingFolder = await createEmbeddingFolder(
        path.join(folderPath, "embeddings"),
    );
    const codeIndex = createSemanticIndex(embeddingFolder, embeddingModel);
    const codeStore = await createObjectFolder<StoredCodeBlock>(
        path.join(folderPath, "code"),
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
    ): Promise<ScoredItem<string>[]> {
        return codeIndex.nearestNeighbors(question, maxMatches);
    }

    async function put(
        code: CodeBlock,
        name: string,
        sourcePath?: string | undefined,
    ): Promise<string> {
        const docs = await codeReviewer.document(code);
        let text = name;
        if (docs.comments) {
            for (const docLine of docs.comments) {
                text += "\n";
                text += docLine.comment;
            }
        }
        await codeIndex.put(text, name);
        await codeStore.put({ code, sourcePath }, name);
        return text;
    }

    function remove(name: string): Promise<void> {
        return codeIndex.store.remove(name);
    }
}
