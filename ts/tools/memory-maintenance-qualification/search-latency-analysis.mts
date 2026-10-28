// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
    intervalUnionMs,
    summarize,
    type ProviderCall,
    type Sample,
} from "./search-latency-benchmark.mts";

function providerRole(sample: Sample, call: ProviderCall): string {
    if (call.kind === "embeddings") return "embeddings";
    const contains = (stage: string) =>
        sample.spans.some(
            (span) =>
                span.stage === stage &&
                call.startEpochMs >= span.endEpochMs - span.elapsedMs - 2 &&
                call.startEpochMs <= span.endEpochMs + 2,
        );
    if (contains("knowpro.language.translation")) return "query-translation";
    if (contains("understanding.reader")) return "understanding-reader";
    if (contains("answer.reader.initial") || contains("answer.reader.refined"))
        return "answer-reader";
    if (contains("hub.synthesis")) return "legacy-synthesis";
    return "unattributed-chat";
}

function providerUnion(sample: Sample): number {
    const start = Date.parse(sample.startedAt);
    const finish = start + sample.elapsedMs;
    const intervals: [number, number][] = sample.providers.map((call) => [
        Math.max(start, call.startEpochMs),
        Math.min(finish, call.startEpochMs + httpMs(call)),
    ]);
    return intervalUnionMs(intervals.filter(([a, b]) => b >= a));
}

function httpMs(call: ProviderCall): number {
    return call.headersMs ?? call.elapsedMs;
}

function stageMs(sample: Sample, stage: string): number {
    return sample.spans
        .filter((span) => span.stage === stage)
        .reduce((sum, span) => sum + span.elapsedMs, 0);
}

function group(samples: Sample[]) {
    const wall = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0);
    const covered = samples.reduce(
        (sum, sample) => sum + providerUnion(sample),
        0,
    );
    const stages = [
        ...new Set(
            samples.flatMap((sample) => sample.spans.map((span) => span.stage)),
        ),
    ].sort();
    const calls = samples.flatMap((sample) =>
        sample.providers.map((call) => ({
            call,
            role: providerRole(sample, call),
        })),
    );
    const roles = [...new Set(calls.map((item) => item.role))].sort();
    const refinements = [
        ...new Set(
            samples.map(
                (sample) =>
                    sample.spans.filter(
                        (span) => span.stage === "answer.refinementSearch",
                    ).length,
            ),
        ),
    ].sort();
    return {
        requests: samples.length,
        failures: samples.filter((sample) => sample.status === "failed").length,
        outcomes: Object.fromEntries(
            [
                ...new Set(
                    samples.map(
                        (sample) => sample.outcome?.status ?? sample.status,
                    ),
                ),
            ].map((status) => [
                status,
                samples.filter(
                    (sample) =>
                        (sample.outcome?.status ?? sample.status) === status,
                ).length,
            ]),
        ),
        latency: summarize(samples.map((sample) => sample.elapsedMs)),
        warmLatency: summarize(
            samples
                .filter((sample) => !sample.firstCorpusUse)
                .map((sample) => sample.elapsedMs),
        ),
        cpu: summarize(samples.map((sample) => sample.cpuMs)),
        providerHttpUnionFraction: wall ? covered / wall : null,
        providerHttpUnion: summarize(samples.map(providerUnion)),
        outsideObservedHttp: summarize(
            samples.map((sample) =>
                Math.max(0, sample.elapsedMs - providerUnion(sample)),
            ),
        ),
        telemetryErrors: samples.reduce(
            (sum, sample) =>
                sum +
                sample.observationErrors.length +
                sample.providers.filter((call) => call.observationError).length,
            0,
        ),
        stages: Object.fromEntries(
            stages.map((stage) => {
                const present = samples.filter((sample) =>
                    sample.spans.some((span) => span.stage === stage),
                );
                const durations = present.map((sample) =>
                    stageMs(sample, stage),
                );
                return [
                    stage,
                    {
                        ...summarize(durations),
                        totalMs: durations.reduce(
                            (sum, value) => sum + value,
                            0,
                        ),
                    },
                ];
            }),
        ),
        providerRoles: Object.fromEntries(
            roles.map((role) => {
                const selected = calls
                    .filter((item) => item.role === role)
                    .map((item) => item.call);
                return [
                    role,
                    {
                        calls: selected.length,
                        errors: selected.filter(
                            (call) =>
                                call.status === "error" || call.status >= 400,
                        ).length,
                        latency: summarize(selected.map(httpMs)),
                        inputTokens: selected.reduce(
                            (sum, call) => sum + (call.inputTokens ?? 0),
                            0,
                        ),
                        outputTokens: selected.reduce(
                            (sum, call) => sum + (call.outputTokens ?? 0),
                            0,
                        ),
                        reasoningTokens: selected.reduce(
                            (sum, call) => sum + (call.reasoningTokens ?? 0),
                            0,
                        ),
                        cachedTokens: selected.reduce(
                            (sum, call) => sum + (call.cachedTokens ?? 0),
                            0,
                        ),
                        tokenUsageObservations: selected.filter(
                            (call) => call.inputTokens !== undefined,
                        ).length,
                        models: [
                            ...new Set(
                                selected.map(
                                    (call) => call.model ?? "unreported",
                                ),
                            ),
                        ],
                    },
                ];
            }),
        ),
        byRefinementCount: refinements.map((count) => {
            const selected = samples.filter(
                (sample) =>
                    sample.spans.filter(
                        (span) => span.stage === "answer.refinementSearch",
                    ).length === count,
            );
            return {
                count,
                latency: summarize(selected.map((sample) => sample.elapsedMs)),
                additionalPass: summarize(
                    selected.map(
                        (sample) =>
                            stageMs(sample, "answer.refinementSearch") +
                            stageMs(sample, "answer.assemble.refined") +
                            stageMs(sample, "answer.reader.refined"),
                    ),
                ),
            };
        }),
    };
}

