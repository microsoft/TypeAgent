// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { runWithSearchTiming } from "@typeagent/knowpro";
import {
    replayWikiAssessment,
    replayDerivativeIndex,
} from "../src/latencyQualificationFixture.js";

test("native rebuild phases are ordered, bounded and do not log source text", async () => {
    const flag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const warn = console.warn;
    const lines: string[] = [];
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "coarse";
    console.warn = (line: unknown) => {
        lines.push(String(line));
    };
    try {
        await runWithSearchTiming("native-phases", "fixture", () =>
            replayDerivativeIndex(false),
        );
        const stages = lines
            .filter((line) => line.startsWith("[memory-search-timing] "))
            .map(
                (line) =>
                    JSON.parse(line.replace("[memory-search-timing] ", ""))
                        .stage,
            )
            .filter((stage: string) => stage.startsWith("ingestion.phase."));
        expect(stages).toEqual([
            "ingestion.phase.extraction.start",
            "ingestion.phase.extraction",
            "ingestion.phase.localIndexes",
            "ingestion.phase.relatedEmbedding.start",
            "ingestion.phase.relatedEmbedding",
            "ingestion.phase.messageEmbedding.start",
            "ingestion.phase.messageEmbedding",
            "ingestion.phase.persist.start",
            "ingestion.phase.persist",
        ]);
        expect(lines.join("")).not.toContain("Platform readiness");
    } finally {
        console.warn = warn;
        if (flag === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = flag;
    }
});

test("native structural-only derivative prototype rejects lost semantic identity and preserves cold reopen", async () => {
    const baseline = await replayDerivativeIndex(false);
    const candidate = await replayDerivativeIndex(true);
    expect(baseline.attempts).toBeGreaterThan(0);
    expect(candidate.attempts).toBe(0);
    expect(candidate.reopenExact).toBe(true);
    expect(candidate.semanticDigest).not.toBe(baseline.semanticDigest);
});

test.each([
    [2, false],
    [2, true],
    [4, false],
    [4, true],
] as const)(
    "Wiki preparation concurrency %s revalidates receipts with churn=%s",
    async (concurrency, churn) => {
        const baseline = await replayWikiAssessment(1, churn);
        const candidate = await replayWikiAssessment(concurrency, churn);
        expect(candidate.receipts).toEqual(baseline.receipts);
        expect(candidate.states).toEqual(baseline.states);
        expect(candidate.publication).toBe(false);
        expect(candidate.peak).toBe(concurrency);
        expect(candidate.discarded).toBe(churn ? concurrency - 1 : 0);
        expect(candidate.attempts).toBe(churn ? 12 + concurrency - 1 : 12);
        expect(baseline.attempts).toBe(12);
    },
);
