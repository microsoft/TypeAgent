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
import { isInitiativeSubject } from "./initiativeDiscovery.js";
import { symbolicIdentity, usefulWikiSubject } from "./wikiGrouping.js";
import { access } from "node:fs/promises";
import path from "node:path";
import {
    indexedTextHash,
    parseIndexedLocator,
    selectIndexedFragments,
    type IndexedBlock,
} from "./indexedFragments.js";
import type {
    CorpusIndex,
    CorpusIndexAnswer,
    CorpusIndexMatch,
    IndexedDocument,
    IndexedSubject,
    IndexedSubjectIdentity,
    IndexedFragmentRequest,
    IndexedFragmentSelection,
    MemoryPage,
    JobProgress,
    MemoryKnowledgeGraph,
} from "./types.js";

const indexBaseName = "corpus";
const structuralChunkCharacters = 8_000;
const extractionChunkTokens = 7_500;
const durableDocPartOptions = {
    collectLinkKnowledge: false,
    collectStructuralKnowledge: false,
    maxTokensPerPart: extractionChunkTokens,
};

interface EntityKnowledge {
    name: string;
    type: string[];
    facets?: Array<{ name: string; value: unknown }>;
}

function initiativeKnowledgeTypes(ref: {
    knowledgeType: string;
    knowledge: unknown;
}): string[] {
    return ref.knowledgeType === "entity"
        ? (ref.knowledge as EntityKnowledge).type
        : [];
}

interface TopicKnowledge {
    text: string;
}