const { values } = parseArgs({
    options: {
        input: { type: "string" },
        out: { type: "string" },
        evidence: { type: "string" },
    },
});
assert(values.input && values.out, "Required: --input, --out");
const input = await readFile(values.input, "utf8");
const report: {
    schemaVersion: number;
    finished: boolean;
    samples: Sample[];
    startedAt: string;
    updatedAt: string;
    gitRevision: string;
} = JSON.parse(input);
assert(
    report.schemaVersion === 1 && Array.isArray(report.samples),
    "Unknown report schema",
);
assert(report.finished, "The baseline has not finished");
const variants = [...new Set(report.samples.map((sample) => sample.variant))];
const primary = report.samples.filter(
    (sample) => sample.variant === "search-and-ask",
);
const result = {
    schemaVersion: 1,
    startedAt: report.startedAt,
    finishedAt: report.updatedAt,
    gitRevision: report.gitRevision,
    quantiles:
        "nearest rank; stage durations overlap and must not be added across stages",
    providerTiming:
        "Fetch start through response headers (lower-bound HTTP wait; body observation can be delayed by local CPU). Union clipped to request wall interval; includes network, not server-only model compute. Failed fetches use their elapsed time.",
    byVariant: Object.fromEntries(
        variants.map((variant) => [
            variant,
            group(
                report.samples.filter((sample) => sample.variant === variant),
            ),
        ]),
    ),
    primaryByCase: Object.fromEntries(
        [...new Set(primary.map((sample) => sample.caseId))].map((id) => [
            id,
            group(primary.filter((sample) => sample.caseId === id)),
        ]),
    ),
    firstCorpusRequests: report.samples
        .filter((sample) => sample.firstCorpusUse)
        .map((sample) => ({
            caseId: sample.caseId,
            elapsedMs: sample.elapsedMs,
            cpuMs: sample.cpuMs,
            outsideObservedHttpMs: Math.max(
                0,
                sample.elapsedMs - providerUnion(sample),
            ),
            stages: sample.spans.filter((span) =>
                [
                    "hub.corpusListing",
                    "answer.runtime",
                    "answer.originalSearch",
                    "knowpro.language.translation",
                ].includes(span.stage),
            ),
        })),
};
await writeFile(values.out, JSON.stringify(result, undefined, 2));
if (values.evidence) {
    const samples = report.samples.map((sample) => {
        const compactedSpans: Record<
            string,
            {
                count: number;
                totalElapsedMs: number;
                maxElapsedMs: number;
                errors: number;
            }
        > = {};
        const retained = sample.spans.filter((span) => {
            if (
                /^(hub\.|answer\.|understanding\.|knowpro\.language\.|knowpro\.index\.)/.test(
                    span.stage,
                ) &&
                span.stage !== "answer.expandSource"
            )
                return true;
            if (span.stage === "service.total") return true;
            const summary = (compactedSpans[span.stage] ??= {
                count: 0,
                totalElapsedMs: 0,
                maxElapsedMs: 0,
                errors: 0,
            });
            summary.count++;
            summary.totalElapsedMs += span.elapsedMs;
            summary.maxElapsedMs = Math.max(
                summary.maxElapsedMs,
                span.elapsedMs,
            );
            if (span.status !== "success") summary.errors++;
            return false;
        });
        return { ...sample, spans: retained, compactedSpans };
    });
    await writeFile(
        values.evidence,
        JSON.stringify(
            {
                ...report,
                traceCompaction: {
                    sourceReportSha256: createHash("sha256")
                        .update(input)
                        .digest("hex"),
                    note: "Pipeline intervals and all provider calls retained. IO, queue, cache and source-expansion leaf spans aggregated per request. metrics.json was computed from the full trace; nested elapsed totals must not be added.",
                },
                samples,
            },
            undefined,
            2,
        ),
    );
}
console.log(
    `Analyzed ${report.samples.length} requests across ${primary.length} primary samples.`,
);
