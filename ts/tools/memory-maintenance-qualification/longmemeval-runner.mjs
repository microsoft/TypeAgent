// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateLiveResumeSources } from "./live-resume.mjs";
import {
    abortableObservation,
    checkpointObservation,
    createCheckpointObserver,
    knowledgeWaitOutcome,
    knowledgeReadinessError,
} from "./knowledge-observer.mjs";

export const officialJudgeSha256 =
    "ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251";
export const digest = (value) =>
    createHash("sha256").update(value).digest("hex");

export function officialJudgeTemplates(source) {
    assert.equal(
        digest(source),
        officialJudgeSha256,
        "Official judge source changed",
    );
    const templates = [
        ...source.matchAll(/template = ("(?:[^"\\]|\\.)*")/g),
    ].map((match) => JSON.parse(match[1]));
    assert.equal(templates.length, 5, "Official judge template layout changed");
    return templates;
}

export function judgePrompt(templates, reference, hypothesis) {
    const groups = [
        ["single-session-user", "single-session-assistant", "multi-session"],
        ["temporal-reasoning"],
        ["knowledge-update"],
        ["single-session-preference"],
    ];
    const index = reference.question_id.endsWith("_abs")
        ? 4
        : groups.findIndex((types) => types.includes(reference.question_type));
    assert.ok(index >= 0, "Unsupported official question type");
    const values = [reference.question, String(reference.answer), hypothesis];
    let next = 0;
    const prompt = templates[index].replace(/\{\}/g, () => values[next++]);
    assert.equal(next, 3, "Official judge placeholders changed");
    return prompt;
}

export function sessionSource(caseId, session) {
    let text = [
        `# Conversation session ${session.position + 1}`,
        `Session ID: ${session.id}`,
        `Session date: ${session.date}`,
    ].join("\n");
    const scopes = session.turns.map((turn, index) => {
        const start = text.length;
        text += `\n\n## Turn ${index + 1}: ${turn.role}\n${turn.content}`;
        return {
            ownerId: `turn:${index}`,
            start,
            end: text.length,
            role: turn.role,
        };
    });
    return {
        phase: "history",
        sourceKey: `${session.position}:${session.id}`,
        canonicalUri: `longmemeval://${encodeURIComponent(caseId)}/${session.position}`,
        sha256: digest(text),
        sessionId: session.id,
        source: {
            sourceType: "markdown",
            title: `Session ${session.position + 1}: ${session.id}`,
            canonicalUri: `longmemeval://${encodeURIComponent(caseId)}/${session.position}`,
            text,
            temporalContext: {
                version: 1,
                scopes: [
                    {
                        ownerId: "session",
                        start: 0,
                        end: text.length,
                        messageTime: session.date,
                    },
                    ...scopes,
                ],
            },
        },
    };
}

export const historyBatchByteLimit = 8 * 1024 * 1024;

export function historyBatchRequests(corpusId, plan, sources = []) {
    const fingerprint = digest(
        JSON.stringify(plan.map((entry) => entry.source)),
    );
    const requests = [];
    let request;
    for (const entry of plan) {
        const document = {
            source: {
                ...entry.source,
                sourceId:
                    sources.find(
                        (source) => source.canonicalUri === entry.canonicalUri,
                    )?.sourceId ?? `longmemeval-${digest(entry.canonicalUri)}`,
            },
            pipeline: { updatePolicy: "skipIfUnchanged" },
        };
        const key = `history:${digest(entry.sourceKey)}`;
        const next = () => ({
            corpusId,
            idempotencyKey: `longmemeval:${
                requests.length
                    ? digest(`${fingerprint}:${requests.length}`)
                    : fingerprint
            }`,
            documentKeys: [key],
            documents: [document],
        });
        const candidate = request && {
            ...request,
            documentKeys: [...request.documentKeys, key],
            documents: [...request.documents, document],
        };
        if (
            candidate &&
            candidate.documents.length <= 50 &&
            Buffer.byteLength(JSON.stringify(candidate)) <=
                historyBatchByteLimit
        ) {
            request = candidate;
            requests[requests.length - 1] = request;
        } else {
            request = next();
            assert.ok(
                Buffer.byteLength(JSON.stringify(request)) <=
                    historyBatchByteLimit,
                `History session ${entry.sourceKey} exceeds the durable batch 8 MB request limit`,
            );
            requests.push(request);
        }
    }
    return { fingerprint, requests };
}

