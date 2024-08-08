// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ScoredItem,
    createEmbeddingFolder,
    createSemanticIndex,
} from "typeagent";
import { CodeBlock } from "./code.js";
import { CodeReviewer } from "./codeReviewer.js";
import { TextEmbeddingModel } from "aiclient";

export interface SemanticCodeIndex {
    find(question: string, maxMatches: number): Promise<ScoredItem<string>[]>;
    put(code: CodeBlock, name: string): Promise<string>;
    remove(name: string): Promise<void>;
}

export async function createSemanticCodeIndex(
    folderPath: string,
    codeReviewer: CodeReviewer,
    embeddingModel?: TextEmbeddingModel,
): Promise<SemanticCodeIndex> {
    const embeddingFolder = await createEmbeddingFolder(folderPath);
    const codeIndex = createSemanticIndex(embeddingFolder, embeddingModel);
    return {
        find,
        put,
        remove,
    };

    async function find(
        question: string,
        maxMatches: number,
    ): Promise<ScoredItem<string>[]> {
        return codeIndex.nearestNeighbors(question, maxMatches);
    }

    async function put(code: CodeBlock, name: string): Promise<string> {
        const docs = await codeReviewer.document(code);
        let text = name;
        if (docs.comments) {
            for (const docLine of docs.comments) {
                text += "\n";
                text += docLine.comment;
            }
        }
        await codeIndex.put(text, name);
        return text;
    }

    function remove(name: string): Promise<void> {
        return codeIndex.store.remove(name);
    }
}
