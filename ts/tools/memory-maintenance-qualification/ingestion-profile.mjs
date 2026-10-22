// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
    writeJson,
    snapshotCompiledCheckpoint,
    assertCheckpoint,
    checkpointExpectationHash,
} from "./harness.mjs";
import { alive, supervise } from "./watchdog.mjs";
import { observeProvider } from "./live-stages.mjs";

const timingPrefix = "[memory-search-timing] ";
const digest = (value) => createHash("sha256").update(value).digest("hex");

function statistics(values) {
    if (!values.length)
        return {
            count: 0,
            totalMs: 0,
            meanMs: null,
            p50Ms: null,
            p95Ms: null,
            maxMs: null,
        };
    const sorted = [...values].sort((a, b) => a - b);
    const totalMs = sorted.reduce((sum, value) => sum + value, 0);
    return {
        count: sorted.length,
        totalMs,
        meanMs: totalMs / sorted.length,
        p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        maxMs: sorted.at(-1),
    };
}

function timestamp(value) {
    const result = Date.parse(value);
    assert.ok(Number.isFinite(result), "Invalid persisted timing timestamp");
    return result;
}

function partitionJob(job) {
    const start = timestamp(job.createdAt);
    const end = timestamp(job.updatedAt);
    assert.ok(end >= start, "Job timestamps are out of order");
    const trace = job.trace ?? [];
    const chunked = trace.find(
        (event) => event.message === "Documents chunked",
    );
    const persisting = trace.find(
        (event) => event.message === "Persisting index",
    );
    const persisted = trace.find(
        (event) => event.message === "Index persisted",
    );
    const totalMs = end - start;
    if (!chunked || !persisting || !persisted)
        return { totalMs, partition: null };
    const edges = [
        start,
        timestamp(chunked.timestamp),
        timestamp(persisting.timestamp),
        timestamp(persisted.timestamp),
        end,
    ];
    assert.ok(
        edges.every((value, index) => !index || value >= edges[index - 1]),
    );
    return {
        totalMs,
        operation: chunked.operation,
        partition: {
            admissionThroughChunkingMs: edges[1] - edges[0],
            indexPreparationMs: edges[2] - edges[1],
            indexPersistenceMs: edges[3] - edges[2],
            postIndexThroughCompletionMs: edges[4] - edges[3],
        },
    };
}

export function summarizeJobs(jobs) {
    const measured = jobs.map((job) => ({
        jobId: job.jobId,
        state: job.state,
        warningCount: job.warnings?.length ?? 0,
        ...partitionJob(job),
    }));
    const partitioned = measured.filter((job) => job.partition);
    const partitions = Object.fromEntries(
        [
            "admissionThroughChunkingMs",
            "indexPreparationMs",
            "indexPersistenceMs",
            "postIndexThroughCompletionMs",
        ].map((key) => [
            key,
            statistics(partitioned.map((job) => job.partition[key])),
        ]),
    );
    return {
        wallTime: statistics(measured.map((job) => job.totalMs)),
        partitionedJobs: partitioned.length,
        unpartitionedJobIds: measured
            .filter((job) => !job.partition)
            .map((job) => job.jobId),
        partitions,
        operations: measured.reduce((counts, job) => {
            const operation = job.operation ?? "unknown";
            counts[operation] = (counts[operation] ?? 0) + 1;
            return counts;
        }, {}),
        jobs: measured,
        states: jobs.reduce((counts, job) => {
            counts[job.state] = (counts[job.state] ?? 0) + 1;
            return counts;
        }, {}),
        interpretation:
            "Nonoverlapping persisted wall-clock boundaries, not CPU time. Index preparation combines extraction, embeddings and indexing. Admission includes queue/copy/load work; post-index includes commit/metadata overhead. Missing milestones remain unpartitioned.",
    };
}

export function parseTimingLog(text) {
    return text.split(/\r?\n/).flatMap((line) => {
        if (!line.startsWith(timingPrefix)) return [];
        const event = JSON.parse(line.slice(timingPrefix.length));
        assert.equal(typeof event.traceId, "string");
        assert.equal(typeof event.stage, "string");
        assert.match(
            event.stage,
            /^[a-zA-Z0-9_.-]{1,120}$/,
            "Unsafe timing stage",
        );
        if (event.scope !== undefined)
            assert.match(
                event.scope,
                /^[a-zA-Z0-9_.-]{1,120}$/,
                "Unsafe timing scope",
            );
        assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
        assert.ok(["success", "error"].includes(event.status));
        return [
            {
                traceId: event.traceId,
                scope: event.scope,
                stage: event.stage,
                elapsedMs: event.elapsedMs,
                status: event.status,
                ...(Number.isFinite(event.endEpochMs)
                    ? { endEpochMs: event.endEpochMs }
                    : {}),
                metadata: Object.fromEntries(
                    Object.entries(event.metadata ?? {}).filter(
                        ([key, value]) =>
                            (key === "groupId" &&
                                typeof value === "string" &&
                                /^[a-f0-9-]{36}$/i.test(value)) ||
                            ([
                                "calls",
                                "attempts",
                                "items",
                                "entities",
                                "topics",
                                "actions",
                                "inverseActions",
                                "complete",
                                "failed",
                                "cancelled",
                                "warningCount",
                                "groupSize",
                                "sharedPreparation",
                            ].includes(key) &&
                                (typeof value === "boolean" ||
                                    (typeof value === "number" &&
                                        Number.isFinite(value)))),
                    ),
                ),
            },
        ];
    });
}