function activeHistoryBatch(batch) {
    return ["running", "cancelling"].includes(batch.state);
}

function historyImportState(groups) {
    if (groups.some(activeHistoryBatch)) return "running";
    if (groups.some((group) => group.state === "pending")) return "pending";
    if (groups.every((group) => group.state === "complete")) return "complete";
    if (groups.length === 1) return groups[0].state;
    return groups.every((group) =>
        ["complete", "cancelled"].includes(group.state),
    )
        ? "cancelled"
        : "partial";
}

async function pauseHistoryImport(signal) {
    let timer;
    try {
        await abortableObservation(
            new Promise((resolve) => {
                timer = setTimeout(resolve, 250);
            }),
            signal,
        );
    } finally {
        clearTimeout(timer);
    }
}

async function cancelHistoryImports(service, groups, retain) {
    const errors = [];
    for (const [index, group] of groups.entries()) {
        if (!activeHistoryBatch(group) || !group.batchId) continue;
        try {
            assert.equal(typeof service.cancelBatchImport, "function");
            await retain(index, await service.cancelBatchImport(group.batchId));
        } catch (error) {
            errors.push(error);
        }
    }
    return errors;
}

async function importHistory(service, construction, plan, record, controls) {
    assert.equal(
        typeof service.startBatchImport,
        "function",
        "Durable batch imports are unavailable",
    );
    assert.equal(
        typeof service.getBatchImport,
        "function",
        "Durable batch status reads are unavailable",
    );
    const applied = await validateLiveResumeSources(
        service,
        record.corpusId,
        plan,
        record,
        { allowUnacknowledgedSources: true },
    );
    if (applied === plan.length && !record.batchImport) return;
    const { signal, persist } = controls;
    signal.throwIfAborted();
    controls.role(`ingestion:${construction.id}`);
    const { fingerprint, requests } = historyBatchRequests(
        record.corpusId,
        plan,
        await service.listSources(record.corpusId),
    );
    const retained = record.batchImport;
    if (retained)
        assert.equal(
            retained.fingerprint,
            fingerprint,
            "Benchmark batch input changed",
        );
    const previous = retained?.batches ?? (retained?.batchId ? [retained] : []);
    assert.ok(
        previous.length <= requests.length,
        "Benchmark batch groups changed",
    );
    const groups = requests.map((request, index) => {
        const group = previous[index];
        if (group?.idempotencyKey)
            assert.equal(group.idempotencyKey, request.idempotencyKey);
        return {
            state: "pending",
            members: [],
            ...structuredClone(group),
            idempotencyKey: request.idempotencyKey,
            documentKeys: request.documentKeys,
        };
    });
    const publish = async () => {
        record.batchImport = {
            ...(groups.length === 1 ? groups[0] : {}),
            fingerprint,
            state: historyImportState(groups),
            members: structuredClone(groups.flatMap((group) => group.members)),
            batches: structuredClone(groups),
        };
        const byKey = new Map(
            groups.flatMap((group) =>
                group.members.map((member) => [
                    member.clientKey,
                    { ...member, batchId: group.batchId },
                ]),
            ),
        );
        const actual = await service.listSources(record.corpusId);
        for (const entry of plan.slice(record.operations.length)) {
            const member = byKey.get(`history:${digest(entry.sourceKey)}`);
            if (!member) break;
            if (!["complete", "duplicate"].includes(member.state)) break;
            const source = actual.find(
                (item) => item.sourceId === member.sourceId,
            );
            assert.equal(source?.canonicalUri, entry.canonicalUri);
            const revision = source.revisions.find(
                (item) => item.revisionId === member.revisionId,
            );
            assert.equal(source.activeRevisionId, member.revisionId);
            assert.equal(revision?.contentHash, entry.sha256);
            assert.equal(
                revision?.state,
                "ready",
                "Batch revision is not ready",
            );
            record.operations.push({
                phase: entry.phase,
                sourceKey: entry.sourceKey,
                fixtureSha256: entry.sha256,
                sourceId: member.sourceId,
                revisionId: member.revisionId,
                jobId: member.jobId,
                batchId: member.batchId,
                state: "complete",
            });
            record.mappings[entry.sourceKey] = {
                sourceId: member.sourceId,
                revisionId: member.revisionId,
            };
        }
        delete record.inFlight;
        await persist();
    };
    const retain = async (index, status) => {
        const group = groups[index];
        assert.equal(status.corpusId, record.corpusId);
        assert.equal(status.members.length, requests[index].documents.length);
        if (group.batchId) assert.equal(status.batchId, group.batchId);
        const keys = new Set(status.members.map((member) => member.clientKey));
        assert.equal(
            keys.size,
            group.documentKeys.length,
            "Batch member keys changed",
        );
        for (const key of group.documentKeys)
            assert.ok(keys.has(key), "Required batch member is missing");
        Object.assign(group, structuredClone(status));
        await publish();
    };
    const admit = async (index) => {
        signal.throwIfAborted();
        let batch = await service.startBatchImport(requests[index]);
        await retain(index, batch);
        signal.throwIfAborted();
        if (
            retained &&
            ["partial", "failed", "cancelled", "interrupted"].includes(
                batch.state,
            )
        ) {
            assert.equal(
                typeof service.retryBatchImport,
                "function",
                "Interrupted benchmark batch cannot be retried",
            );
            batch = await service.retryBatchImport(batch.batchId);
            await retain(index, batch);
        }
    };
    await publish();
    signal.throwIfAborted();
    try {
        let next = 0;
        while (next < requests.length || groups.some(activeHistoryBatch)) {
            // Admit bounded groups before joining work; the service holds
            // automatic maintenance while any of these imports is active.
            while (
                next < requests.length &&
                groups.filter(activeHistoryBatch).length < 4
            ) {
                await admit(next++);
            }
            if (!groups.some(activeHistoryBatch)) continue;
            await pauseHistoryImport(signal);
            for (const [index, group] of groups.entries())
                if (activeHistoryBatch(group))
                    await retain(
                        index,
                        await service.getBatchImport(group.batchId),
                    );
            signal.throwIfAborted();
        }
        assert.equal(
            record.batchImport.state,
            "complete",
            `Benchmark batch did not complete: ${record.batchImport.state}; ${record.batchImport.members
                .filter(
                    (member) =>
                        !["complete", "duplicate"].includes(member.state),
                )
                .map(
                    (member) =>
                        `${member.clientKey}: ${member.state}: ${member.reason ?? ""}`,
                )
                .join("; ")}`,
        );
        assert.equal(record.operations.length, plan.length);
    } catch (error) {
        const cancellationErrors = await cancelHistoryImports(
            service,
            groups,
            retain,
        );
        if (cancellationErrors.length)
            throw new AggregateError(
                [signal.aborted ? signal.reason : error, ...cancellationErrors],
                "Benchmark batch cancellation could not be retained",
            );
        throw signal.aborted ? signal.reason : error;
    }
}

