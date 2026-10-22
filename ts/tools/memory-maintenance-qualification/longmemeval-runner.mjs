// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    reconcileLiveSource,
    validateLiveResumeSources,
} from "./live-resume.mjs";

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

export async function executeMemoryCase(
    service,
    construction,
    reader,
    reference,
    record,
    controls,
) {
    const { persist, signal, waitForMemoryJob, judge, role } = controls;
    const plan = construction.sessions.map((session) =>
        sessionSource(construction.id, session),
    );
    const applied = await validateLiveResumeSources(
        service,
        record.corpusId,
        plan,
        record,
    );
    for (const entry of plan.slice(applied)) {
        signal.throwIfAborted();
        role(`ingestion:${construction.id}`);
        const admitted = await reconcileLiveSource(
            service,
            record.corpusId,
            entry,
            record.mappings[entry.sourceKey],
            entry.source,
            true,
        );
        record.inFlight = {
            phase: entry.phase,
            sourceKey: entry.sourceKey,
            fixtureSha256: entry.sha256,
            ...admitted,
        };
        await persist();
        const job = admitted.jobId
            ? await waitForMemoryJob(service, admitted.jobId, {
                  signal,
                  pollIntervalMs: 100,
              })
            : admitted;
        assert.equal(
            job.state,
            "complete",
            `Benchmark ingestion did not complete: ${job.state}`,
        );
        record.operations.push({ ...record.inFlight, state: "complete" });
        record.mappings[entry.sourceKey] = {
            sourceId: admitted.sourceId,
            revisionId: admitted.revisionId,
        };
        delete record.inFlight;
        await persist();
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
        role(`search:${construction.id}`);
        const start = performance.now();
        const retrieved = await service.search({
            corpusId: record.corpusId,
            query: question,
            temporalContext,
            limit: 20,
        });
        record.searchMilliseconds = performance.now() - start;
        record.retrievedSourceIds = retrieved.matches.map(
            (match) => match.sourceId,
        );
        role(`answer:${construction.id}`);
        const answerStart = performance.now();
        const answer = await service.answer({
            corpusId: record.corpusId,
            question,
            temporalContext,
            limit: 12,
            answerMode: "synthesized",
            includeDiagnostics: true,
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
        record.indexVersion = answer.indexVersion;
        record.warnings = answer.warnings;
        const sourceToSession = new Map(
            plan.map((entry) => [
                record.mappings[entry.sourceKey].sourceId,
                entry.sessionId,
            ]),
        );
        const returned = new Set(
            record.retrievedSourceIds.map((id) => sourceToSession.get(id)),
        );
        const expected = new Set(reference.answer_session_ids);
        record.evidenceSessionRecallAt20Matches = expected.size
            ? [...expected].filter((id) => returned.has(id)).length /
              expected.size
            : null;
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
    const usages = events.filter((event) => event.usage);
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
        knownPromptTokens: usages.reduce(
            (sum, event) => sum + (event.usage.prompt_tokens ?? 0),
            0,
        ),
        knownCompletionTokens: usages.reduce(
            (sum, event) => sum + (event.usage.completion_tokens ?? 0),
            0,
        ),
        knownTotalTokens: usages.reduce(
            (sum, event) => sum + (event.usage.total_tokens ?? 0),
            0,
        ),
        dollarCost: null,
        costQualification:
            "Observed provider usage only; no verified token pricing configured; interrupted requests may lack usage",
        comparisonQualification:
            completed.length === references.length
                ? "Full coverage; dataset version, reader and judge differences still prevent an uncontrolled leaderboard ranking"
                : "Incomplete bounded run: observed-prefix accuracy is not a full-suite comparison",
    };
}