export function timingCategory(stage) {
    if (stage.startsWith("ingestion.extraction.")) return "extraction";
    if (stage.startsWith("ingestion.embedding.")) return "embedding";
    if (stage.startsWith("ingestion.document.")) return "parsingChunkingWall";
    if (stage.startsWith("storage.io.")) return "filesystemApiWall";
    if (stage.includes("segments.collect")) return "segmentCollection";
    if (stage === "queue.wait" || stage === "ingestion.commit.queue.wait")
        return "serializedQueueWait";
    if (stage === "queue.work" || stage === "ingestion.commit.queue.work")
        return "serializedQueueWork";
    if (stage === "job.queue.wait") return "jobPersistenceQueueWait";
    if (stage === "job.queue.work") return "jobPersistenceQueueWork";
    if (stage === "ingestion.wait") return "ingestionQueueWait";
    if (stage.startsWith("ingestion.postIndex.")) return "postIndexMaintenance";
    if (stage.includes("index.load")) return "indexLoad";
    if (stage.includes("index.persist")) return "indexPersistence";
    if (stage.startsWith("storage.")) return "logicalStorage";
    return "inclusiveEnvelopeOrOther";
}

export function intervalSummary(events) {
    const intervals = events
        .filter((event) => Number.isFinite(event.endEpochMs))
        .map((event) => [event.endEpochMs - event.elapsedMs, event.endEpochMs])
        .sort((a, b) => a[0] - b[0]);
    let unionMs = 0;
    let end = -Infinity;
    for (const [start, finish] of intervals) {
        unionMs += Math.max(0, finish - Math.max(start, end));
        end = Math.max(end, finish);
    }
    const inclusiveMs = events
        .filter((event) => Number.isFinite(event.endEpochMs))
        .reduce((sum, event) => sum + event.elapsedMs, 0);
    return {
        positionedEvents: intervals.length,
        unpositionedEvents: events.length - intervals.length,
        unionMs: intervals.length ? unionMs : null,
        inclusiveMs: intervals.length ? inclusiveMs : null,
        overlapOrNestingMs: intervals.length
            ? Math.max(0, inclusiveMs - unionMs)
            : null,
    };
}

function timingGroup(events) {
    const numeric = (key, suffix) =>
        events
            .filter((event) => !suffix || event.stage.endsWith(suffix))
            .reduce((sum, event) => sum + (event.metadata?.[key] ?? 0), 0);
    return {
        ...statistics(events.map((event) => event.elapsedMs)),
        errors: events.filter((event) => event.status === "error").length,
        logicalCalls: numeric("calls", ".call"),
        modelAttempts: numeric("attempts", ".attempt"),
        requestedItems: numeric("items", ".call"),
        attemptedItems: numeric("items", ".attempt"),
        entities: numeric("entities"),
        topics: numeric("topics"),
        actions: numeric("actions"),
        inverseActions: numeric("inverseActions"),
        ...intervalSummary(events),
    };
}

