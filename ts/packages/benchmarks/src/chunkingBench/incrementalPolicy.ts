// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IndexedBlock,
    IndexedFragmentPolicy,
    IndexedWindowCandidate,
} from "@typeagent/memory-service/benchmark";
import { bm25Terms, createBm25Scorer } from "../memoryBench/scoring.js";
import { bytesHash, digest } from "../memoryBench/storage.js";
import type { SourceMap } from "./retrievers.js";

export type NativeArm = "N0" | "N1" | "N2" | "N3" | "N4";
export type Gate = "empty" | "term-coverage";
export interface PolicyOptions {
    arm: NativeArm;
    gate?: Gate;
    intervention?: "N1" | "N2" | "N3";
}
export const incrementalProtocol = {
    version: "raw-native-bm25-v2",
    scorer: "BM25Okapi-k1=1.5-b=0.75-epsilon=0.25-lowercase-whitespace",
    statistics: "all-request-eligible-original-raw-DocParts",
    windows: "existing-native-boundaries-fixed-raw-DocPart-statistics",
    fusion: {
        constant: 60,
        weights: [1, 1],
        depth: "all-matching-eligible",
        nativeOrder: "descending-native-score-stable-ties",
    },
    coverage: {
        threshold: 0.5,
        comparison: "strictly-less",
        terms: "unique-lowercase-whitespace-query-tokens-no-stopwords",
        evidence: "native-preselection-raw-blocks",
        calibration: "fixed-exploratory-pilot-not-held-out-calibrated",
    },
};

const key = (block: IndexedBlock) =>
    JSON.stringify([block.sourceId, block.revisionId, block.blockOrdinal]);
const describe = (block: IndexedBlock) => ({
    sourceId: block.sourceId,
    revisionId: block.revisionId,
    blockOrdinal: block.blockOrdinal,
    messageOrdinal: block.messageOrdinal ?? null,
    score: block.score,
    textHash: bytesHash(block.text),
    chars: block.text.length,
});
const windowDescription = (item: IndexedWindowCandidate) => ({
    ...describe(item.block),
    offset: item.offset,
    matched: item.matched ?? false,
    context: item.context ?? false,
});

export function observableGate(query: string, native: readonly IndexedBlock[]) {
    const terms = [...new Set(bm25Terms(query))];
    const present = new Set(native.flatMap((block) => bm25Terms(block.text)));
    const covered = terms.filter((term) => present.has(term));
    const coverage = terms.length ? covered.length / terms.length : 1;
    return {
        terms,
        covered,
        coverage,
        empty: native.length === 0,
        "term-coverage": coverage < incrementalProtocol.coverage.threshold,
    };
}

