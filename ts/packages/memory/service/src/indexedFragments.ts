// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    IndexedFragmentRequest,
    IndexedFragmentSelection,
} from "./types.js";

export interface IndexedBlock {
    sourceId: string;
    revisionId: string;
    blockOrdinal: number;
    text: string;
    score: number;
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

function candidateWindows(
    blocks: IndexedBlock[],
    terms: string[],
    window: number,
): Array<Array<{ block: IndexedBlock; offset: number }>> {
    return blocks.map((block) => {
        const headings = [...block.text.matchAll(/^#{1,6} .+$/gm)];
        const important = headings.filter((heading) =>
            contextualHeading.test(heading[0]),
        );
        const matchedPassages = terms
            .flatMap((term) => {
                const lower = block.text.toLocaleLowerCase();
                const offsets: number[] = [];
                let start = window;
                for (let index = 0; index < 3; index++) {
                    const found = lower.indexOf(term, start);
                    if (found < 0) break;
                    const paragraph = block.text.lastIndexOf("\n\n", found);
                    offsets.push(
                        paragraph < 0
                            ? Math.floor(found / window) * window
                            : paragraph + 2,
                    );
                    start = found + window;
                }
                return offsets;
            })
            .sort((a, b) => {
                const coverage = (offset: number) =>
                    terms.filter((term) =>
                        block.text
                            .slice(offset, offset + window)
                            .toLocaleLowerCase()
                            .includes(term),
                    ).length;
                return coverage(b) - coverage(a) || a - b;
            });
        const offsets = [
            ...new Set([
                0,
                ...important.map((heading) => heading.index),
                ...headings
                    .filter((heading) =>
                        terms.some((term) =>
                            heading[0].toLocaleLowerCase().includes(term),
                        ),
                    )
                    .map((heading) => heading.index),
                ...matchedPassages,
                ...balancedOffsets(block.text.length, window),
            ]),
        ];
        return offsets.map((offset) => ({ block, offset }));
    });
}

interface FragmentSelectionState {
    fragments: IndexedFragmentSelection["fragments"];
    readChars: number;
    neighborhoodChars: number;
    limited: boolean;
    seen: Set<string>;
    selectedRanges: Map<string, Array<{ start: number; end: number }>>;
}

function readCandidate(
    item: { block: IndexedBlock; offset: number },
    request: IndexedFragmentRequest,
    terms: string[],
    window: number,
    readLimit: number,
    maxFragments: number,
    state: FragmentSelectionState,
): void {
    const { block } = item;
    let offset = item.offset;
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
            !/^#{1,6} /m.test(block.text.slice(offset, offset + 8))
        )
            offset = offset - contextChars + heading + 1;
    }
    if (state.readChars >= readLimit) {
        state.limited = true;
        return;
    }
    const end = Math.min(
        block.text.length,
        offset + window,
        offset + readLimit - state.readChars,
    );
    const snippet = block.text.slice(offset, end);
    state.readChars += snippet.length;
    const lower = snippet.toLocaleLowerCase();
    if (
        !terms.some((term) => lower.includes(term)) &&
        !request.query &&
        !contextualHeading.test(snippet)
    )
        return;
    const locator = indexedLocator(block, offset, end);
    const key = `${block.sourceId}:${block.revisionId}:${locator}`;
    if (state.seen.has(key)) return;
    const blockKey = `${block.sourceId}:${block.revisionId}:${block.blockOrdinal}`;
    const ranges = state.selectedRanges.get(blockKey) ?? [];
    if (
        ranges.some(
            (range) =>
                (range.start <= offset && range.end >= end) ||
                (offset <= range.start && end >= range.end),
        )
    )
        return;
    state.seen.add(key);
    ranges.push({ start: offset, end });
    state.selectedRanges.set(blockKey, ranges);
    state.fragments.push({
        sourceId: block.sourceId,
        revisionId: block.revisionId,
        locator,
        snippet,
        score: block.score,
    });
    if (state.fragments.length >= maxFragments) state.limited = true;
}

export function selectIndexedFragments(
    blocks: Iterable<IndexedBlock>,
    request: IndexedFragmentRequest,
): IndexedFragmentSelection {
    const maxFragments = bound(request.maxFragments, 12, 12);
    const window = bound(request.maxCharsPerFragment, 2000, 2000);
    const readLimit = bound(request.maxReadChars, 32000, 32000);
    if (
        !request.terms.length ||
        (request.query !== undefined && !request.query.trim()) ||
        request.terms.length > 8 ||
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
    const selected = diverseBlocks(
        candidates,
        Math.max(2, Math.floor(maxFragments / 3)),
    );
    state.limited = candidates.length > selected.length;
    const windows = candidateWindows(selected, terms, window);
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
    };
}