export function summarizeTimings(events, { slowStageMs = 1000 } = {}) {
    assert.ok(
        Number.isFinite(slowStageMs) && slowStageMs >= 0,
        "Invalid slow-stage threshold",
    );
    const groups = new Map();
    for (const event of events) {
        const values = groups.get(event.stage) ?? [];
        values.push(event);
        groups.set(event.stage, values);
    }
    return {
        events: events.length,
        byStage: Object.fromEntries(
            [...groups].map(([stage, values]) => [
                stage,
                {
                    ...timingGroup(values),
                    traceIds: [
                        ...new Set(values.map((value) => value.traceId)),
                    ],
                },
            ]),
        ),
        byCategory: Object.fromEntries(
            [
                ...new Set(events.map((event) => timingCategory(event.stage))),
            ].map((category) => [
                category,
                timingGroup(
                    events.filter(
                        (event) => timingCategory(event.stage) === category,
                    ),
                ),
            ]),
        ),
        byJob: Object.fromEntries(
            [...new Set(events.map((event) => event.traceId))].map(
                (traceId) => {
                    const current = events.filter(
                        (event) => event.traceId === traceId,
                    );
                    return [
                        traceId,
                        {
                            ...timingGroup(current),
                            sharedGroupTrace: current.some(
                                (event) =>
                                    event.scope === "memory.ingestion.group",
                            ),
                            sharedGroupTraceIds: [
                                ...new Set(
                                    current
                                        .map((event) => event.metadata?.groupId)
                                        .filter(Boolean),
                                ),
                            ],
                            byCategory: Object.fromEntries(
                                [
                                    ...new Set(
                                        current.map((event) =>
                                            timingCategory(event.stage),
                                        ),
                                    ),
                                ].map((category) => [
                                    category,
                                    timingGroup(
                                        current.filter(
                                            (event) =>
                                                timingCategory(event.stage) ===
                                                category,
                                        ),
                                    ),
                                ]),
                            ),
                        },
                    ];
                },
            ),
        ),
        slowStageMs,
        filesystemCoverage: {
            segmentBoundariesObserved: events.some((event) =>
                event.stage.startsWith("storage.io.segment."),
            ),
            allFilesystemCallsCovered: false,
            interpretation:
                "filesystemApiWall covers instrumented awaited API calls only, not all disk/OS I/O. Older logs without storage.io.segment.* omit the segmented store's lstat/read/write/readdir/rename/remove boundaries. Logical load/persist/collection durations include those omitted operations and are not additive with their child events. Other stores/providers may still perform uninstrumented I/O.",
        },
        slowEvents: events.filter((event) => event.elapsedMs >= slowStageMs),
        // Retain every metadata-only event, including explicit failures and repeated attempts.
        observations: events,
        interpretation:
            "Production stage durations are inclusive and may overlap or nest. Union and overlap estimates use endEpochMs minus monotonic elapsed duration, so wall-clock adjustments and timestamp precision limit accuracy; absent endpoints remain unknown. Do not add stage/category sums into a critical-path total or subtract them from job wall time. document.prepare encloses parsing and chunk assembly; Markdown document.parse includes structural splitting, while document.chunk is token-aware aggregate assembly. Parsing/chunking and filesystem API timings are wall time, not CPU usage, bytes, or actual OS I/O. Calls are logical operations; model attempts include visible retry/repair invocations, not hidden SDK/HTTP retries. Entities/topics/actions come from one combined extraction response. Shared group work belongs to its trace, not each member independently.",
    };
}

function summarizeProvider(events) {
    const groups = new Map();
    for (const event of events) {
        const modelSha256 = /^[a-f0-9]{64}$/i.test(event.modelSha256 ?? "")
            ? event.modelSha256
            : event.model
              ? digest(String(event.model))
              : undefined;
        const key = JSON.stringify([
            /^ingestion[:.]/.test(event.role ?? "") ? "ingestion" : "other",
            modelSha256 ?? null,
            event.status,
        ]);
        const group = groups.get(key) ?? {
            role: /^ingestion[:.]/.test(event.role ?? "")
                ? "ingestion"
                : "other",
            modelSha256,
            status: event.status,
            durations: [],
            missingDuration: 0,
        };
        if (Number.isFinite(event.durationMs) && event.durationMs >= 0)
            group.durations.push(event.durationMs);
        else group.missingDuration++;
        groups.set(key, group);
    }
    return {
        groups: [...groups.values()].map(({ durations, ...group }) => ({
            ...group,
            ...statistics(durations),
        })),
        interpretation:
            "Observed fetch durations include diagnostic wrapper overhead. Concurrent request durations overlap; their sum is not provider critical-path time. Unobserved attempts have no inferred duration.",
    };
}

