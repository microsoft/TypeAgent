// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { DocMemoryData, DocPart } from "@typeagent/conversation-memory";
import type * as kp from "@typeagent/knowpro";

class ReuseUnavailable extends Error {}

function sourceMetadata(message: DocPart) {
    const metadata = message.metadata;
    const temporal = metadata.temporalContext;
    if (!temporal) return metadata;
    const {
        contextHash: _contextHash,
        discoveredDateEvidence: _discoveredDateEvidence,
        rejectedDateAnchors: _rejectedDateAnchors,
        eventMentions: _eventMentions,
        inheritedDateEvidence,
        ...sourceContext
    } = temporal;
    return {
        ...metadata,
        temporalContext: {
            ...sourceContext,
            inheritedDateEvidence: inheritedDateEvidence.filter(
                (evidence) => evidence.role === "messageTime",
            ),
        },
    };
}

function selectedMessages(data: DocMemoryData, parts: DocPart[]): number[] {
    const byUri = new Map<string, number[]>();
    data.messages.forEach((message, ordinal) => {
        const uri = message.metadata.sourceUrl;
        if (!uri) return;
        const ordinals = byUri.get(uri) ?? [];
        ordinals.push(ordinal);
        byUri.set(uri, ordinals);
    });
    const positions = new Map<string, number>();
    const selected = parts.map((part) => {
        const uri = part.metadata.sourceUrl;
        if (!uri) throw new ReuseUnavailable("Missing canonical source URI");
        const position = positions.get(uri) ?? 0;
        positions.set(uri, position + 1);
        const ordinal = byUri.get(uri)?.[position];
        const previous =
            ordinal === undefined ? undefined : data.messages[ordinal];
        const signature = (message: DocPart) =>
            JSON.stringify([
                sourceMetadata(message),
                message.textChunks,
                message.tags,
                message.timestamp,
                message.deletionInfo,
            ]);
        if (!previous || signature(previous) !== signature(part))
            throw new ReuseUnavailable(
                "Canonical retained parts changed or are missing",
            );
        return ordinal!;
    });
    for (const [uri, count] of positions)
        if (byUri.get(uri)?.length !== count)
            throw new ReuseUnavailable(
                "Retained source part coverage is incomplete",
            );
    return selected;
}

function projectReferences(
    data: DocMemoryData,
    messages: Map<number, number>,
): { refs: kp.SemanticRef[]; ordinals: Map<number, number> } {
    const refs: kp.SemanticRef[] = [];
    const ordinals = new Map<number, number>();
    for (const [ordinal, ref] of data.semanticRefs.entries()) {
        const start = ref.range.start;
        if (
            ref.semanticRefOrdinal !== ordinal ||
            !Number.isSafeInteger(start.messageOrdinal) ||
            start.messageOrdinal < 0 ||
            start.messageOrdinal >= data.messages.length
        )
            throw new Error("Invalid retained semantic-reference ordinal");
        if (ref.range.end !== undefined)
            throw new ReuseUnavailable(
                "Multi-message semantic provenance is unsupported",
            );
        const messageOrdinal = messages.get(start.messageOrdinal);
        if (messageOrdinal === undefined) continue;
        const chunk = start.chunkOrdinal ?? 0;
        if (
            !Number.isSafeInteger(chunk) ||
            chunk < 0 ||
            chunk >= data.messages[start.messageOrdinal].textChunks.length
        )
            throw new Error("Invalid retained semantic-reference chunk");
        ordinals.set(ordinal, refs.length);
        refs.push({
            ...structuredClone(ref),
            semanticRefOrdinal: refs.length,
            range: { start: { ...start, messageOrdinal } },
        });
    }
    return { refs, ordinals };
}

function projectPostings(
    data: DocMemoryData,
    ordinals: Map<number, number>,
): kp.ITermToSemanticRefIndexData {
    if (!data.semanticIndexData)
        throw new ReuseUnavailable("Missing committed term postings");
    const items: kp.ITermToSemanticRefIndexItem[] = [];
    for (const item of data.semanticIndexData.items) {
        const postings: kp.ScoredSemanticRefOrdinal[] = [];
        for (const posting of item.semanticRefOrdinals) {
            if (
                !Number.isSafeInteger(posting.semanticRefOrdinal) ||
                posting.semanticRefOrdinal < 0 ||
                posting.semanticRefOrdinal >= data.semanticRefs.length ||
                !Number.isFinite(posting.score)
            )
                throw new Error("Invalid retained term posting");
            const ordinal = ordinals.get(posting.semanticRefOrdinal);
            if (ordinal !== undefined)
                postings.push({
                    semanticRefOrdinal: ordinal,
                    score: posting.score,
                });
        }
        if (postings.length)
            items.push({ term: item.term, semanticRefOrdinals: postings });
    }
    return { items };
}

function projectTerms(
    data: DocMemoryData,
    terms: Set<string>,
    enabled: boolean,
): kp.ITermsToRelatedTermsIndexData {
    if (data.relatedTermsIndexData?.aliasData?.relatedTerms?.length)
        throw new ReuseUnavailable("Aliases lack source-local provenance");
    const result: kp.ITermsToRelatedTermsIndexData = {};
    if (!enabled) return result;
    const source = data.relatedTermsIndexData?.textEmbeddingData;
    if (!source || source.textItems.length !== source.embeddings.length)
        throw new ReuseUnavailable("Missing complete related-term vectors");
    const textItems: string[] = [];
    const embeddings: Float32Array[] = [];
    const found = new Set<string>();
    source.textItems.forEach((term, index) => {
        if (!terms.has(term)) return;
        if (found.has(term)) throw new Error("Duplicate retained term vector");
        found.add(term);
        textItems.push(term);
        embeddings.push(source.embeddings[index].slice());
    });
    result.textEmbeddingData = { textItems, embeddings };
    return result;
}