async function prepareKnowledge(service, construction, record, controls) {
    if (!service.createKnowledgeCheckpoint) return;
    assert.equal(typeof service.waitForKnowledgeCheckpoint, "function");
    controls.signal.throwIfAborted();
    controls.role(`knowledge:${construction.id}`);
    const timeoutMs = controls.knowledgeTimeoutMs ?? 600000;
    if (!record.knowledgeCheckpoint) {
        record.knowledgeCheckpoint = await service.createKnowledgeCheckpoint({
            corpusId: record.corpusId,
            sourceIds: [
                ...new Set(
                    Object.values(record.mappings).map(
                        (entry) => entry.sourceId,
                    ),
                ),
            ],
            producerComplete: true,
            timeoutMs,
        });
        await controls.persist();
    }
    const failure =
        controls.failure ??
        ((error) => ({
            name: error.name,
            message: error.message,
        }));
    const observer = service.getKnowledgeCheckpoint
        ? createCheckpointObserver(service, record, { ...controls, failure })
        : undefined;
    const waitController = new AbortController();
    const waitSignal = AbortSignal.any([
        controls.signal,
        waitController.signal,
    ]);
    const observed = observer?.done.then(
        () => {
            if (!record.knowledgeCheckpoint.requiredFailures?.length)
                return undefined;
            const error = knowledgeReadinessError(record.knowledgeCheckpoint);
            waitController.abort(error);
            return error;
        },
        (error) => {
            waitController.abort(error);
            return error;
        },
    );
    const wait = (record.knowledgeWait = {
        startedEpochMs: Date.now(),
        outcome: "running",
    });
    let executionError;
    try {
        let waitError;
        try {
            const checkpoint = await abortableObservation(
                service.waitForKnowledgeCheckpoint({
                    corpusId: record.corpusId,
                    checkpointId: record.knowledgeCheckpoint.checkpointId,
                    timeoutMs,
                    failOnRequiredFailure: true,
                }),
                waitSignal,
            );
            wait.outcome = "returned";
            wait.returnedState = checkpoint.state;
            if (!observer) {
                record.knowledgeCheckpoint = checkpoint;
                record.knowledgeObservation = {
                    ...checkpointObservation(checkpoint),
                    status: "current",
                    active: false,
                    source: "wait-return",
                };
            }
        } catch (error) {
            waitError = error;
            wait.outcome = knowledgeWaitOutcome(error, waitSignal);
            wait.error = failure(error);
        }
        wait.finishedEpochMs = Date.now();
        if (observer) {
            try {
                await observer.refresh();
            } catch (statusError) {
                if (!waitError) throw statusError;
                throw new AggregateError(
                    [waitError, statusError],
                    "Knowledge wait failed and checkpoint status could not be retained",
                );
            }
        }
        await controls.persist();
        if (waitError) {
            if (record.knowledgeCheckpoint.requiredFailures?.length)
                waitError.cause ??= knowledgeReadinessError(
                    record.knowledgeCheckpoint,
                );
            throw waitError;
        }
        if (
            record.knowledgeCheckpoint.state !== "ready" ||
            record.knowledgeCheckpoint.requiredFailures?.length
        )
            throw knowledgeReadinessError(record.knowledgeCheckpoint);
    } catch (error) {
        executionError = error;
        throw error;
    } finally {
        if (observer) {
            await Promise.allSettled([observer.stop()]);
            const observationError = await observed;
            if (observationError && !executionError) throw observationError;
        }
    }
}