export async function analyzeRun(runDirectory, timingLog) {
    const stateBytes = await readFile(
        path.join(runDirectory, "benchmark-state.json"),
    );
    const state = JSON.parse(stateBytes);
    const jobs = [];
    const missingJobIds = [];
    const inconsistentJobIds = [];
    const cases = [];
    for (const [questionId, record] of Object.entries(state.cases)) {
        const current = [];
        for (const operation of record.operations) {
            if (!operation.jobId) {
                missingJobIds.push({
                    questionId,
                    sourceKeySha256: operation.sourceKey
                        ? digest(String(operation.sourceKey))
                        : undefined,
                    reason: "Recovered ready revision acknowledged without a job ID",
                });
                continue;
            }
            const job = JSON.parse(
                await readFile(
                    path.join(
                        runDirectory,
                        "isolated-store",
                        "jobs",
                        `${operation.jobId}.json`,
                    ),
                    "utf8",
                ),
            );
            if (job.state !== "complete") inconsistentJobIds.push(job.jobId);
            assert.equal(job.sourceId, operation.sourceId);
            assert.equal(job.revisionId, operation.revisionId);
            jobs.push(job);
            current.push(job);
        }
        cases.push({
            questionId,
            completedHistories: record.operations.length,
            measured: summarizeJobs(current),
        });
    }
    const knownJobs = new Set(jobs.map((job) => job.jobId));
    const unledgeredJobIds = [];
    const jobDirectory = path.join(runDirectory, "isolated-store", "jobs");
    const files = await readdir(jobDirectory).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
    });
    for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const job = JSON.parse(
            await readFile(path.join(jobDirectory, file), "utf8"),
        );
        if (knownJobs.has(job.jobId)) continue;
        jobs.push(job);
        knownJobs.add(job.jobId);
        unledgeredJobIds.push(job.jobId);
    }
    const events = timingLog
        ? parseTimingLog(await readFile(timingLog, "utf8"))
        : [];
    return {
        schemaVersion: 2,
        createdAt: new Date().toISOString(),
        runDirectory,
        stateSha256: digest(stateBytes),
        compiledDigest: state.compiledDigest,
        engineHash: state.engineHash,
        jobs: summarizeJobs(jobs),
        missingJobIds,
        inconsistentJobIds,
        unledgeredJobIds,
        jobCompletion:
            jobs.length > 0 &&
            jobs.every((job) => job.state === "complete") &&
            missingJobIds.length === 0 &&
            inconsistentJobIds.length === 0
                ? "COMPLETE"
                : "INCOMPLETE",
        cases,
        provider: summarizeProvider(state.providerRequests ?? []),
        productionTiming: {
            available: events.length > 0,
            logSupplied: Boolean(timingLog),
            ...summarizeTimings(events),
        },
        limitations: [
            "No retrospective CPU, disk-byte, queue-lock or provider-overlap partition can be reconstructed from these summaries alone.",
            "Historical jobs/provider events may include the retained pilot. Failed, cancelled and unledgered jobs remain visible; recovered operations without job IDs cannot be measured. Job wall time ends at last persisted update and is not a completion claim for nonterminal jobs.",
            "No source prose, prompts, answers, credentials or endpoint URLs are copied into this report.",
        ],
    };
}

export function profileInvocation(runnerArgs, environment = process.env) {
    assert.ok(
        !runnerArgs.some(
            (arg) =>
                arg === "--no-stage-timing" ||
                arg.startsWith("--no-stage-timing="),
        ),
        "--no-stage-timing is development-only; benchmark profiling always enables detailed stage timing",
    );
    assert.ok(
        runnerArgs.includes("--authorized-live-benchmark"),
        "Normal live authorization flag is required",
    );
    assert.ok(
        !runnerArgs.some(
            (arg) => arg === "--spec" || arg.startsWith("--spec="),
        ),
        "Use the supervised CLI, not a direct worker spec",
    );
    return {
        command: process.execPath,
        args: [
            path.join(import.meta.dirname, "longmemeval-live.mjs"),
            ...runnerArgs,
        ],
        env: { ...environment, TYPEAGENT_MEMORY_SEARCH_TRACE: "1" },
    };
}

export async function analyzeSupervisedRun(runDirectory) {
    const termination = JSON.parse(
        await readFile(path.join(runDirectory, "termination.json"), "utf8"),
    );
    assert.equal(termination.workerExited, true);
    assert.equal(alive(termination.workerPid), false);
    assert.equal(alive(termination.watchdogPid), false);
    const workerTimingLog = path.join(
        runDirectory,
        `stderr-${termination.startedEpochMs}.log`,
    );
    const profile = await analyzeRun(runDirectory, workerTimingLog);
    return { termination, workerTimingLog, profile };
}

export function developmentFixtures() {
    return [
        {
            sourceType: "markdown",
            title: "Development synthetic project notes",
            text: "# Cedar project\n\n## Planning\nMira Chen leads the Cedar project. Owen Park owns deployment validation.\n\n## Decisions\nOn October 12, the team chose a staged rollout. Mira will review the checklist on October 20.\n\n## Follow-up\nOwen will publish test results after validation. The project depends on the Harbor library.",
        },
        {
            sourceType: "html",
            title: "Development synthetic status update",
            html: "<html><body><h1>Harbor status</h1><p>Owen Park completed the Harbor library review on October 15.</p><h2>Next actions</h2><p>Mira Chen will verify the Cedar staging environment on October 21. The rollout remains scheduled for October 24.</p></body></html>",
        },
        {
            sourceType: "text",
            title: "Development synthetic meeting",
            text: "Mira Chen: The Cedar rollout review is scheduled for October 22.\nOwen Park: I will check the Harbor dependency and share the validation summary.\nMira Chen: Please add rollback instructions before the review.",
        },
    ];
}

