// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    IndexedFragmentRequest,
    IndexedFragmentSelection,
    IndexedSelectionDiagnostics,
} from "./types.js";

export interface IndexedBlock {
    temporalContext?: import("@typeagent/knowpro").MessageTemporalContext;
    sourceId: string;
    revisionId: string;
    blockOrdinal: number;
    messageOrdinal?: number;
    text: string;
    score: number;
    postingScore?: number;
    languageScore?: number;
    preferenceBoost?: number;
}

const queryStopWords = new Set([
    "what",
    "which",
    "does",
    "about",
    "with",
    "from",
    "have",
    "that",
    "this",
    "their",
    "were",
    "when",
    "where",
    "should",
    "would",
    "could",
    "how",
    "why",
    "the",
    "and",
    "for",
    "are",
    "can",
    "was",
    "not",
    "did",
    "its",
    "is",
    "to",
    "of",
    "in",
    "a",
    "an",
    "i",
    "my",
    "me",
    "your",
    "our",
    "had",
    "has",
    "been",
    "many",
    "much",
]);

export function indexedQueryTerms(query: string): string[] {
    return [
        ...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []),
    ].filter(
        (term) =>
            term.length > 1 && term.length <= 200 && !queryStopWords.has(term),
    );
}

export function indexedTextHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

export function indexedLocator(
    block: IndexedBlock,
    start: number,
    end: number,
): string {
    return `indexed:${block.blockOrdinal}:${indexedTextHash(block.text)}:${start}-${end}`;
}

export function parseIndexedLocator(locator: string) {
    const match = /^indexed:(\d+):([0-9a-f]{64}):(\d+)-(\d+)$/.exec(locator);
    if (!match) throw new Error("Invalid indexed-text locator");
    const [blockOrdinal, start, end] = [match[1], match[3], match[4]].map(
        Number,
    );
    if (
        ![blockOrdinal, start, end].every(Number.isSafeInteger) ||
        start < 0 ||
        end <= start ||
        end - start > 2000
    )
        throw new Error("Indexed-text locator exceeds bounded UTF-16 range");
    return { blockOrdinal, hash: match[2], start, end };
}

function bound(value: number | undefined, fallback: number, ceiling: number) {
    const selected = value ?? fallback;
    if (!Number.isSafeInteger(selected) || selected < 1 || selected > ceiling)
        throw new Error("Invalid indexed-fragment read bound");
    return selected;
}

function balancedOffsets(length: number, window: number): number[] {
    const count = Math.ceil(length / window);
    if (count <= 2)
        return Array.from({ length: count }, (_, index) => index * window);
    const offsets = [0, Math.max(0, length - window)];
    const ranges = [[1, count - 2]];
    for (const [start, end] of ranges) {
        if (start > end) continue;
        const middle = Math.floor((start + end) / 2);
        offsets.push(middle * window);
        ranges.push([start, middle - 1], [middle + 1, end]);
    }
    return offsets;
}

function diverseBlocks(blocks: IndexedBlock[], limit: number): IndexedBlock[] {
    const signals = (text: string) => [
        /\b(correct(?:ion|ed|s)?|supersed(?:es|ed)|retract(?:ed|ion)?)\b/i.test(
            text,
        ),
        /\b(counterexample|contradict(?:s|ion)?|failed|not reproduced)\b/i.test(
            text,
        ),
        /\b(qualif\w*|caveat|limited|only|cohort|workload|as.of)\b/i.test(text),
        /\b(success|passed|recovered|observed|median|p95)\b/i.test(text),
    ];
    const remaining = blocks.map((block, order) => ({
        block,
        order,
        signals: signals(block.text),
    }));
    const selected: IndexedBlock[] = [];
    const covered = new Set<number>();
    while (remaining.length && selected.length < limit) {
        const novelty = (entry: (typeof remaining)[number]) =>
            entry.signals.filter(
                (present, index) => present && !covered.has(index),
            ).length;
        remaining.sort(
            (a, b) =>
                (selected.length ? novelty(b) - novelty(a) : 0) ||
                Number(
                    selected.some(
                        (block) => block.sourceId === a.block.sourceId,
                    ),
                ) -
                    Number(
                        selected.some(
                            (block) => block.sourceId === b.block.sourceId,
                        ),
                    ) ||
                b.block.score - a.block.score ||
                a.order - b.order,
        );
        const entry = remaining.shift()!;
        selected.push(entry.block);
        entry.signals.forEach((present, index) => {
            if (present) covered.add(index);
        });
    }
    return selected;
}

