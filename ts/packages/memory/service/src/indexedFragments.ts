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
        request.terms.some((term) => !term.trim() || term.length > 200) ||
        request.sourceIds.length > 32
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
    const fragments: IndexedFragmentSelection["fragments"] = [];
    let readChars = 0;
    let neighborhoodChars = 0;
    let limited = false;
    const seen = new Set<string>();
    const selectedRanges = new Map<
        string,
        Array<{ start: number; end: number }>
    >();
    const selected = [...blocks]
        .filter((block) => eligible.has(block.sourceId))
        .slice(0, Math.max(2, Math.floor(maxFragments / 3)));
    const windows = selected.map((block) => {
        const headings = [...block.text.matchAll(/^#{1,6} .+$/gm)];
        const important = headings.filter((heading) =>
            /qualif|contrast|warn|correct|limit|caveat/i.test(heading[0]),
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
        return offsets.map((offset) => ({
            block,
            offset,
        }));
    });
    // Interleave sources so an earlier long block cannot hide a newly indexed correction.
    for (
        let index = 0;
        windows.some((items) => index < items.length);
        index++
    ) {
        for (const items of windows) {
            const item = items[index];
            if (!item) continue;
            const { block } = item;
            let offset = item.offset;
            if (readChars >= readLimit || fragments.length >= maxFragments) {
                limited = true;
                break;
            }
            const contextChars = Math.min(
                offset,
                1000,
                4000 - neighborhoodChars,
                readLimit - readChars,
            );
            if (contextChars > 0) {
                const nearby = block.text.slice(offset - contextChars, offset);
                readChars += nearby.length;
                neighborhoodChars += nearby.length;
                const heading = nearby.lastIndexOf("\n## ");
                if (
                    heading >= 0 &&
                    !/^#{1,6} /m.test(block.text.slice(offset, offset + 8))
                )
                    offset = offset - contextChars + heading + 1;
            }
            if (readChars >= readLimit) {
                limited = true;
                break;
            }
            const end = Math.min(
                block.text.length,
                offset + window,
                offset + readLimit - readChars,
            );
            const snippet = block.text.slice(offset, end);
            readChars += snippet.length;
            const lower = snippet.toLocaleLowerCase();
            if (
                !terms.some((term) => lower.includes(term)) &&
                !request.query &&
                !/^#{1,6} [^\n]*(qualif|contrast|warn|correct|limit|caveat)/im.test(
                    snippet,
                )
            )
                continue;
            const locator = indexedLocator(block, offset, end);
            const key = `${block.sourceId}:${block.revisionId}:${locator}`;
            if (seen.has(key)) continue;
            const blockKey = `${block.sourceId}:${block.revisionId}:${block.blockOrdinal}`;
            const ranges = selectedRanges.get(blockKey) ?? [];
            if (
                ranges.some(
                    (range) =>
                        (range.start <= offset && range.end >= end) ||
                        (offset <= range.start && end >= range.end),
                )
            )
                continue;
            seen.add(key);
            ranges.push({ start: offset, end });
            selectedRanges.set(blockKey, ranges);
            fragments.push({
                sourceId: block.sourceId,
                revisionId: block.revisionId,
                locator,
                snippet,
                score: block.score,
            });
        }
        if (readChars >= readLimit || fragments.length >= maxFragments) {
            limited = true;
            break;
        }
    }
    return { fragments, readChars, limited };
}