export function validateDevelopmentSpec(spec) {
    assert.equal(spec.mode, "DEVELOPMENT_INGESTION_PROFILE");
    assert.equal(
        spec.authorizedDevelopmentInference,
        true,
        "Development inference requires explicit authorization",
    );
    assert.ok(
        path.isAbsolute(spec.productRoot) && path.isAbsolute(spec.runDirectory),
    );
    assert.equal(spec.startupAllowanceMs, 120000);
    assert.equal(spec.workAllowanceMs, 25 * 60000);
    assert.equal(spec.totalAllowanceMs, 30 * 60000);
    assertCheckpoint(spec.expectedCheckpoint.hashes, spec.expectedCheckpoint);
    validateDevelopmentDiagnostics(spec);
}

export function developmentDiagnosticPolicy(
    stageTimingEnabled = true,
    nativeWorkerCpu = false,
) {
    return {
        stageTiming: stageTimingEnabled ? "detailed" : "disabled",
        providerObservation: "existing-metadata-only",
        nativeWorkerCpu,
    };
}

export function developmentDiagnosticPolicyHash(spec) {
    return digest(
        JSON.stringify({
            receiptId: spec.receiptId,
            checkpointExpectationHash: checkpointExpectationHash(
                spec.expectedCheckpoint,
            ),
            diagnosticPolicy: spec.diagnosticPolicy,
        }),
    );
}

function validateDevelopmentDiagnostics(spec) {
    assert.equal(
        spec.mode,
        "DEVELOPMENT_INGESTION_PROFILE",
        "Diagnostic policy is development-only",
    );
    assert.ok(
        ["detailed", "disabled"].includes(spec.diagnosticPolicy?.stageTiming),
        "Missing explicit development diagnostic policy",
    );
    assert.deepEqual(
        spec.diagnosticPolicy,
        developmentDiagnosticPolicy(
            spec.diagnosticPolicy.stageTiming === "detailed",
            spec.nativeProfile === true,
        ),
    );
    assert.equal(
        spec.diagnosticPolicySha256,
        developmentDiagnosticPolicyHash(spec),
        "Development diagnostic policy fingerprint mismatch",
    );
}

export function configureDevelopmentDiagnostics(
    spec,
    environment = process.env,
) {
    validateDevelopmentDiagnostics(spec);
    environment.TYPEAGENT_MEMORY_SEARCH_TRACE =
        spec.diagnosticPolicy.stageTiming === "detailed" ? "1" : "0";
}

export function developmentTimingCapture(policy, available) {
    if (policy.stageTiming === "disabled")
        return available
            ? "UNEXPECTED_EVENTS_WHILE_DISABLED"
            : "INTENTIONALLY_DISABLED";
    return available ? "CAPTURED" : "MISSING";
}

export function developmentFailure(error, phase, entry) {
    const message = error instanceof Error ? error.message : String(error);
    const known = [
        ["HTML sources require html content", "HTML_CONTENT_FIELD_REQUIRED"],
        [
            "Exactly one non-empty markdown, text, or html value is required",
            "INVALID_CONTENT_FIELDS",
        ],
        ["Development ingestion did not complete", "JOB_NOT_COMPLETE"],
        [
            "Development ingestion has maintenance warnings",
            "JOB_MAINTENANCE_WARNINGS",
        ],
    ].find(
        ([prefix]) => message === prefix || message.startsWith(`${prefix}\n`),
    );
    return {
        phase,
        entry: entry ? { ...entry } : undefined,
        code: known?.[1] ?? "UNCLASSIFIED_DEVELOPMENT_FAILURE",
        message:
            known?.[0] ??
            "Failure details withheld; error fingerprint retained.",
        errorSha256: digest(message),
        aborted:
            error instanceof Error &&
            ["AbortError", "TimeoutError"].includes(error.name),
    };
}

export async function runDevelopmentEntries(
    service,
    waitForMemoryJob,
    corpusId,
    signal,
    state,
    persist,
) {
    const fixtures = developmentFixtures();
    const sources = [];
    try {
        for (const source of [
            ...fixtures,
            {
                ...fixtures[0],
                text:
                    fixtures[0].text +
                    "\n\nUpdate: Owen will finish validation on October 23.",
            },
        ]) {
            const replacement = sources.length === fixtures.length;
            state.activeEntry = {
                ordinal: sources.length,
                sourceType: source.sourceType,
                operation: replacement ? "replace-retaining-history" : "ingest",
                fixtureSha256: digest(JSON.stringify(source)),
            };
            state.phase = "admission";
            await persist();
            signal.throwIfAborted();
            const accepted = await service.ingestDocument(
                {
                    corpusId,
                    source: {
                        ...source,
                        ...(replacement
                            ? { sourceId: sources[0].sourceId }
                            : {}),
                    },
                    pipeline: {
                        maxCharsPerChunk: 240,
                        ...(replacement
                            ? { updatePolicy: "retainRevisionHistory" }
                            : {}),
                    },
                },
                signal,
            );
            const identity = {
                jobId: accepted.jobId,
                sourceId: accepted.sourceId,
                revisionId: accepted.revisionId,
            };
            Object.assign(state.activeEntry, identity);
            state.cases.development.operations.push(identity);
            state.phase = "job-wait";
            await persist();
            const job = await waitForMemoryJob(service, accepted.jobId, {
                signal,
                pollIntervalMs: 100,
            });
            state.phase = "job-validation";
            state.activeEntry.jobState = job.state;
            state.activeEntry.warningCount = job.warnings?.length ?? 0;
            assert.equal(
                job.state,
                "complete",
                "Development ingestion did not complete",
            );
            assert.equal(
                job.warnings?.length ?? 0,
                0,
                "Development ingestion has maintenance warnings",
            );
            sources.push(accepted);
            delete state.activeEntry;
            state.phase = "entry-complete";
            await persist();
        }
    } catch (error) {
        state.outcome = "FAILED_DEVELOPMENT_INGESTION";
        state.failure = developmentFailure(
            error,
            state.phase,
            state.activeEntry,
        );
        await persist();
        throw error;
    }
}