const contextualHeading =
    /^#{1,6} [^\n]*(qualif|contrast|warn|correct|limit|caveat|counterexample|scope|observation|measurement)/im;

interface WindowCandidate {
    block: IndexedBlock;
    offset: number;
    matched?: boolean;
    context?: boolean;
}

function representativeMatches(text: string, pattern: RegExp) {
    const matches = [...text.matchAll(pattern)];
    return [
        ...new Set([0, matches.length - 1, Math.floor(matches.length / 2)]),
    ].flatMap((index) => (matches[index] ? [matches[index]] : []));
}

function passageOffset(text: string, found: number, window: number): number {
    const context = Math.min(256, Math.floor(window / 4));
    const boundary = text.lastIndexOf("\n\n", found);
    const paragraph = boundary < 0 ? 0 : boundary + 2;
    return Math.max(
        0,
        paragraph > found - context ? paragraph : found - context,
    );
}

function matchedWindows(
    block: IndexedBlock,
    selectors: string[],
    window: number,
    wholeWords: boolean,
): WindowCandidate[] {
    return selectors.flatMap((selector) => {
        if (wholeWords && !/[\p{L}\p{N}]{2}/u.test(selector)) return [];
        const pattern = selector
            .trim()
            .split(/\s+/)
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s+");
        return representativeMatches(
            block.text,
            new RegExp(
                wholeWords
                    ? `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`
                    : pattern,
                "giu",
            ),
        ).map((match) => ({
            block,
            offset: passageOffset(block.text, match.index, window),
            matched: true,
        }));
    });
}

function associatedContext(
    block: IndexedBlock,
    passages: WindowCandidate[],
    headings: RegExpExecArray[],
): WindowCandidate[] {
    const tables = [
        ...block.text.matchAll(/^\|[^\n]*\|\r?\n\|[ \t:|-]+\|[ \t]*$/gm),
    ];
    return passages.flatMap((passage) =>
        [headings, tables].flatMap((items) => {
            const nearest = items
                .filter((item) => item.index <= passage.offset)
                .at(-1);
            return nearest
                ? [{ block, offset: nearest.index, context: true }]
                : [];
        }),
    );
}