function projectMessageVectors(
    data: DocMemoryData,
    selected: number[],
    ordinals: Map<number, number>,
    enabled: boolean,
): kp.IMessageTextIndexData {
    const textLocations: kp.TextEmbeddingLocation[] = [];
    const embeddings: Float32Array[] = [];
    const result = {
        messageCount: selected.length,
        indexData: { textLocations, embeddings },
    };
    if (!enabled) return result;
    const source = data.messageIndexData;
    if (
        source?.messageCount !== data.messages.length ||
        !source.indexData ||
        source.indexData.textLocations.length !==
            source.indexData.embeddings.length
    )
        throw new ReuseUnavailable("Missing complete message vectors");
    const found = new Map<
        string,
        { length: number; ranges: Array<{ start: number; end: number }> }
    >();
    source.indexData.textLocations.forEach((location, index) => {
        const messageOrdinal = ordinals.get(location.messageOrdinal);
        if (messageOrdinal === undefined) return;
        const chunk = location.chunkOrdinal ?? 0;
        if (
            !Number.isSafeInteger(chunk) ||
            chunk < 0 ||
            chunk >= data.messages[location.messageOrdinal].textChunks.length
        )
            throw new Error("Invalid retained message-vector location");
        const key = `${messageOrdinal}:${chunk}`;
        const length =
            data.messages[location.messageOrdinal].textChunks[chunk].length;
        const range = location.textRange ?? { start: 0, end: length };
        if (
            !Number.isSafeInteger(range.start) ||
            !Number.isSafeInteger(range.end) ||
            range.start < 0 ||
            range.end > length ||
            range.end < range.start ||
            (range.start === range.end && length > 0)
        )
            throw new Error("Invalid retained message-vector window");
        const coverage = found.get(key) ?? { length, ranges: [] };
        coverage.ranges.push(range);
        found.set(key, coverage);
        textLocations.push({
            ...location,
            messageOrdinal,
            ...(location.textRange ? { textRange: { ...range } } : {}),
        });
        embeddings.push(source.indexData!.embeddings[index].slice());
    });
    const expected = selected.reduce(
        (n, ordinal) => n + data.messages[ordinal].textChunks.length,
        0,
    );
    if (found.size !== expected)
        throw new ReuseUnavailable(
            "Retained message-vector coverage is incomplete",
        );
    for (const coverage of found.values()) {
        let end = 0;
        for (const [i, range] of coverage.ranges
            .sort((a, b) => a.start - b.start)
            .entries()) {
            if (range.start < end || (i > 0 && coverage.length === 0))
                throw new Error("Duplicate retained message-vector location");
            if (range.start !== end)
                throw new ReuseUnavailable(
                    "Retained message-vector window coverage is incomplete",
                );
            end = range.end;
        }
        if (end !== coverage.length)
            throw new ReuseUnavailable(
                "Retained message-vector window coverage is incomplete",
            );
    }
    return result;
}

export function projectRetainedIndex(
    data: DocMemoryData,
    parts: DocPart[],
    lanes: { related: boolean; message: boolean },
):
    | { data: DocMemoryData; missingTermVectors: number; reason?: never }
    | { reason: string; data?: never; missingTermVectors?: never } {
    try {
        if (
            data.indexingComplete === false ||
            data.indexingState?.lastMessageOrdinal !==
                data.messages.length - 1 ||
            data.indexingState.lastSemanticRefOrdinal !==
                data.semanticRefs.length - 1
        )
            throw new ReuseUnavailable(
                "Committed indexing completion is unknown or partial",
            );
        if (data.threadData)
            throw new ReuseUnavailable("Threads lack source-local provenance");
        const selected = selectedMessages(data, parts);
        const messages = new Map(
            selected.map((ordinal, index) => [ordinal, index]),
        );
        const { refs, ordinals } = projectReferences(data, messages);
        const postings = projectPostings(data, ordinals);
        const terms = new Set(postings.items.map((item) => item.term));
        const relatedTermsIndexData = projectTerms(data, terms, lanes.related);
        return {
            missingTermVectors: lanes.related
                ? terms.size -
                  (relatedTermsIndexData.textEmbeddingData?.textItems.length ??
                      0)
                : 0,
            data: {
                nameTag: data.nameTag,
                tags: [],
                embeddingIdentities: structuredClone(data.embeddingIdentities),
                messages: selected.map((ordinal) =>
                    structuredClone(data.messages[ordinal]),
                ),
                semanticRefs: refs,
                semanticIndexData: postings,
                relatedTermsIndexData,
                messageIndexData: projectMessageVectors(
                    data,
                    selected,
                    messages,
                    lanes.message,
                ),
                indexingState: {
                    lastMessageOrdinal: selected.length - 1,
                    lastSemanticRefOrdinal: refs.length - 1,
                    lastIndexed: new Date(),
                },
                indexingComplete: true,
            },
        };
    } catch (error) {
        if (error instanceof ReuseUnavailable) return { reason: error.message };
        throw error;
    }
}