export async function preflightRetainedKnowledge(service, records, controls) {
    const retained = Object.values(records).filter(
        (record) => record?.corpusId,
    );
    async function inspect(record) {
        controls.signal.throwIfAborted();
        const report = (record.retainedKnowledgePreflight ??= {
            attempts: [],
        });
        const attempt = { startedEpochMs: Date.now(), status: "reading" };
        report.attempts.push(attempt);
        try {
            const status = await (controls.readRetainedKnowledgeStatus
                ? controls.readRetainedKnowledgeStatus(record.corpusId)
                : service.getKnowledgeStatus(record.corpusId));
            controls.signal.throwIfAborted();
            attempt.failedReceipts = structuredClone(
                status.discovery.receipts.filter(
                    (receipt) => receipt.state === "failed",
                ),
            );
            attempt.interruptedReceipts = structuredClone(
                status.discovery.receipts.filter(
                    (receipt) => receipt.state === "running",
                ),
            );
            attempt.discoveryError = status.discovery.error;
            attempt.status =
                attempt.failedReceipts.length ||
                attempt.interruptedReceipts.length ||
                attempt.discoveryError
                    ? "blocked"
                    : "clear";
            attempt.observedEpochMs = Date.now();
        } catch (error) {
            attempt.status = "unknown";
            attempt.error = controls.failure(error);
            try {
                await controls.persist();
            } catch (persistError) {
                attempt.persistenceError = controls.failure(persistError);
                throw new AggregateError(
                    [error, persistError],
                    "Retained preflight status and persistence failed",
                );
            }
            throw error;
        }
        await controls.persist();
    }
    const errors = [];
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(2, retained.length) }, async () => {
            while (next < retained.length) {
                const record = retained[next++];
                try {
                    await inspect(record);
                } catch (error) {
                    errors.push(error);
                }
            }
        }),
    );
    if (errors.length)
        throw new AggregateError(errors, "Retained knowledge preflight failed");
}

