// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createKnowledgeStore,
    createSemanticIndexFolder,
    KnowledgeStore,
    TextIndexSettings,
} from "knowledge-processor";
import { CodeBlock, StoredCodeBlock } from "./code.js";
import {
    asyncArray,
    FileSystem,
    ObjectFolderSettings,
    ScoredItem,
} from "typeagent";
import path from "path";
import { TextEmbeddingModel } from "aiclient";
import { CodeReviewer } from "./codeReviewer.js";
import { CodeReview, LineReview, Severity } from "./codeReviewSchema.js";

export type CodeBlockName = {
    name: string;
    namespace?: string | undefined;
};

export function codeBlockNameFromFilePath(
    filePath: string,
    name?: string,
): CodeBlockName {
    const ext = path.extname(filePath);
    let namespace: string | undefined;
    if (name) {
        namespace = path.basename(filePath, ext);
    } else {
        name = path.basename(filePath, ext);
        namespace = path.basename(path.dirname(filePath));
    }
    return { name, namespace };
}

export function codeBlockNameToString(cbName: CodeBlockName): string {
    return cbName.namespace
        ? `${cbName.namespace}.${cbName.name}`
        : cbName.name;
}

export type DeveloperMemorySettings = {
    codeReviewer: CodeReviewer;
    embeddingModel?: TextEmbeddingModel;
};

export interface DeveloperMemory<TCodeId = any, TReviewId = any> {
    readonly settings: DeveloperMemorySettings;
    readonly codeStore: KnowledgeStore<StoredCodeBlock>;
    readonly bugs: CodeReviewIndex<TReviewId, TCodeId>;
    readonly comments: CodeReviewIndex<TReviewId, TCodeId>;
    add(
        codeBlock: StoredCodeBlock,
        name: CodeBlockName,
        timestamp?: Date,
    ): Promise<TCodeId>;
    addReview(name: CodeBlockName | TCodeId, review: CodeReview): Promise<void>;
    get(name: CodeBlockName): Promise<StoredCodeBlock | undefined>;
    getId(name: CodeBlockName): TCodeId;
    getById(id: TCodeId): Promise<StoredCodeBlock | undefined>;
    searchCode(
        query: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<TCodeId>[]>;
}

export async function createDeveloperMemory(
    settings: DeveloperMemorySettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<DeveloperMemory<string, string>> {
    type CodeId = string;
    const textIndexSettings = createTextIndexSettings();
    const codeStore = await createKnowledgeStore<StoredCodeBlock>(
        textIndexSettings,
        rootPath,
        folderSettings,
    );
    const codeIndex = await createSemanticIndexFolder(
        rootPath,
        folderSettings,
        textIndexSettings.concurrency,
        textIndexSettings.embeddingModel,
        fSys,
    );
    const bugs = await createCodeReviewIndex<CodeId>(
        textIndexSettings,
        path.join(rootPath, "bugs"),
        folderSettings,
        fSys,
    );
    const comments = await createCodeReviewIndex<CodeId>(
        textIndexSettings,
        path.join(rootPath, "comments"),
        folderSettings,
        fSys,
    );
    return {
        settings,
        codeStore,
        bugs,
        comments,
        add,
        addReview,
        get,
        getId,
        getById,
        searchCode,
    };

    async function add(
        codeBlock: StoredCodeBlock,
        name: CodeBlockName,
        timestamp?: Date,
    ): Promise<CodeId> {
        const codeId = getId(name);
        await codeStore.store.put(codeBlock, codeId);
        await Promise.all([
            codeStore.sequence.put([codeId], timestamp),
            updateCodeIndex(name, codeBlock.code, codeId),
        ]);

        return codeId;
    }

    async function addReview(
        name: CodeBlockName | CodeId,
        review: CodeReview,
    ): Promise<void> {
        const codeId = typeof name === "string" ? name : getId(name);
        await Promise.all([
            addBugs(codeId, review),
            addComments(codeId, review),
        ]);
    }

    async function addBugs(codeId: CodeId, review: CodeReview): Promise<void> {
        if (review.bugs && review.bugs.length > 0) {
            await bugs.add(codeId, review.bugs);
        }
    }

    async function addComments(
        codeId: CodeId,
        review: CodeReview,
    ): Promise<void> {
        if (review.comments && review.comments.length > 0) {
            await comments.add(codeId, review.comments);
        }
    }

    function get(name: CodeBlockName): Promise<StoredCodeBlock | undefined> {
        return codeStore.get(getId(name));
    }

    function getId(name: CodeBlockName): string {
        return codeBlockNameToString(name);
    }

    function getById(id: string): Promise<StoredCodeBlock | undefined> {
        return codeStore.get(id);
    }

    async function searchCode(
        query: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ScoredItem<CodeId>[]> {
        return codeIndex.nearestNeighbors(query, maxMatches, minScore);
    }

    async function updateCodeIndex(
        name: CodeBlockName,
        code: CodeBlock,
        codeId: string,
    ): Promise<void> {
        const documentation = await documentCodeBlock(name, code);
        await codeIndex.put(documentation, codeId);
    }

    async function documentCodeBlock(
        name: CodeBlockName,
        code: CodeBlock,
    ): Promise<string> {
        const docs = await settings.codeReviewer.document(code);
        let text = codeBlockNameToString(name);
        if (docs.comments) {
            for (const docLine of docs.comments) {
                text += "\n";
                text += docLine.comment;
            }
        }
        return text;
    }

    function createTextIndexSettings(): TextIndexSettings {
        return {
            embeddingModel: settings.embeddingModel,
            semanticIndex: true,
            caseSensitive: false,
            concurrency: 2,
        };
    }
}

export type ExtractedCodeReview<TSourceId = any> = {
    value: LineReview;
    sourceId: TSourceId;
};

export type CodeReviewFilter = {
    severity?: Severity | undefined;
};

export interface CodeReviewIndex<TReviewId = any, TSourceId = any> {
    readonly store: KnowledgeStore<ExtractedCodeReview, TReviewId>;
    add(sourceId: TSourceId, review: LineReview[]): Promise<TReviewId[]>;
    search(
        query: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<TReviewId[]>;
}

export async function createCodeReviewIndex<TSourceId = any>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<CodeReviewIndex<string, TSourceId>> {
    type ReviewId = string;
    const store = await createKnowledgeStore<ExtractedCodeReview<TSourceId>>(
        settings,
        rootPath,
        folderSettings,
        fSys,
    );
    const storeIndex = await createSemanticIndexFolder(
        rootPath,
        folderSettings,
        settings.concurrency,
        settings.embeddingModel,
        fSys,
    );
    return {
        store,
        add,
        search,
    };

    async function add(
        sourceId: TSourceId,
        review: LineReview[],
    ): Promise<ReviewId[]> {
        const items: ExtractedCodeReview<TSourceId>[] = review.map((line) => {
            return {
                value: line,
                sourceId,
            };
        });
        const reviewIds = await asyncArray.mapAsync(
            items,
            settings.concurrency,
            async (item) => addItem(item),
        );
        return reviewIds;
    }

    async function addItem(review: ExtractedCodeReview<TSourceId>) {
        const reviewIds = await store.addNext([review]);
        const reviewId = reviewIds[0];
        const text = lineReviewToString(review.value);
        await storeIndex.put(text, reviewId);
        return reviewId;
    }

    async function search(
        query: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ReviewId[]> {
        const matches = await storeIndex.nearestNeighbors(
            query,
            maxMatches,
            minScore,
        );
        return matches.map((match) => match.item);
    }

    function lineReviewToString(review: LineReview): string {
        return `[${review.severity}]: ${review.comment}`;
    }
}