export async function closeDevelopmentService(service, state, persist) {
    state.close = "STARTED";
    try {
        await persist();
    } finally {
        try {
            await service.close();
            state.close = "COMPLETE";
        } catch (error) {
            state.close = "FAILED";
            state.closeFailure = developmentFailure(
                error,
                "service-close",
                state.activeEntry,
            );
            if (!state.failure) state.outcome = "FAILED_DEVELOPMENT_CLOSE";
        }
        await persist();
    }
}

async function runDevelopmentWorker(spec) {
    validateDevelopmentSpec(spec);
    configureDevelopmentDiagnostics(spec);
    const hashes = await snapshotCompiledCheckpoint(spec.productRoot);
    assertCheckpoint(hashes, spec.expectedCheckpoint);
    const load = (relative) =>
        import(pathToFileURL(path.join(spec.productRoot, relative)).href);
    const config = await load("packages\\config\\dist\\index.js");
    const client = await load("packages\\aiclient\\dist\\index.js");
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const { FileMemoryService } = await load(
        "packages\\memory\\service\\dist\\fileMemoryService.js",
    );
    const { createKnowProCorpusIndex } = await load(
        "packages\\memory\\service\\dist\\knowProCorpusIndex.js",
    );
    const { waitForMemoryJob } = await load(
        "packages\\memory\\service\\dist\\rpcFacade.js",
    );
    const events = [];
    const state = {
        mode: spec.mode,
        compiledDigest: digest(JSON.stringify(hashes)),
        cases: { development: { operations: [] } },
        providerRequests: [],
        outcome: "DEVELOPMENT_RUNNING",
        phase: "service-initialize",
        diagnosticPolicy: spec.diagnosticPolicy,
        diagnosticPolicySha256: spec.diagnosticPolicySha256,
    };
    const persist = async () => {
        state.providerRequests = events.map((event) => ({
            role: "ingestion.development",
            status: event.status,
            durationMs: event.durationMs,
            modelSha256: event.model ? digest(String(event.model)) : undefined,
        }));
        await writeJson(
            path.join(spec.runDirectory, "benchmark-state.json"),
            state,
        );
    };
    await persist();
    const restoreObserver = observeProvider(
        events,
        () => "ingestion.development",
    );
    const service = new FileMemoryService(
        path.join(spec.runDirectory, "isolated-store"),
        {
            indexFactory: createKnowProCorpusIndex,
            sourceSynopses: false,
            informationalViews: false,
            viewDrafts: false,
        },
    );
    try {
        await service.initialize();
        const admittedEpochMs = Date.now();
        await writeJson(path.join(spec.runDirectory, "admitted.json"), {
            receiptId: spec.receiptId,
            workerPid: process.pid,
            admittedEpochMs,
            workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
            checkpointExpectationHash: checkpointExpectationHash(
                spec.expectedCheckpoint,
            ),
            compiledHashesHash: state.compiledDigest,
            diagnosticPolicySha256: spec.diagnosticPolicySha256,
        });
        const signal = AbortSignal.timeout(spec.workAllowanceMs - 2 * 60000);
        state.phase = "create-corpus";
        const corpus = await service.createCorpus(
            "DEVELOPMENT ingestion profile: synthetic only",
        );
        await runDevelopmentEntries(
            service,
            waitForMemoryJob,
            corpus.corpusId,
            signal,
            state,
            persist,
        );
        state.outcome = "DEVELOPMENT_INGESTION_COMPLETE";
    } catch (error) {
        state.outcome = "FAILED_DEVELOPMENT_INGESTION";
        state.failure ??= developmentFailure(
            error,
            state.phase,
            state.activeEntry,
        );
        await persist();
    } finally {
        try {
            await closeDevelopmentService(service, state, persist);
        } finally {
            restoreObserver();
        }
        await persist();
    }
    return state.outcome;
}

