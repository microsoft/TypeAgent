// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DocMemory,
    DocPart,
    type DocMemorySettings,
    docPartsFromHtml,
    docPartsFromMarkdown,
    docPartsFromText,
    docPartsFromVtt,
} from "@typeagent/conversation-memory";
import * as kp from "@typeagent/knowpro";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    CorpusIndex,
    CorpusIndexMatch,
    IndexedDocument,
    JobProgress,
    MemoryKnowledgeGraph,
} from "./types.js";

const indexBaseName = "corpus";
const basicIndexFileName = "basic-documents.json";
const structuralChunkCharacters = 8_000;
const extractionChunkTokens = 7_500;
const durableDocPartOptions = {
    collectLinkKnowledge: false,
    maxTokensPerPart: extractionChunkTokens,
};

interface EntityKnowledge {
    name: string;
    type: string[];
}

interface TopicKnowledge {
    text: string;
}

interface ActionKnowledge {
    verbs: string[];
    subjectEntityName: string;
    objectEntityName: string;
}

function sourceUri(document: IndexedDocument): string {
    return `typeagent-memory://sources/${encodeURIComponent(document.source.sourceId)}/revisions/${encodeURIComponent(document.revision.revisionId)}`;
}

function toDocParts(document: IndexedDocument): DocPart[] {
    const uri = sourceUri(document);
    const chunkCharacters =
        document.pipeline.maxCharsPerChunk ?? structuralChunkCharacters;
    switch (document.source.sourceType) {
        case "html":
            return docPartsFromHtml(
                document.content,
                false,
                chunkCharacters,
                uri,
                undefined,
                durableDocPartOptions,
            );
        case "markdown":
        case "web":
            return docPartsFromMarkdown(
                document.content,
                chunkCharacters,
                uri,
                durableDocPartOptions,
            );
        case "vtt":
            return docPartsFromVtt(document.content, uri);
        case "text":
            return docPartsFromText(document.content, chunkCharacters, uri);
    }
}

function parseSourceUri(
    uri: string | undefined,
): { sourceId: string; revisionId: string } | undefined {
    if (uri === undefined) {
        return undefined;
    }
    const match =
        /^typeagent-memory:\/\/sources\/([^/]+)\/revisions\/(.+)$/.exec(uri);
    if (match === null) {
        return undefined;
    }
    return {
        sourceId: decodeURIComponent(match[1]),
        revisionId: decodeURIComponent(match[2]),
    };
}

export class KnowProCorpusIndex implements CorpusIndex {
    private memory: DocMemory | undefined;
    private basicDocuments: IndexedDocument[] = [];

    public constructor(
        private readonly corpusId: string,
        private readonly indexDirectory: string,
        private readonly settingsFactory?: () => DocMemorySettings,
    ) {}

