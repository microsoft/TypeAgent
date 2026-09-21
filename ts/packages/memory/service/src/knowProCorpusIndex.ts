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
import type {
    CorpusIndex,
    CorpusIndexMatch,
    IndexedDocument,
    JobProgress,
    MemoryKnowledgeGraph,
} from "./types.js";

const indexBaseName = "corpus";

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
    switch (document.source.sourceType) {
        case "html":
            return docPartsFromHtml(document.content, false, 8_000, uri);
        case "markdown":
        case "web":
            return docPartsFromMarkdown(document.content, 8_000, uri);
        case "vtt":
            return docPartsFromVtt(document.content, uri);
        case "text":
            return docPartsFromText(document.content, 8_000, uri);
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

    public constructor(
        private readonly corpusId: string,
        private readonly indexDirectory: string,
        private readonly settingsFactory?: () => DocMemorySettings,
    ) {}

    public async initialize(): Promise<void> {
        this.memory = await DocMemory.readFromFile(
            this.indexDirectory,
            indexBaseName,
            this.settingsFactory?.(),
        );
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const parts = documents.flatMap(toDocParts);
        const memory = new DocMemory(
            this.corpusId,
            parts,
            this.settingsFactory?.(),
        );
        let completed = 0;
        let progressTail = Promise.resolve();
        const total = Math.max(parts.length, 1);
        const report = (message: string): boolean => {
            if (signal.aborted) {
                return false;
            }
            completed = Math.min(completed + 1, total);
            const progress = { completed, total, message };
            progressTail = progressTail.then(() => onProgress(progress));
            return true;
        };
        const result = await memory.buildIndex({
            onKnowledgeExtracted: () => report("Extracting knowledge"),
            onEmbeddingsCreated: () => report("Creating embeddings"),
            onTextIndexed: () => report("Indexing text"),
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
        await memory.writeToFile(this.indexDirectory, indexBaseName);
        this.memory = memory;
        await onProgress({
            completed: total,
            total,
            message: "Index persisted",
        });
    }

    public async search(
        query: string,
        limit: number,
    ): Promise<CorpusIndexMatch[]> {
        if (this.memory === undefined) {
            throw new Error(`Corpus '${this.corpusId}' has not been indexed`);
        }
        const options = kp.createLanguageSearchOptionsTypical();
        options.maxMessageMatches = limit;
        options.maxKnowledgeMatches = limit;
        const result = await this.memory.searchWithLanguage(query, options);
        if (!result.success) {
            throw new Error(result.message);
        }
        const matches = new Map<number, number>();
        for (const searchResult of result.data) {
            for (const match of searchResult.messageMatches) {
                const previous = matches.get(match.messageOrdinal);
                if (previous === undefined || match.score > previous) {
                    matches.set(match.messageOrdinal, match.score);
                }
            }
        }
        return [...matches]
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
    }

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        if (this.memory === undefined) {
            throw new Error(`Corpus '${this.corpusId}' has not been indexed`);
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
}

export function createKnowProCorpusIndex(
    corpusId: string,
    indexDirectory: string,
    settingsFactory?: () => DocMemorySettings,
): CorpusIndex {
    return new KnowProCorpusIndex(corpusId, indexDirectory, settingsFactory);
}