async function profileDevelopment(
    directory,
    productRoot,
    authorized,
    nativeWorkerCpu = false,
    noStageTiming = false,
) {
    assert.equal(
        authorized,
        true,
        "Development inference requires explicit authorization",
    );
    assert.ok(
        productRoot && path.isAbsolute(productRoot),
        "Absolute product root required",
    );
    await mkdir(directory); // Exclusive: never reuse an existing store or benchmark output.
    const receiptId = randomUUID();
    await writeJson(path.join(directory, "ownership.json"), {
        receiptId,
        runDirectory: directory,
    });
    const hashes = await snapshotCompiledCheckpoint(productRoot);
    const spec = {
        receiptId,
        runDirectory: directory,
        productRoot,
        mode: "DEVELOPMENT_INGESTION_PROFILE",
        authorizedDevelopmentInference: true,
        startupAllowanceMs: 120000,
        workAllowanceMs: 25 * 60000,
        totalAllowanceMs: 30 * 60000,
        expectedCheckpoint: { name: "development-ingestion-frozen", hashes },
        performance: nativeWorkerCpu,
        nativeProfile: nativeWorkerCpu,
        diagnosticPolicy: developmentDiagnosticPolicy(
            !noStageTiming,
            nativeWorkerCpu,
        ),
    };
    spec.diagnosticPolicySha256 = developmentDiagnosticPolicyHash(spec);
    const termination = await supervise(
        spec,
        path.join(import.meta.dirname, "ingestion-profile.mjs"),
        validateDevelopmentSpec,
    );
    assert.equal(termination.workerExited, true);
    assert.equal(alive(termination.workerPid), false);
    let profile;
    let state;
    try {
        profile = await analyzeRun(
            directory,
            path.join(directory, `stderr-${termination.startedEpochMs}.log`),
        );
        state = JSON.parse(
            await readFile(
                path.join(directory, "benchmark-state.json"),
                "utf8",
            ),
        );
    } catch {
        profile = {
            schemaVersion: 2,
            jobCompletion: "INCOMPLETE",
            analysisFailure: true,
            productionTiming: { available: false },
        };
    }
    const timingCapture = developmentTimingCapture(
        spec.diagnosticPolicy,
        profile.productionTiming.available,
    );
    const admission = await readFile(
        path.join(directory, "admitted.json"),
        "utf8",
    )
        .then((text) => JSON.parse(text))
        .catch(() => undefined);
    const diagnosticPolicyMatches =
        state?.diagnosticPolicySha256 === spec.diagnosticPolicySha256 &&
        admission?.diagnosticPolicySha256 === spec.diagnosticPolicySha256 &&
        JSON.stringify(state?.diagnosticPolicy) ===
            JSON.stringify(spec.diagnosticPolicy);
    const complete =
        termination.exit?.code === 0 &&
        state?.outcome === "DEVELOPMENT_INGESTION_COMPLETE" &&
        profile.jobCompletion === "COMPLETE" &&
        diagnosticPolicyMatches &&
        ["CAPTURED", "INTENTIONALLY_DISABLED"].includes(timingCapture);
    await writeJson(path.join(directory, "ingestion-profile.json"), {
        ...profile,
        mode: spec.mode,
        outcome: complete
            ? "DEVELOPMENT_PROFILE_COMPLETE"
            : "FAILED_DEVELOPMENT_PROFILE",
        workerOutcome: state?.outcome ?? "WORKER_STATE_UNAVAILABLE",
        failure: state?.failure,
        closeFailure: state?.closeFailure,
        diagnosticPolicy: spec.diagnosticPolicy,
        diagnosticPolicySha256: spec.diagnosticPolicySha256,
        diagnosticPolicyMatches,
        productionTiming: {
            ...profile.productionTiming,
            capture: timingCapture,
            interpretation:
                spec.diagnosticPolicy.stageTiming === "disabled"
                    ? "Stage timing intentionally disabled by explicit development-only policy; provider metadata, persisted job milestones and optional native worker CPU sampling remain active. Missing stage events are expected, not a capture failure."
                    : profile.productionTiming.interpretation,
        },
        workerExited: termination.workerExited,
        forced: termination.forced,
        exit: termination.exit,
        nativeWorkerCpu: {
            requested: nativeWorkerCpu,
            workerPid: termination.workerPid,
            artifact: termination.nativeProfile ?? null,
            flush: termination.nativeProfileFlush ?? null,
            interpretation: nativeWorkerCpu
                ? "Native V8 samples from the ingestion worker, never the supervisor. Artifact requires separate analysis; forced exit may not flush it."
                : "Native worker CPU sampling not collected. Stage measurements are wall time only.",
        },
        dataPolicy:
            "Fixed synthetic development documents only; no benchmark gold, original-store access or quality score.",
    });
    process.stdout.write(
        JSON.stringify({
            runDirectory: directory,
            outcome: complete
                ? "DEVELOPMENT_PROFILE_COMPLETE"
                : "FAILED_DEVELOPMENT_PROFILE",
        }) + "\n",
    );
    process.exitCode = complete ? 0 : 1;
}