export async function executeMemoryCase(
    service,
    construction,
    reader,
    reference,
    record,
    controls,
) {
    const { persist, signal, judge, role } = controls;
    const ingestionStart = performance.now();
    const plan = construction.sessions.map((session) =>
        sessionSource(construction.id, session),
    );
    if (typeof service.deferTopicMaintenance !== "function")
        throw new Error(
            "Production benchmark requires scoped topic scheduling",
        );
    const releaseTopics = service.deferTopicMaintenance(record.corpusId);
    record.topicMaintenanceCoalesced = true;
    try {
        await importHistory(service, construction, plan, record, controls);
    } finally {
        releaseTopics();
    }
    record.ingestionMilliseconds =
        (record.ingestionMilliseconds ?? 0) +
        performance.now() -
        ingestionStart;
    if (!record.hypothesis) {
        const knowledgeStart = performance.now();
        await prepareKnowledge(service, construction, record, controls);
        record.knowledgeReadinessMilliseconds =
            performance.now() - knowledgeStart;
    }
    const question = reader.question;
    const temporalContext = {
        referenceTime: reader.question_date,
        availabilityPolicy: "supplied-history",
    };
    if (!record.hypothesis) {
        signal.throwIfAborted();
        record.status = "answering";
        await persist();
        role(`answer:${construction.id}`);
        const answerStart = performance.now();
        const answer = await service.answer({
            corpusId: record.corpusId,
            question,
            temporalContext,
            includeDiagnostics: true,
            ...(record.knowledgeCheckpoint
                ? {
                      knowledgeCheckpointId:
                          record.knowledgeCheckpoint.checkpointId,
                      retrievalPolicy: "sourcesAndViews",
                  }
                : {}),
        });
        assert.equal(
            answer.mode,
            "synthesized",
            "Extractive output is not a benchmark answer",
        );
        assert.ok(answer.answer.trim(), "Empty benchmark hypothesis");
        record.answerMilliseconds = performance.now() - answerStart;
        record.hypothesis = answer.answer;
        record.citations = answer.citations;
        record.readerContext = answer.readerContext;
        record.answerPath = answer.readerContext?.answerPath ?? "knowpro";
        record.indexVersion = answer.indexVersion;
        record.warnings = answer.warnings;
        record.derivedReferences = answer.derivedReferences;
        record.assertionReferences = answer.assertionReferences;
        const sourceToSession = new Map(
            plan.map((entry) => [
                record.mappings[entry.sourceKey].sourceId,
                entry.sessionId,
            ]),
        );
        const expected = new Set(reference.answer_session_ids);
        if (answer.readerContext) {
            const recall = (sourceIds) => {
                const sessions = new Set(
                    sourceIds.map((id) => sourceToSession.get(id)),
                );
                return expected.size
                    ? [...expected].filter((id) => sessions.has(id)).length /
                          expected.size
                    : null;
            };
            record.answerRetrievalEvidenceSessionRecall = recall(
                answer.readerContext.retrievedSourceIds,
            );
            record.readerMessageEvidenceSessionRecall = recall(
                answer.readerContext.messageSourceIds,
            );
            record.readerKnowledgeEvidenceSessionRecall = recall(
                answer.readerContext.knowledgeSourceIds,
            );
        }
        await persist();
    }
    signal.throwIfAborted();
    role(`judge:${construction.id}`);
    record.status = "judging";
    await persist();
    record.autoeval_label = await judge(reference, record.hypothesis, signal);
    assert.equal(typeof record.autoeval_label.label, "boolean");
    assert.ok(record.autoeval_label.model);
    record.status = "complete";
    await persist();
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    return (
        sorted[lower] +
        (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
    );
}

export function benchmarkScorecard(prepared, records, events) {
    const references = prepared.evaluatorOnly.references;
    const summarize = (rows) => {
        const scored = rows.filter(
            (row) => records[row.question_id]?.status === "complete",
        );
        const correct = scored.filter(
            (row) => records[row.question_id].autoeval_label.label,
        ).length;
        return {
            scheduled: rows.length,
            scored: scored.length,
            correct,
            missing: rows.length - scored.length,
            observedAccuracy: scored.length ? correct / scored.length : null,
            fullScheduleAccuracy:
                scored.length === rows.length ? correct / rows.length : null,
        };
    };
    const completed = Object.values(records).filter(
        (record) => record.status === "complete",
    );
    const answerTimes = completed.map((record) => record.answerMilliseconds);
    const usages = events
        .filter((event) => event.usage)
        .map(({ usage }) => {
            const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
            const completion =
                usage.completion_tokens ?? usage.output_tokens ?? 0;
            return {
                prompt,
                completion,
                total: usage.total_tokens ?? prompt + completion,
            };
        });
    return {
        protocol:
            "Official reference answers and pinned judge prompts; actual configured judge model, not assumed official GPT-4o",
        dataset: prepared.manifest.provenance,
        total: summarize(references),
        officialQuestionTypes: Object.fromEntries(
            [...new Set(references.map((row) => row.question_type))].map(
                (type) => [
                    type,
                    summarize(
                        references.filter((row) => row.question_type === type),
                    ),
                ],
            ),
        ),
        abstention: summarize(
            references.filter((row) => row.question_id.endsWith("_abs")),
        ),
        failed: Object.values(records).filter(
            (record) => record.status === "failed",
        ).length,
        answerLatencyMs: {
            p50: percentile(answerTimes, 0.5),
            p95: percentile(answerTimes, 0.95),
        },
        evidenceCoverage: Object.fromEntries(
            [
                "evidenceSessionRecallAt20Matches",
                "answerRetrievalEvidenceSessionRecall",
                "readerMessageEvidenceSessionRecall",
                "readerKnowledgeEvidenceSessionRecall",
            ].map((field) => {
                const values = completed
                    .map((record) => record[field])
                    .filter((value) => typeof value === "number");
                return [
                    field,
                    {
                        measuredQuestions: values.length,
                        mean: values.length
                            ? values.reduce((sum, value) => sum + value, 0) /
                              values.length
                            : null,
                    },
                ];
            }),
        ),
        judgeModels: [
            ...new Set(completed.map((record) => record.autoeval_label.model)),
        ],
        observedRequests: events.length,
        requestsWithUsage: usages.length,
        knownPromptTokens: usages.reduce((sum, usage) => sum + usage.prompt, 0),
        knownCompletionTokens: usages.reduce(
            (sum, usage) => sum + usage.completion,
            0,
        ),
        knownTotalTokens: usages.reduce((sum, usage) => sum + usage.total, 0),
        dollarCost: null,
        costQualification:
            "Observed provider usage only; no verified token pricing configured; interrupted requests may lack usage",
        comparisonQualification:
            completed.length === references.length
                ? "Full coverage; dataset version, reader and judge differences still prevent an uncontrolled leaderboard ranking"
                : "Incomplete bounded run: observed-prefix accuracy is not a full-suite comparison",
    };
}
