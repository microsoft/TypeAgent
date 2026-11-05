// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { codePointOffsets, validateSpan } from "./datasets.js";
import type { Candidate, Document, Span, Strategy } from "./types.js";

export const tokens = (text: string) =>
    countTokens(text, {
        allowedSpecial: new Set<string>(),
        disallowedSpecial: new Set<string>(),
    });

export function boundedPrefix(
    text: string,
    fits: (prefix: string) => boolean,
): number {
    if (fits(text)) return text.length;
    const offsets = codePointOffsets(text);
    let low = 0,
        high = offsets.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(text.slice(0, offsets[mid]))) low = mid;
        else high = mid - 1;
    }
    const end = offsets[low];
    if (!fits(text.slice(0, end)))
        throw new Error("Prefix exceeds token budget");
    return end;
}

function overlapStart(text: string, overlap: number): number {
    if (!overlap) return text.length;
    const offsets = codePointOffsets(text);
    let low = 0,
        high = offsets.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (tokens(text.slice(offsets[mid])) <= overlap) high = mid;
        else low = mid + 1;
    }
    return offsets[low];
}

export function chunkDocuments(
    documents: Document[],
    size: number,
    overlap = 0,
    strategy: Strategy = "fixed",
    headers = false,
): Candidate[] {
    if (
        !Number.isSafeInteger(size) ||
        size < 1 ||
        !Number.isSafeInteger(overlap) ||
        overlap < 0 ||
        overlap >= size
    )
        throw new Error("Invalid chunk size/overlap");
    return documents.flatMap((doc) => {
        const sections =
            strategy === "structure" && doc.sections.length
                ? doc.sections
                : [{ start: 0, end: doc.text.length, heading: "" }];
        return sections.flatMap((section) =>
            chunkSection(doc, section, size, overlap, strategy, headers),
        );
    });
}

function chunkLength(
    remaining: string,
    size: number,
    strategy: Strategy,
): number {
    const length =
        strategy === "whole"
            ? remaining.length
            : boundedPrefix(remaining, (value) => tokens(value) <= size);
    if (!length) throw new Error("A Unicode code point cannot fit in a chunk");
    if (
        (strategy !== "sentence" && strategy !== "paragraph") ||
        length === remaining.length
    )
        return length;
    const expression =
        strategy === "sentence" ? /[.!?](?:\s+|$)/gu : /\n\s*\n/gu;
    const cuts = [...remaining.slice(0, length).matchAll(expression)];
    const cut = cuts[cuts.length - 1];
    return cut?.index === undefined ? length : cut.index + cut[0].length;
}

function chunkSection(
    doc: Document,
    section: Document["sections"][number],
    size: number,
    overlap: number,
    strategy: Strategy,
    headers: boolean,
): Candidate[] {
    const chunks: Candidate[] = [];
    for (let start = section.start; start < section.end; ) {
        const length = chunkLength(
            doc.text.slice(start, section.end),
            size,
            strategy,
        );
        const end = start + length;
        const heading =
            section.heading ||
            doc.sections.find((item) => item.start <= start && start < item.end)
                ?.heading;
        chunks.push({
            documentId: doc.id,
            start,
            end,
            id: `${doc.id}:${start}-${end}`,
            header: headers
                ? [doc.title, heading].filter(Boolean).join(" > ")
                : "",
            score: 0,
        });
        if (end === section.end) break;
        const next = start + overlapStart(doc.text.slice(start, end), overlap);
        if (next <= start) throw new Error("Chunk overlap prevents progress");
        start = next;
    }
    return chunks;
}

export function candidateText(
    candidate: Candidate,
    documents: ReadonlyMap<string, Document>,
): string {
    validateSpan(candidate, documents);
    return `${candidate.header ? candidate.header + "\n" : ""}${documents.get(candidate.documentId)!.text.slice(candidate.start, candidate.end)}`;
}

export interface PackedContext {
    text: string;
    tokens: number;
    spans: Span[];
    candidateIds: string[];
    clipped: boolean;
}

