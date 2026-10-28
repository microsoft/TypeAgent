// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfigSync } from "../../packages/config/dist/index.js";
import { initRuntimeConfigFromProcessEnv } from "../../packages/aiclient/dist/index.js";
import { runWithSearchTiming } from "../../packages/knowPro/dist/index.js";
import { FileMemoryService } from "../../packages/memory/service/dist/fileMemoryService.js";
import {
    intervalUnionMs,
    readCases,
    type Span,
} from "./search-latency-benchmark.mts";

const { values } = parseArgs({
    options: {
        baseline: { type: "string" },
        cases: { type: "string" },
        out: { type: "string" },
        "allow-model-calls": { type: "boolean" },
    },
});
assert(
    values["allow-model-calls"] &&
        values.baseline &&
        values.cases &&
        values.out,
    "Required: --baseline (finished and closed owned run), --cases, --out, --allow-model-calls",
);
const baseline: { finished: boolean; originalStoreUntouched: boolean } =
    JSON.parse(
        await readFile(resolve(values.baseline, "results.json"), "utf8"),
    );
assert(
    baseline.finished && baseline.originalStoreUntouched,
    "Requires a completed isolated baseline",
);
const cases = readCases(JSON.parse(await readFile(values.cases, "utf8")));
const pairs = [
    ["S01", "S02"],
    ["S05", "S07"],
].map((ids) =>
    ids.map((id) => {
        const item = cases.find((test) => test.id === id);
        assert(item, `Missing case ${id}`);
        return item;
    }),
);
loadConfigSync();
initRuntimeConfigFromProcessEnv();
process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
const service = new FileMemoryService(resolve(values.baseline, "store"), {
    understanding: true,
    maintenanceMode: "manual",
    discoveryPolicy: "off",
    sourceSynopses: false,
});
const warn = console.warn;
const spans: Span[] = [];
console.warn = (...args: unknown[]) => {
    if (
        typeof args[0] === "string" &&
        args[0].startsWith("[memory-search-timing] ")
    ) {
        spans.push(JSON.parse(args[0].slice("[memory-search-timing] ".length)));
    } else warn(...args);
};
const samples = [];
async function search(test: (typeof cases)[number]) {
    const result = await runWithSearchTiming(
        randomUUID(),
        "read-concurrency-probe",
        () =>
            service.search({
                corpusId: test.corpusId,
                query: test.question,
                indexedFragments: true,
                limit: 12,
                maxResponseChars: 24000,
            }),
    );
    return { matches: result.matches.length, warnings: result.warnings.length };
}
async function moduleProbe() {
    const test = cases.find((item) => item.id === "V12");
    assert(test, "Missing module scenario V12");
    const started = performance.now();
    const answer = await service.understand({
        corpusId: test.corpusId,
        question: test.question,
    });
    const initialAnswerMs = performance.now() - started;
    const moduleStarted = performance.now();
    const modules = await Promise.all(
        answer.modules
            .filter((module) => module.status === "planned")
            .map(async (module) => {
                if (module.kind === "explanation")
                    throw new Error("Explanation cannot be a deferred module");
                const start = performance.now();
                const result = await service.understandingModule({
                    corpusId: test.corpusId,
                    snapshotId: answer.snapshotId,
                    kind: module.kind,
                });
                return {
                    kind: module.kind,
                    status: result.status,
                    elapsedMs: performance.now() - start,
                    responseBytes: Buffer.byteLength(JSON.stringify(result)),
                };
            }),
    );
    return {
        caseId: test.id,
        initialAnswerMs,
        answerStatus: answer.answer?.status ?? "no-answer",
        parallelModuleBatchMs: performance.now() - moduleStarted,
        modules,
    };
}
async function traceOverheadProbe() {
    const test = pairs[0][0];
    const samples = [];
    for (const enabled of [true, false, false, true]) {
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = enabled ? "1" : "0";
        const first = spans.length;
        const start = performance.now();
        const result = await runWithSearchTiming(
            randomUUID(),
            "view-trace-probe",
            () =>
                service.searchViews({
                    corpusId: test.corpusId,
                    query: test.question,
                    freshness: "current",
                    kinds: ["wiki"],
                    limit: 12,
                }),
        );
        samples.push({
            enabled,
            elapsedMs: performance.now() - start,
            spans: spans.length - first,
            matches: result.length,
        });
    }
    process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
    return { kind: "warm-wiki-view-search-only-not-full-answer", samples };
}
try {
    await search(pairs[0][0]);
    for (let pair = 0; pair < pairs.length; pair++) {
        for (const parallel of pair === 0 ? [false, true] : [true, false]) {
            const first = spans.length;
            const started = performance.now();
            const results = parallel
                ? await Promise.all(pairs[pair].map(search))
                : [await search(pairs[pair][0]), await search(pairs[pair][1])];
            const elapsedMs = performance.now() - started;
            const translations = spans
                .slice(first)
                .filter(
                    (span) => span.stage === "knowpro.language.translation",
                );
            assert.equal(
                translations.length,
                2,
                "Both searches must use the real translator",
            );
            const union = intervalUnionMs(
                translations.map((span) => [
                    span.endEpochMs - span.elapsedMs,
                    span.endEpochMs,
                ]),
            );
            const overlapMs = Math.max(
                0,
                translations.reduce((sum, span) => sum + span.elapsedMs, 0) -
                    union,
            );
            assert(
                parallel ? overlapMs > 0 : overlapMs < 2,
                "Observed translator overlap did not match the execution mode",
            );
            samples.push({
                caseIds: pairs[pair].map((test) => test.id),
                parallel,
                elapsedMs,
                translationOverlapMs: overlapMs,
                translations,
                results,
            });
        }
    }
    const overhead = await traceOverheadProbe();
    const moduleResults = await moduleProbe();
    await writeFile(
        values.out,
        JSON.stringify(
            {
                schemaVersion: 1,
                finishedAt: new Date().toISOString(),
                kind: "warm-production-indexed-fragment-read-concurrency-probe",
                fullAnswerSpeedupMeasured: false,
                warmupExcluded: true,
                warning:
                    "Two counterbalanced pairs, not a statistically powered A/B trial. No product concurrency change.",
                samples,
                traceOverheadProbe: overhead,
                moduleProbe: moduleResults,
            },
            undefined,
            2,
        ),
        { flag: "wx" },
    );
    console.log(
        JSON.stringify(
            samples.map(({ translations: _spans, ...sample }) => sample),
        ),
    );
} finally {
    console.warn = warn;
    await service.close();
}