    public async initialize(): Promise<void> {
        try {
            this.basicDocuments = JSON.parse(
                await readFile(
                    path.join(this.indexDirectory, basicIndexFileName),
                    "utf8",
                ),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
            this.basicDocuments = [];
        }
        const semanticIndexPath = path.join(
            this.indexDirectory,
            `${indexBaseName}_data.json`,
        );
        const hasSemanticIndex = await access(semanticIndexPath).then(
            () => true,
            () => false,
        );
        if (this.settingsFactory !== undefined || hasSemanticIndex) {
            this.memory = await DocMemory.readFromFile(
                this.indexDirectory,
                indexBaseName,
                this.settingsFactory?.(),
            );
        }
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const startedAt = performance.now();
        const semanticDocuments = documents.filter(
            (document) => document.pipeline.mode !== "basic",
        );
        const parts = semanticDocuments.flatMap(toDocParts);
        this.basicDocuments = documents.filter(
            (document) => document.pipeline.mode === "basic",
        );
        await onProgress({
            completed: parts.length,
            total: parts.length,
            message: "Documents chunked",
            stage: "chunking",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        if (semanticDocuments.length === 0) {
            await kp.removeConversationData(this.indexDirectory, indexBaseName);
            await this.persistBasicDocuments();
            this.memory = undefined;
            await onProgress({
                completed: parts.length,
                total: parts.length,
                message: "Index persisted",
                stage: "persisting",
                operation: "rebuild",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            });
            return;
        }
        const memory = new DocMemory(
            this.corpusId,
            parts,
            this.settingsFactory?.(),
        );
        let completed = 0;
        let progressTail = Promise.resolve();
        const total = Math.max(parts.length, 1);
        const report = (
            message: string,
            stage: NonNullable<JobProgress["stage"]>,
        ): boolean => {
            if (signal.aborted) {
                return false;
            }
            completed = Math.min(completed + 1, total);
            const progress: JobProgress = {
                completed,
                total,
                message,
                stage,
                operation: "rebuild",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            };
            progressTail = progressTail.then(() => onProgress(progress));
            return true;
        };
        const result = await memory.buildIndex({
            onKnowledgeExtracted: () =>
                report("Extracting knowledge", "extracting-knowledge"),
            onEmbeddingsCreated: () =>
                report("Creating embeddings", "embedding"),
            onTextIndexed: () => report("Indexing text", "building-indexes"),
        });
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ingestion cancelled");
        }
        const indexingError =
            result.semanticRefs?.error ??
            result.secondaryIndexResults?.message?.error ??
            result.secondaryIndexResults?.relatedTerms?.error;
        if (indexingError !== undefined) {
            throw new Error(indexingError);
        }
        await progressTail;
        await onProgress({
            completed: total,
            total,
            message: "Persisting index",
            stage: "persisting",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        await memory.writeToFile(this.indexDirectory, indexBaseName);
        await this.persistBasicDocuments();
        this.memory = memory;
        await onProgress({
            completed: total,
            total,
            message: "Index persisted",
            stage: "persisting",
            operation: "rebuild",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
    }

    public async append(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const startedAt = performance.now();
        await this.initialize();
        const semanticDocuments = documents.filter(
            (document) => document.pipeline.mode !== "basic",
        );
        const parts = semanticDocuments.flatMap(toDocParts);
        this.basicDocuments.push(
            ...documents.filter(
                (document) => document.pipeline.mode === "basic",
            ),
        );
        if (semanticDocuments.length === 0) {
            await onProgress({
                completed: parts.length,
                total: parts.length,
                message: "Documents chunked",
                stage: "chunking",
                operation: "append",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            });
            await this.persistBasicDocuments();
            await onProgress({
                completed: parts.length,
                total: parts.length,
                message: "Index persisted",
                stage: "persisting",
                operation: "append",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            });
            return;
        }
        this.memory ??= new DocMemory(
            this.corpusId,
            [],
            this.settingsFactory?.(),
        );
        await onProgress({
            completed: parts.length,
            total: parts.length,
            message: "Documents chunked",
            stage: "chunking",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        for (const part of parts) {
            this.memory.messages.append(part);
        }
        let completed = 0;
        let progressTail = Promise.resolve();
        const total = Math.max(parts.length, 1);
        const report = (
            message: string,
            stage: NonNullable<JobProgress["stage"]>,
        ): boolean => {
            if (signal.aborted) {
                return false;
            }
            completed = Math.min(completed + 1, total);
            const progress: JobProgress = {
                completed,
                total,
                message,
                stage,
                operation: "append",
                elapsedMs: performance.now() - startedAt,
                documentCount: documents.length,
                docPartCount: parts.length,
            };
            progressTail = progressTail.then(() => onProgress(progress));
            return true;
        };
        const result = await this.memory.addToIndex({
            onKnowledgeExtracted: () =>
                report("Extracting knowledge", "extracting-knowledge"),
            onEmbeddingsCreated: () =>
                report("Creating embeddings", "embedding"),
            onTextIndexed: () => report("Indexing text", "building-indexes"),
        });
        if (signal.aborted) {
            throw signal.reason ?? new Error("Ingestion cancelled");
        }
        const indexingError =
            result.semanticRefs?.error ??
            result.secondaryIndexResults?.message?.error ??
            result.secondaryIndexResults?.relatedTerms?.error;
        if (indexingError !== undefined) {
            throw new Error(indexingError);
        }
        await progressTail;
        await onProgress({
            completed: total,
            total,
            message: "Persisting index",
            stage: "persisting",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
        await this.memory.writeToFile(this.indexDirectory, indexBaseName);
        await this.persistBasicDocuments();
        await onProgress({
            completed: total,
            total,
            message: "Index persisted",
            stage: "persisting",
            operation: "append",
            elapsedMs: performance.now() - startedAt,
            documentCount: documents.length,
            docPartCount: parts.length,
        });
    }

    public async search(
        query: string,
        limit: number,
    ): Promise<CorpusIndexMatch[]> {
        const matches = new Map<number, number>();
        if (this.memory !== undefined) {
            const options = kp.createLanguageSearchOptionsTypical();
            options.maxMessageMatches = limit;
            options.maxKnowledgeMatches = limit;
            const result = await this.memory.searchWithLanguage(query, options);
            if (!result.success) {
                throw new Error(result.message);
            }
            for (const searchResult of result.data) {
                for (const match of searchResult.messageMatches) {
                    const previous = matches.get(match.messageOrdinal);
                    if (previous === undefined || match.score > previous) {
                        matches.set(match.messageOrdinal, match.score);
                    }
                }
            }
        }
        const semanticMatches = [...matches]
            .sort((left, right) => right[1] - left[1])
            .slice(0, limit)
            .flatMap(([messageOrdinal, score]) => {
                const message = this.memory?.messages.get(messageOrdinal);
                const source = parseSourceUri(message?.metadata.sourceUrl);
                if (message === undefined || source === undefined) {
                    return [];
                }
                return [
                    {
                        ...source,
                        snippet: message.textChunks.join("\n"),
                        score,
                        locator: `message:${messageOrdinal}`,
                    },
                ];
            });
        const queryTerms = query
            .toLocaleLowerCase()
            .split(/\s+/)
            .filter((term) => term.length > 0);
        const basicMatches = this.basicDocuments.flatMap((document) => {
            const normalizedContent = document.content.toLocaleLowerCase();
            const matchedTerms = queryTerms.filter((term) =>
                normalizedContent.includes(term),
            );
            if (matchedTerms.length === 0) {
                return [];
            }
            const firstMatch = Math.min(
                ...matchedTerms.map((term) => normalizedContent.indexOf(term)),
            );
            const snippetStart = Math.max(0, firstMatch - 200);
            return [
                {
                    sourceId: document.source.sourceId,
                    revisionId: document.revision.revisionId,
                    snippet: document.content.slice(
                        snippetStart,
                        snippetStart + 1_000,
                    ),
                    score: matchedTerms.length / queryTerms.length,
                    locator: `character:${firstMatch}`,
                },
            ];
        });
        return [...semanticMatches, ...basicMatches]
            .sort((left, right) => right.score - left.score)
            .slice(0, limit);
    }

    public async getKnowledgeGraph(
        sourceIds?: ReadonlySet<string>,
    ): Promise<MemoryKnowledgeGraph> {
        if (this.memory === undefined) {
            return { entities: [], topics: [], relationships: [] };
        }
        const entities = new Map<
            string,
            {
                name: string;
                types: Set<string>;
                mentionCount: number;
                sourceIds: Set<string>;
            }
        >();
        const topics = new Map<
            string,
            {
                name: string;
                mentionCount: number;
                sourceIds: Set<string>;
            }
        >();
        const relationships = new Map<
            string,
            {
                fromEntity: string;
                toEntity: string;
                relationshipType: string;
                count: number;
                sourceIds: Set<string>;
            }
        >();

        for (const semanticRef of this.memory.semanticRefs ?? []) {
            const message = this.memory.messages.get(
                semanticRef.range.start.messageOrdinal,
            );
            const sourceId = parseSourceUri(
                message?.metadata.sourceUrl,
            )?.sourceId;
            if (
                sourceIds !== undefined &&
                (sourceId === undefined || !sourceIds.has(sourceId))
            ) {
                continue;
            }
            if (semanticRef.knowledgeType === "entity") {
                const entity = semanticRef.knowledge as EntityKnowledge;
                const key = entity.name.trim().toLocaleLowerCase();
                if (key.length === 0) {
                    continue;
                }
                const aggregate = entities.get(key) ?? {
                    name: entity.name.trim(),
                    types: new Set<string>(),
                    mentionCount: 0,
                    sourceIds: new Set<string>(),
                };
                aggregate.mentionCount++;
                entity.type.forEach((type) => aggregate.types.add(type));
                if (sourceId !== undefined) {
                    aggregate.sourceIds.add(sourceId);
                }
                entities.set(key, aggregate);
            } else if (semanticRef.knowledgeType === "topic") {
                const name = (
                    semanticRef.knowledge as TopicKnowledge
                ).text.trim();
                const key = name.toLocaleLowerCase();
                if (key.length === 0) {
                    continue;
                }
                const aggregate = topics.get(key) ?? {
                    name,
                    mentionCount: 0,
                    sourceIds: new Set<string>(),
                };
                aggregate.mentionCount++;
                if (sourceId !== undefined) {
                    aggregate.sourceIds.add(sourceId);
                }
                topics.set(key, aggregate);
            } else if (semanticRef.knowledgeType === "action") {
                const action = semanticRef.knowledge as ActionKnowledge;
                const fromEntity = action.subjectEntityName.trim();
                const toEntity = action.objectEntityName.trim();
                if (
                    fromEntity.toLocaleLowerCase() === "none" ||
                    toEntity.toLocaleLowerCase() === "none"
                ) {
                    continue;
                }
                const relationshipType = action.verbs.join(" ").trim();
                const key = `${fromEntity.toLocaleLowerCase()}\0${toEntity.toLocaleLowerCase()}\0${relationshipType.toLocaleLowerCase()}`;
                const aggregate = relationships.get(key) ?? {
                    fromEntity,
                    toEntity,
                    relationshipType,
                    count: 0,
                    sourceIds: new Set<string>(),
                };
                aggregate.count++;
                if (sourceId !== undefined) {
                    aggregate.sourceIds.add(sourceId);
                }
                relationships.set(key, aggregate);
            }
        }

        return {
            entities: [...entities.values()].map((entity) => ({
                ...entity,
                types: [...entity.types],
                sourceIds: [...entity.sourceIds],
            })),
            topics: [...topics.values()].map((topic) => ({
                ...topic,
                sourceIds: [...topic.sourceIds],
            })),
            relationships: [...relationships.values()].map((relationship) => ({
                ...relationship,
                sourceIds: [...relationship.sourceIds],
            })),
        };
    }

    private async persistBasicDocuments(): Promise<void> {
        await mkdir(this.indexDirectory, { recursive: true });
        const target = path.join(this.indexDirectory, basicIndexFileName);
        const temporary = `${target}.tmp`;
        await writeFile(temporary, JSON.stringify(this.basicDocuments), "utf8");
        await rename(temporary, target);
    }
}

export function createKnowProCorpusIndex(
    corpusId: string,
    indexDirectory: string,
    settingsFactory?: () => DocMemorySettings,
): CorpusIndex {
    return new KnowProCorpusIndex(corpusId, indexDirectory, settingsFactory);
}