function candidateWindows(
    blocks: IndexedBlock[],
    terms: string[],
    selectors: string[],
    window: number,
    wholeWords: boolean,
): WindowCandidate[][] {
    return blocks.map((block) => {
        const headings = [...block.text.matchAll(/^#{1,6} .+$/gm)];
        const passages = matchedWindows(block, selectors, window, wholeWords);
        const words = matchedWindows(block, terms, window, wholeWords);
        const primary = passages.length ? passages : words;
        const qualifications = representativeMatches(
            block.text,
            /\b(qualif\w*|caveat|counterexample|correct\w*|withdraw\w*|retract\w*|exception|scope)\b/giu,
        ).map((match) => ({
            block,
            offset: passageOffset(block.text, match.index, window),
            matched: true,
            context: true,
        }));
        const candidates: WindowCandidate[] = [
            ...primary.slice(0, 2),
            { block, offset: 0 },
            ...associatedContext(block, primary.slice(0, 2), headings),
            ...qualifications.slice(0, 2),
            ...headings
                .filter((heading) => contextualHeading.test(heading[0]))
                .map((heading) => ({
                    block,
                    offset: heading.index,
                    context: true,
                })),
            ...primary.slice(2),
            ...headings
                .filter((heading) =>
                    terms.some((term) =>
                        heading[0].toLocaleLowerCase().includes(term),
                    ),
                )
                .map((heading) => ({ block, offset: heading.index })),
            ...words,
            ...qualifications.slice(2),
            ...balancedOffsets(block.text.length, window).map((offset) => ({
                block,
                offset,
            })),
        ];
        const seen = new Set<number>();
        return candidates.filter((candidate) => {
            if (seen.has(candidate.offset)) return false;
            seen.add(candidate.offset);
            return true;
        });
    });
}

interface FragmentSelectionState {
    fragments: IndexedFragmentSelection["fragments"];
    readChars: number;
    neighborhoodChars: number;
    limited: boolean;
    seen: Set<string>;
    selectedRanges: Map<
        string,
        Array<{
            start: number;
            end: number;
            fragment: IndexedFragmentSelection["fragments"][number];
        }>
    >;
}

function selectionDiagnostics(
    candidates: IndexedBlock[],
    selected: IndexedBlock[],
    request: IndexedFragmentRequest,
    state: FragmentSelectionState,
): IndexedSelectionDiagnostics {
    return {
        terms: [...request.terms],
        eligibleSourceIds: [...request.sourceIds],
        blocks: candidates.map((block) => ({
            sourceId: block.sourceId,
            revisionId: block.revisionId,
            blockOrdinal: block.blockOrdinal,
            ...(block.messageOrdinal !== undefined
                ? { messageOrdinal: block.messageOrdinal }
                : {}),
            score: block.score,
            ...(block.postingScore !== undefined
                ? { postingScore: block.postingScore }
                : {}),
            ...(block.languageScore !== undefined
                ? { languageScore: block.languageScore }
                : {}),
            ...(block.preferenceBoost !== undefined
                ? { preferenceBoost: block.preferenceBoost }
                : {}),
            selected: selected.includes(block),
            emittedFragments:
                state.selectedRanges.get(
                    `${block.sourceId}:${block.revisionId}:${block.blockOrdinal}`,
                )?.length ?? 0,
            reason: selected.includes(block) ? "selected" : "block-limit",
        })),
        readChars: state.readChars,
        fragmentCount: state.fragments.length,
        limited: state.limited,
    };
}

function recordFragment(
    block: IndexedBlock,
    start: number,
    end: number,
    snippet: string,
    maxFragments: number,
    state: FragmentSelectionState,
): void {
    const locator = indexedLocator(block, start, end);
    const key = `${block.sourceId}:${block.revisionId}:${locator}`;
    if (state.seen.has(key)) return;
    const blockKey = `${block.sourceId}:${block.revisionId}:${block.blockOrdinal}`;
    const ranges = state.selectedRanges.get(blockKey) ?? [];
    if (ranges.some((range) => range.start <= start && range.end >= end))
        return;
    const fragment = {
        ...(block.temporalContext
            ? { temporalContext: block.temporalContext }
            : {}),
        sourceId: block.sourceId,
        revisionId: block.revisionId,
        locator,
        snippet,
        score: block.score,
    };
    state.seen.add(key);
    const subsumed = ranges.filter(
        (range) => start <= range.start && end >= range.end,
    );
    if (subsumed.length) {
        const retained = subsumed[0];
        const replaced = new Set(subsumed.map((range) => range.fragment));
        Object.assign(retained.fragment, fragment);
        retained.start = start;
        retained.end = end;
        state.fragments = state.fragments.filter(
            (item) => item === retained.fragment || !replaced.has(item),
        );
        state.selectedRanges.set(
            blockKey,
            ranges.filter(
                (range) => range === retained || !replaced.has(range.fragment),
            ),
        );
    } else {
        ranges.push({ start, end, fragment });
        state.selectedRanges.set(blockKey, ranges);
        state.fragments.push(fragment);
    }
    if (state.fragments.length >= maxFragments) state.limited = true;
}

function uncoveredRange(
    start: number,
    end: number,
    ranges: Array<{ start: number; end: number }>,
): { start: number; end: number } | undefined {
    const gaps: Array<{ start: number; end: number }> = [];
    for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
        if (range.end <= start) continue;
        if (range.start >= end) break;
        if (range.start > start) gaps.push({ start, end: range.start });
        start = Math.max(start, range.end);
        if (start >= end) break;
    }
    if (start < end) gaps.push({ start, end });
    return gaps.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
}

function readCandidate(
    item: WindowCandidate,
    request: IndexedFragmentRequest,
    terms: string[],
    window: number,
    readLimit: number,
    maxFragments: number,
    state: FragmentSelectionState,
): void {
    const { block } = item;
    let offset = item.offset;
    const blockKey = `${block.sourceId}:${block.revisionId}:${block.blockOrdinal}`;
    const ranges = state.selectedRanges.get(blockKey) ?? [];
    if (
        ranges.some(
            (range) =>
                range.start <= offset &&
                range.end >= Math.min(block.text.length, offset + window),
        )
    )
        return;
    const contextChars = Math.min(
        offset,
        1000,
        4000 - state.neighborhoodChars,
        readLimit - state.readChars,
    );
    if (contextChars > 0) {
        const nearby = block.text.slice(offset - contextChars, offset);
        state.readChars += nearby.length;
        state.neighborhoodChars += nearby.length;
        const heading = nearby.lastIndexOf("\n## ");
        if (
            heading >= 0 &&
            !item.matched &&
            !/^#{1,6} /m.test(block.text.slice(offset, offset + 8))
        )
            offset = offset - contextChars + heading + 1;
    }
    if (state.readChars >= readLimit) {
        state.limited = true;
        return;
    }
    if (offset > 0 && /[\uDC00-\uDFFF]/.test(block.text[offset])) offset--;
    let end = Math.min(
        block.text.length,
        offset + window,
        offset + readLimit - state.readChars,
    );
    if (end < block.text.length && /[\uD800-\uDBFF]/.test(block.text[end - 1]))
        end--;
    if (end <= offset) {
        state.limited = true;
        return;
    }
    if (request.query) {
        const uncovered = uncoveredRange(offset, end, ranges);
        if (!uncovered) return;
        offset = uncovered.start;
        end = uncovered.end;
    }
    const snippet = block.text.slice(offset, end);
    state.readChars += snippet.length;
    const lower = snippet.toLocaleLowerCase();
    if (
        !terms.some((term) => lower.includes(term)) &&
        !item.context &&
        !request.query &&
        !contextualHeading.test(snippet)
    )
        return;
    recordFragment(block, offset, end, snippet, maxFragments, state);
}

export function selectIndexedFragments(
    blocks: Iterable<IndexedBlock>,
    request: IndexedFragmentRequest,
): IndexedFragmentSelection {
    const maxFragments = bound(request.maxFragments, 12, 12);
    const window = bound(request.maxCharsPerFragment, 2000, 2000);
    const readLimit = bound(request.maxReadChars, 32000, 32000);
    if (
        (!request.terms.length && request.query === undefined) ||
        (request.query !== undefined && !request.query.trim()) ||
        request.terms.some((term) => !term.trim() || term.length > 200)
    )
        throw new Error("Invalid bounded indexed-fragment selector");
    const terms = [
        ...new Set(
            request.terms.flatMap(
                (term) =>
                    term.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [],
            ),
        ),
    ].filter((term) => term.length > 2);
    const eligible = new Set(request.sourceIds);
    const state: FragmentSelectionState = {
        fragments: [],
        readChars: 0,
        neighborhoodChars: 0,
        limited: false,
        seen: new Set(),
        selectedRanges: new Map(),
    };
    const candidates = [...blocks].filter((block) =>
        eligible.has(block.sourceId),
    );
    const selected = request.query
        ? [...candidates]
              .sort((a, b) => b.score - a.score)
              .slice(0, maxFragments)
        : diverseBlocks(candidates, Math.max(2, Math.floor(maxFragments / 3)));
    state.limited = candidates.length > selected.length;
    const windows = candidateWindows(
        selected,
        terms,
        request.terms,
        window,
        request.query !== undefined,
    );
    // Interleave sources so an earlier long block cannot hide a newly indexed correction.
    for (
        let index = 0;
        windows.some((items) => index < items.length);
        index++
    ) {
        for (const items of windows) {
            const item = items[index];
            if (!item) continue;
            if (
                state.readChars >= readLimit ||
                state.fragments.length >= maxFragments
            ) {
                state.limited = true;
                break;
            }
            readCandidate(
                item,
                request,
                terms,
                window,
                readLimit,
                maxFragments,
                state,
            );
        }
        if (
            state.readChars >= readLimit ||
            state.fragments.length >= maxFragments
        ) {
            state.limited = true;
            break;
        }
    }
    return {
        fragments: state.fragments,
        readChars: state.readChars,
        limited: state.limited,
        ...(request.includeDiagnostics
            ? {
                  diagnostics: selectionDiagnostics(
                      candidates,
                      selected,
                      request,
                      state,
                  ),
              }
            : {}),
    };
}