async function profileRun(directory, runnerArgs) {
    const invocation = profileInvocation(runnerArgs);
    await mkdir(directory);
    const stdout = createWriteStream(path.join(directory, "stdout.log"), {
        flags: "wx",
    });
    const stderr = createWriteStream(path.join(directory, "stderr.log"), {
        flags: "wx",
    });
    const child = spawn(invocation.command, invocation.args, {
        cwd: process.cwd(),
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    let tail = "";
    child.stdout.on("data", (chunk) => {
        tail = (tail + chunk).slice(-65536);
        process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    const heartbeat = setInterval(() => {
        process.stdout.write(
            JSON.stringify({
                profiling: "RUNNING",
                supervisorPid: child.pid,
                at: new Date().toISOString(),
            }) + "\n",
        );
    }, 30000);
    heartbeat.unref();
    let exit;
    try {
        exit = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code, signal) => resolve({ code, signal }));
        });
    } finally {
        clearInterval(heartbeat);
    }
    await Promise.all([finished(stdout), finished(stderr)]);
    const last = tail.trim().split(/\r?\n/).at(-1);
    const result = JSON.parse(last);
    assert.ok(
        path.isAbsolute(result.runDirectory),
        "Supervisor omitted run directory",
    );
    const { termination, workerTimingLog, profile } =
        await analyzeSupervisedRun(result.runDirectory);
    await writeJson(path.join(directory, "ingestion-profile.json"), profile);
    await writeJson(path.join(directory, "profile-run.json"), {
        exit,
        termination,
        sourceStateSha256: profile.stateSha256,
        instrumentation:
            "Existing production TYPEAGENT_MEMORY_SEARCH_TRACE; no runtime/source/engine replacement, fetch interception or timeout injection.",
        timingEvents: profile.productionTiming.events,
        workerTimingLog,
        timingCapture: profile.productionTiming.available
            ? "CAPTURED"
            : "UNAVAILABLE",
    });
    if (!profile.productionTiming.available)
        process.stderr.write(
            "No production timing events were captured; inspect the worker outcome and timing log before drawing profiling conclusions.\n",
        );
    process.exitCode =
        exit.code === 0 && !profile.productionTiming.available
            ? 1
            : (exit.code ?? 1);
}

export async function main(args = process.argv.slice(2)) {
    if (args[0] === "--spec") {
        try {
            const outcome = await runDevelopmentWorker(
                JSON.parse(await readFile(args[1], "utf8")),
            );
            process.stdout.write(JSON.stringify({ outcome }) + "\n");
            process.exitCode =
                outcome === "DEVELOPMENT_INGESTION_COMPLETE" ? 0 : 1;
        } catch {
            process.stdout.write('{"outcome":"FAILED_DEVELOPMENT_STARTUP"}\n');
            process.exitCode = 1;
        }
        return;
    }
    const [command, ...rest] = args;
    const separator = rest.indexOf("--");
    const { values } = parseArgs({
        args: separator < 0 ? rest : rest.slice(0, separator),
        options: {
            run: { type: "string" },
            output: { type: "string" },
            "timing-log": { type: "string" },
            product: { type: "string" },
            "authorized-development-inference": { type: "boolean" },
            "native-worker-cpu": { type: "boolean" },
            "no-stage-timing": { type: "boolean" },
        },
    });
    assert.ok(
        command === "development" || !values["no-stage-timing"],
        "--no-stage-timing is development-only",
    );
    assert.ok(
        values.output && path.isAbsolute(values.output),
        "Absolute output path required",
    );
    if (command === "analyze") {
        assert.ok(
            values.run && path.isAbsolute(values.run),
            "Absolute existing run path required",
        );
        const report = await analyzeRun(values.run, values["timing-log"]);
        await mkdir(values.output);
        await writeJson(
            path.join(values.output, "ingestion-profile.json"),
            report,
        );
        process.stdout.write(
            JSON.stringify({
                output: values.output,
                measuredJobs: report.jobs.wallTime.count,
                missingJobIds: report.missingJobIds.length,
                partitions: report.jobs.partitions,
            }) + "\n",
        );
    } else if (command === "development") {
        await profileDevelopment(
            values.output,
            values.product,
            values["authorized-development-inference"],
            values["native-worker-cpu"],
            values["no-stage-timing"],
        );
    } else {
        assert.equal(command, "run", "Expected analyze or run");
        assert.ok(
            separator >= 0,
            "Separate normal benchmark arguments with --",
        );
        await profileRun(values.output, rest.slice(separator + 1));
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    await main();