function ordered<T>(items: readonly T[], scores: readonly number[]) {
    return items
        .map((item, index) => ({ item, index, score: scores[index] }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
}

function fused(
    native: readonly IndexedBlock[],
    lexical: IndexedBlock[],
): IndexedBlock[] {
    const union = new Map<string, IndexedBlock>();
    const nativeRanking = ordered(
        native,
        native.map((block) => block.score),
    ).map(({ item }) => item);
    for (const ranking of [nativeRanking, lexical])
        ranking.forEach((block, index) => {
            const previous = union.get(key(block));
            union.set(key(block), {
                ...block,
                score: (previous?.score ?? 0) + 1 / (60 + index + 1),
            });
        });
    return [...union.values()].sort((a, b) => b.score - a.score);
}

/** Only original, frozen source identities are visible to the policy. */
export function createIncrementalController(
    corpusId: string,
    sources: readonly SourceMap[],
    options: PolicyOptions,
) {
    if (options.arm === "N4" && (!options.gate || !options.intervention))
        throw new Error("N4 requires one independent gate and intervention");
    const allowed = new Map(sources.map((source) => [source.sourceId, source]));
    const traces: Record<string, unknown>[] = [];
    let active = false;
    let query = "";
    let scorer: ReturnType<typeof createBm25Scorer> | undefined;
    const known = (block: IndexedBlock) => {
        const source = allowed.get(block.sourceId);
        return (
            source?.revisionId === block.revisionId &&
            source.blocks[block.blockOrdinal]?.sha256 === bytesHash(block.text)
        );
    };
    const intervention =
        options.arm === "N4" ? options.intervention! : options.arm;
    const policy: IndexedFragmentPolicy = {
        selectBlocks({ request, nativeBlocks, eligibleBlocks }) {
            const started = performance.now();
            // A factory can reuse this policy for derived-view indexes.
            if (
                !eligibleBlocks.every(known) ||
                !nativeBlocks.every(known) ||
                !request.sourceIds.every((id) => allowed.has(id))
            )
                return [...nativeBlocks];
            query = request.query ?? request.terms.join(" ");
            const gate = observableGate(query, nativeBlocks);
            active = options.arm !== "N4" || gate[options.gate!];
            scorer =
                active &&
                intervention !== "N0" &&
                eligibleBlocks.some((block) => bm25Terms(block.text).length)
                    ? createBm25Scorer(
                          eligibleBlocks.map((block) => block.text),
                      )
                    : undefined;
            const scores = scorer?.(query) ?? eligibleBlocks.map(() => 0);
            const queryTerms = new Set(bm25Terms(query));
            const matching = eligibleBlocks.map((block) =>
                bm25Terms(block.text).some((term) => queryTerms.has(term)),
            );
            const lexical = ordered(eligibleBlocks, scores)
                .filter(({ index }) => matching[index])
                .map(({ item, score }) => ({ ...item, score }));
            let result = [...nativeBlocks];
            if (active && intervention === "N1")
                result = ordered(
                    nativeBlocks,
                    scorer?.scoreTexts(
                        query,
                        nativeBlocks.map((b) => b.text),
                    ) ?? nativeBlocks.map(() => 0),
                ).map(({ item, score }) => ({ ...item, score }));
            if (active && intervention === "N3" && lexical.length)
                result = fused(nativeBlocks, lexical);
            const nativeIds = new Set(nativeBlocks.map(key));
            traces.push({
                stage: "blocks",
                query,
                request,
                arm: options.arm,
                intervention,
                gate,
                activated: active,
                statisticsDigest: digest(eligibleBlocks.map(describe)),
                normalization: incrementalProtocol.statistics,
                timing: "includes-observational-raw-identity-and-trace-overhead; N0-does-not-build-BM25",
                eligible: eligibleBlocks.map((block, index) => ({
                    ...describe(block),
                    lexicalScore: scores[index],
                    lexicalMatch: matching[index],
                })),
                before: nativeBlocks.map(describe),
                after: result.map(describe),
                lexicalOnly: result
                    .filter((b) => !nativeIds.has(key(b)))
                    .map(describe),
                milliseconds: performance.now() - started,
                processMemory: process.memoryUsage(),
            });
            return result;
        },
        rankWindows({ request, windows, windowChars }) {
            const started = performance.now();
            if (!windows.every((window) => known(window.block)))
                return [...windows];
            const scores =
                scorer?.scoreTexts(
                    query,
                    windows.map((item) =>
                        item.block.text.slice(
                            item.offset,
                            item.offset + windowChars,
                        ),
                    ),
                ) ?? windows.map(() => 0);
            const ranked =
                active && intervention === "N2"
                    ? ordered(windows, scores).map(({ item }) => item)
                    : [...windows];
            traces.push({
                stage: "windows",
                query,
                request,
                windowChars,
                normalization: incrementalProtocol.windows,
                before: windows.map((item, index) => ({
                    ...windowDescription(item),
                    lexicalScore: scores[index],
                })),
                after: ranked.map(windowDescription),
                milliseconds: performance.now() - started,
            });
            return ranked;
        },
    };
    return {
        policyFor: (id: string) => (id === corpusId ? policy : undefined),
        drain: () => traces.splice(0),
    };
}