export function packContext(
    candidates: Candidate[],
    documents: ReadonlyMap<string, Document>,
    budget: number,
): PackedContext {
    if (!Number.isSafeInteger(budget) || budget < 1)
        throw new Error("Invalid context token budget");
    const result: PackedContext = {
        text: "",
        tokens: 0,
        spans: [],
        candidateIds: [],
        clipped: false,
    };
    for (const candidate of candidates) {
        const rendered = candidateText(candidate, documents);
        const separator = result.text ? "\n\n" : "";
        const prefix = result.text + separator;
        const end = boundedPrefix(
            rendered,
            (value) => tokens(prefix + value) <= budget,
        );
        if (!end) {
            result.clipped = true;
            break;
        }
        result.text = prefix + rendered.slice(0, end);
        result.candidateIds.push(candidate.id);
        const headerLength = candidate.header ? candidate.header.length + 1 : 0;
        if (end > headerLength)
            result.spans.push({
                documentId: candidate.documentId,
                start: candidate.start,
                end: candidate.start + end - headerLength,
            });
        if (end < rendered.length) {
            result.clipped = true;
            break;
        }
    }
    result.tokens = tokens(result.text);
    if (result.tokens > budget)
        throw new Error("Serialized context exceeds token budget");
    return result;
}

export function mergeSpans(spans: Span[]): Span[] {
    const merged: Span[] = [];
    for (const span of [...spans].sort(
        (a, b) =>
            a.documentId.localeCompare(b.documentId) ||
            a.start - b.start ||
            a.end - b.end,
    )) {
        const previous = merged[merged.length - 1];
        if (
            previous?.documentId === span.documentId &&
            span.start <= previous.end
        )
            previous.end = Math.max(previous.end, span.end);
        else
            merged.push({
                documentId: span.documentId,
                start: span.start,
                end: span.end,
            });
    }
    return merged;
}

function spanCharacters(
    spans: Span[],
    documents: ReadonlyMap<string, Document>,
) {
    return spans.reduce(
        (total, span) =>
            total +
            Array.from(
                documents
                    .get(span.documentId)!
                    .text.slice(span.start, span.end),
            ).length,
        0,
    );
}

export function scoreContext(
    gold: Span[],
    context: PackedContext,
    documents: ReadonlyMap<string, Document>,
) {
    if (!gold.length)
        throw new Error(
            "Gold-empty questions need a separate answerability cohort",
        );
    for (const span of [...gold, ...context.spans])
        validateSpan(span, documents);
    const expected = mergeSpans(gold),
        actual = mergeSpans(context.spans);
    const intersections = expected.flatMap((left) =>
        actual.flatMap((right) => {
            const start = Math.max(left.start, right.start),
                end = Math.min(left.end, right.end);
            return left.documentId === right.documentId && start < end
                ? [{ documentId: left.documentId, start, end }]
                : [];
        }),
    );
    const relevant = spanCharacters(intersections, documents);
    const goldCharacters = spanCharacters(expected, documents),
        retrievedCharacters = spanCharacters(actual, documents);
    const renderedCharacters = Array.from(context.text).length;
    const recall = relevant / goldCharacters,
        precision = retrievedCharacters ? relevant / retrievedCharacters : 0;
    const emitted = spanCharacters(context.spans, documents);
    return {
        relevantCharacters: relevant,
        goldCharacters,
        retrievedCharacters,
        renderedCharacters,
        recall,
        precision,
        contextPrecision: renderedCharacters
            ? relevant / renderedCharacters
            : 0,
        f1:
            recall + precision
                ? (2 * recall * precision) / (recall + precision)
                : 0,
        duplicateFraction: emitted ? 1 - retrievedCharacters / emitted : 0,
        documentRecall:
            new Set(
                actual
                    .filter((span) =>
                        expected.some(
                            (item) => item.documentId === span.documentId,
                        ),
                    )
                    .map((span) => span.documentId),
            ).size / new Set(expected.map((span) => span.documentId)).size,
    };
}