function indexedSubjectIdentity(ref: {
    knowledgeType: string;
    knowledge: unknown;
}): IndexedSubjectIdentity {
    if (ref.knowledgeType !== "entity") return { types: [], scopes: [] };
    const entity = ref.knowledge as EntityKnowledge;
    return {
        types: entity.type,
        scopes: (entity.facets ?? []).flatMap((facet) =>
            /^(project|initiative|episode|scope)$/i.test(facet.name) &&
            typeof facet.value === "string" &&
            facet.value.trim()
                ? [`${facet.name.toLocaleLowerCase()}:${facet.value.trim()}`]
                : [],
        ),
        ...(symbolicIdentity({ types: entity.type, scopes: [] })
            ? { symbols: [entity.name] }
            : {}),
    };
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
    let parts: DocPart[];
    switch (document.source.sourceType) {
        case "html":
            parts = docPartsFromHtml(
                document.content,
                false,
                chunkCharacters,
                uri,
                undefined,
                durableDocPartOptions,
            );
            break;
        case "markdown":
        case "web":
            parts = docPartsFromMarkdown(
                document.content,
                chunkCharacters,
                uri,
                durableDocPartOptions,
            );
            break;
        case "vtt":
            parts = docPartsFromVtt(document.content, uri);
            break;
        case "text":
            parts = docPartsFromText(document.content, chunkCharacters, uri);
            break;
    }
    for (const part of parts) {
        part.tags.push(...(document.indexTags ?? []));
    }
    return parts;
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
            if (hasSemanticIndex && this.memory?.messages.length === 0) {
                throw new Error(
                    `KnowPro semantic index has no messages: '${semanticIndexPath}'`,
                );
            }
        }
    }

    public async listSubjects(
        offset: number,
        limit: number,
        sourceIds: ReadonlySet<string>,
    ): Promise<MemoryPage<IndexedSubject>> {
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 48
        )
            throw new Error("Invalid indexed-subject page bounds");
        const memory = this.memory;
        const items = memory
            ? [...memory.semanticRefIndex.getTerms()].flatMap((term) => {
                  const subject = this.indexedSubject(memory, term, sourceIds);
                  return subject ? [subject] : [];
              })
            : [];
        items.sort((a, b) => a.term.localeCompare(b.term));
        const remaining = new Set(items);
        const fair: IndexedSubject[] = [];
        while (remaining.size) {
            for (const sourceId of [...sourceIds].reverse()) {
                const candidate = [...remaining].find((item) =>
                    item.sourceIds.includes(sourceId),
                );
                if (candidate) {
                    remaining.delete(candidate);
                    fair.push(candidate);
                }
            }
        }
        const next = offset + limit;
        return {
            items: fair.slice(offset, next),
            total: items.length,
            ...(next < items.length
                ? { nextContinuationToken: String(next) }
                : {}),
        };
    }

    private indexedSubject(
        memory: DocMemory,
        term: string,
        sourceIds: ReadonlySet<string>,
    ): IndexedSubject | undefined {
        const sources = new Set<string>();
        let postingCount = 0;
        let initiative = false;
        const types = new Set<string>();
        const scopes = new Set<string>();
        const symbols = new Set<string>();
        for (const posting of memory.semanticRefIndex.lookupTerm(term)) {
            const ref = memory.semanticRefs.get(posting.semanticRefOrdinal);
            const subject =
                ref.knowledgeType === "entity"
                    ? (ref.knowledge as EntityKnowledge).name
                    : ref.knowledgeType === "topic"
                      ? (ref.knowledge as TopicKnowledge).text
                      : undefined;
            if (
                !subject ||
                subject.toLocaleLowerCase() !== term.toLocaleLowerCase()
            )
                continue;
            const message = memory.messages.get(ref.range.start.messageOrdinal);
            const source = parseSourceUri(message.metadata.sourceUrl);
            if (!source || !sourceIds.has(source.sourceId)) continue;
            const text = message.textChunks.join("\n");
            if (!usefulWikiSubject(subject, text)) continue;
            sources.add(source.sourceId);
            postingCount++;
            const identity = indexedSubjectIdentity(ref);
            identity.types.forEach((type) => types.add(type));
            identity.scopes.forEach((scope) => scopes.add(scope));
            identity.symbols?.forEach((symbol) => symbols.add(symbol));
            initiative ||= isInitiativeSubject(
                subject,
                initiativeKnowledgeTypes(ref),
                text,
            );
        }
        return postingCount
            ? {
                  term: symbols.size === 1 ? [...symbols][0] : term,
                  postingCount,
                  sourceIds: [...sources],
                  initiative,
                  identity: {
                      types: [...types].sort(),
                      scopes: [...scopes].sort(),
                      ...(symbols.size ? { symbols: [...symbols].sort() } : {}),
                  },
              }
            : undefined;
    }

    private *indexedBlocks(
        memory: DocMemory,
        scores?: ReadonlyMap<number, number>,
    ): Iterable<IndexedBlock> {
        const ordinals = new Map<string, number>();
        for (
            let messageOrdinal = 0;
            messageOrdinal < memory.messages.length;
            messageOrdinal++
        ) {
            const message = memory.messages.get(messageOrdinal);
            const source = parseSourceUri(message.metadata.sourceUrl);
            if (!source) continue;
            const key = `${source.sourceId}:${source.revisionId}`;
            const blockOrdinal = ordinals.get(key) ?? 0;
            ordinals.set(key, blockOrdinal + 1);
            if (scores && !scores.has(messageOrdinal)) continue;
            yield {
                ...source,
                blockOrdinal,
                text: message.textChunks.join("\n"),
                score: scores?.get(messageOrdinal) ?? 1,
            };
        }
    }

    public async readFragments(
        request: IndexedFragmentRequest,
    ): Promise<IndexedFragmentSelection> {
        const memory = this.memory;
        if (!memory) return { fragments: [], readChars: 0, limited: false };
        const scores = new Map<number, number>();
        const requested = new Set(
            request.terms.flatMap(
                (term) =>
                    term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [],
            ),
        );
        const vocabulary = [...memory.semanticRefIndex.getTerms()];
        const words = [
            ...new Set(
                vocabulary.flatMap(
                    (term) =>
                        term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ??
                        [],
                ),
            ),
        ];
        for (const word of [...requested]) {
            if (word.length < 5) continue;
            for (const match of kp.nearestNeighborEditDistance(
                words,
                word,
                4,
                word.length >= 8 ? 2 : 1,
            ))
                if (match.item.startsWith(word.slice(0, 3)))
                    requested.add(match.item);
        }
        const terms = vocabulary.filter(
            (term) =>
                request.terms.some(
                    (query) =>
                        term.toLocaleLowerCase() === query.toLocaleLowerCase(),
                ) ||
                (term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []).some(
                    (word) => requested.has(word) && word.length > 2,
                ),
        );
        const matches = new Map<number, Set<string>>();
        const typedSubjects = new Map<string, Set<number>>();
        for (const term of terms) {
            const matchedWords = (
                term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []
            ).filter((word) => requested.has(word));
            for (const posting of memory.semanticRefIndex.lookupTerm(term)) {
                const ref = memory.semanticRefs.get(posting.semanticRefOrdinal);
                const start = ref.range.start.messageOrdinal;
                const end = ref.range.end?.messageOrdinal ?? start;
                if (request.query && ref.knowledgeType === "entity") {
                    const entity = ref.knowledge as EntityKnowledge;
                    if (
                        entity.type.some((type) =>
                            requested.has(type.toLocaleLowerCase()),
                        )
                    ) {
                        const ordinals =
                            typedSubjects.get(entity.name) ?? new Set<number>();
                        ordinals.add(start);
                        typedSubjects.set(entity.name, ordinals);
                    }
                }
                for (
                    let ordinal = start;
                    ordinal <= Math.min(end, start + 4);
                    ordinal++
                ) {
                    const words = matches.get(ordinal) ?? new Set<string>();
                    matchedWords.forEach((word) => words.add(word));
                    matches.set(ordinal, words);
                }
            }
        }
        for (const [ordinal, words] of matches)
            scores.set(
                ordinal,
                [...words].reduce(
                    (score, word) =>
                        score +
                        Math.log(
                            1 +
                                memory.messages.length /
                                    [...matches.values()].filter((set) =>
                                        set.has(word),
                                    ).length,
                        ),
                    0,
                ),
            );
        if (request.query) {
            const options = kp.createLanguageSearchOptionsTypical();
            options.maxMessageMatches = 8;
            options.maxKnowledgeMatches = 12;
            const result = await memory.searchWithLanguage(
                request.query ?? request.terms.join(" "),
                options,
            );
            if (!result.success) throw new Error(result.message);
            for (const match of result.data.flatMap(
                (item) => item.messageMatches,
            ))
                scores.set(
                    match.messageOrdinal,
                    (scores.get(match.messageOrdinal) ?? 0) +
                        Math.max(1, match.score),
                );
        }
        const preferred = new Set(
            [...typedSubjects.values()].map(
                (ordinals) =>
                    [...ordinals].sort(
                        (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
                    )[0],
            ),
        );
        if (request.query) {
            const graph = await this.getKnowledgeGraph();
            const matchedSources = new Set(
                graph.entities
                    .filter((item) =>
                        (
                            item.name
                                .toLocaleLowerCase()
                                .match(/[\p{L}\p{N}-]+/gu) ?? []
                        ).some((word) => requested.has(word)),
                    )
                    .flatMap((item) => item.sourceIds),
            );
            for (const entity of graph.entities.filter(
                (item) =>
                    item.types.some((type) =>
                        /correction|follow.?up|qualification/i.test(type),
                    ) &&
                    item.sourceIds.some((sourceId) =>
                        matchedSources.has(sourceId),
                    ),
            )) {
                for (
                    let ordinal = memory.messages.length - 1;
                    ordinal >= 0;
                    ordinal--
                ) {
                    const source = parseSourceUri(
                        memory.messages.get(ordinal).metadata.sourceUrl,
                    );
                    if (source && entity.sourceIds.includes(source.sourceId))
                        preferred.add(ordinal);
                }
            }
        }
        const highest = Math.max(0, ...scores.values());
        for (const ordinal of preferred)
            scores.set(ordinal, highest + (scores.get(ordinal) ?? 0));
        return selectIndexedFragments(
            [...this.indexedBlocks(memory, scores)].sort(
                (a, b) => b.score - a.score,
            ),
            request,
        );
    }

    public async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ): Promise<string> {
        const anchor = parseIndexedLocator(locator);
        const memory = this.memory;
        if (memory)
            for (const block of this.indexedBlocks(memory)) {
                if (
                    block.sourceId === sourceId &&
                    block.revisionId === revisionId &&
                    block.blockOrdinal === anchor.blockOrdinal &&
                    indexedTextHash(block.text) === anchor.hash &&
                    anchor.end <= block.text.length
                )
                    return block.text.slice(anchor.start, anchor.end);
            }
        throw new Error(
            "Indexed-text anchor is unavailable in the current index",
        );
    }

    public async rebuild(
        documents: IndexedDocument[],
        signal: AbortSignal,
        onProgress: (progress: JobProgress) => Promise<void>,
    ): Promise<void> {
        const startedAt = performance.now();
        const parts = documents.flatMap(toDocParts);
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
        if (documents.length === 0) {
            await kp.removeConversationData(this.indexDirectory, indexBaseName);
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
        const parts = documents.flatMap(toDocParts);
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
        tags?: string[],
    ): Promise<CorpusIndexMatch[]> {
        return kp.timeSearchStage(
            "knowpro.index.search",
            () => this.searchCore(query, limit, tags),
            { limit, tagCount: tags?.length ?? 0 },
        );
    }

    private async searchCore(
        query: string,
        limit: number,
        tags?: string[],
    ): Promise<CorpusIndexMatch[]> {
        const matches = new Map<number, number>();
        const memory = this.memory;
        if (memory !== undefined) {
            const options = kp.createLanguageSearchOptionsTypical();
            options.maxMessageMatches = limit;
            options.maxKnowledgeMatches = limit;
            const result = await kp.timeSearchStage(
                "knowpro.index.languageSearch",
                () =>
                    memory.searchWithLanguage(
                        query,
                        options,
                        tags === undefined ? undefined : { tags },
                    ),
            );
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
        return this.toCorpusMatches(matches, limit);
    }

    private toCorpusMatches(
        matches: ReadonlyMap<number, number>,
        limit: number,
    ): CorpusIndexMatch[] {
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

    public async answer(
        query: string,
        limit: number,
        sourceIds?: ReadonlySet<string>,
    ): Promise<CorpusIndexAnswer> {
        const memory = this.memory;
        if (memory === undefined) {
            return { matches: [], whyNoAnswer: "The corpus has no index." };
        }
        const options = kp.createLanguageSearchOptionsTypical();
        options.maxMessageMatches = limit;
        options.maxKnowledgeMatches = limit;
        const searched = await memory.searchWithLanguage(query, options);
        if (!searched.success) {
            throw new Error(searched.message);
        }
        const matches = new Map<number, number>();
        const answers: string[] = [];
        const reasons: string[] = [];
        for (const searchResult of searched.data) {
            let scoped = searchResult;
            if (sourceIds !== undefined) {
                scoped = {
                    ...searchResult,
                    knowledgeMatches: new Map(),
                    messageMatches: searchResult.messageMatches.filter(
                        (match) => {
                            const source = parseSourceUri(
                                memory.messages.get(match.messageOrdinal)
                                    ?.metadata.sourceUrl,
                            );
                            return (
                                source !== undefined &&
                                sourceIds.has(source.sourceId)
                            );
                        },
                    ),
                };
            }
            for (const match of scoped.messageMatches) {
                const previous = matches.get(match.messageOrdinal);
                if (previous === undefined || match.score > previous) {
                    matches.set(match.messageOrdinal, match.score);
                }
            }
            if (
                scoped.messageMatches.length === 0 &&
                scoped.knowledgeMatches.size === 0
            ) {
                continue;
            }
            const generated = await memory.getAnswerFromSearchResults(
                scoped,
                query,
            );
            if (!generated.success) {
                throw new Error(generated.message);
            }
            if (generated.data === undefined) {
                continue;
            }
            if (generated.data.type === "Answered") {
                if (generated.data.answer) {
                    answers.push(generated.data.answer);
                }
            } else if (generated.data.whyNoAnswer) {
                reasons.push(generated.data.whyNoAnswer);
            }
        }
        return {
            matches: this.toCorpusMatches(matches, limit),
            answer: answers.length === 0 ? undefined : answers.join("\n\n"),
            whyNoAnswer: reasons.length === 0 ? undefined : reasons.join(" "),
        };
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
}

export function createKnowProCorpusIndex(
    corpusId: string,
    indexDirectory: string,
    settingsFactory?: () => DocMemorySettings,
): CorpusIndex {
    return new KnowProCorpusIndex(corpusId, indexDirectory, settingsFactory);
}
