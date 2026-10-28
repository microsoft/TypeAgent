// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    countO200kTokens,
    createDecisionModel,
    getRuntimeConfigGeneration,
    validateDecisionRequest,
    RequestBudget,
    runWithRequestBudget,
    RequestAdmissionError,
    getRuntimeConfig,
    setRuntimeConfig,
    type DecisionAnswer,
    type DecisionModel,
    type DecisionRequest,
    type DecisionResponse,
    type DecisionResult,
} from "@typeagent/aiclient";
import { buildConfig } from "@typeagent/config";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import {
    curateTopicsWithDecision,
    prepareTopicDecisionBatch,
} from "../src/topicDecisionCuration.js";
import { executeTopicDecisionWave } from "../src/topicDecisionWave.js";
import { TopicEvidenceIndex } from "../src/topicIndexes.js";
import {
    buildTopicDecisionRequest,
    groundTopicCandidate,
    packTopicDecisions,
    topicDecisionIdentity,
    topicSalience,
    type TopicDecisionReceipt,
    type TopicDecisionTask,
    resolveTopicDecisionExecution,
} from "../src/topicDecision.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "../src/topicTypes.js";
import type { TopicCurationCompletion } from "../src/topicCuration.js";
import {
    evidenceArray,
    evidenceRecord,
    evidenceText,
} from "../src/viewSynthesisEvidence.js";
import { getConfiguredMemoryViewOptions } from "../src/viewHostOptions.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { viewHash } from "../src/viewMerge.js";
import { createConfiguredTopicGenerator } from "../src/topicGeneration.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function snapshot(count = 3): TopicSnapshot {
    const occurrences = Array.from({ length: count }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${String(index).padStart(3, "0")}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: `Mercury ${index} is a scoped reference explanation.`,
                score: 1,
            },
            "Mercury",
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "test",
        generation: "generation",
        inputFingerprint: "a".repeat(64),
        recipe: "curated-decision-v1",
        generatedAt: "2026-10-25T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("test", occurrences),
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        parents: [],
        related: [],
        limits: [],
    };
}
function concept(value: TopicSnapshot, index = 0): TopicConcept {
    return {
        id: `concept:${String(index).padStart(32, "0")}`,
        label: "Mercury",
        scope: "Astronomy",
        purpose: "Understand the planet",
        memberIds: [value.nodes[index].id],
        citations: value.nodes[index].citations,
        salience: 4,
        summary: "",
        summaryState: "pending",
    };
}
function answer(
    request: DecisionRequest,
    select: (key: string, request: DecisionRequest) => string = () =>
        "standalone_new",
    score = 4,
): DecisionResponse {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [name, question] of Object.entries(request.questions)) {
        if (question.type === "choice") {
            const choice = select(name.replace("disposition_", ""), request);
            answers[name] = {
                type: "choice",
                choice,
                probabilities: Object.fromEntries(
                    Object.keys(question.criteria).map((key) => [
                        key,
                        key === choice ? 1 : 0,
                    ]),
                ),
            };
        } else if (question.type === "score")
            answers[name] = {
                type: "score",
                score,
                probabilities: Object.fromEntries(
                    question.criteria.map((_, index) => [
                        String(index),
                        index === 4 ? 1 : 0,
                    ]),
                ),
            };
    }
    return { answers, requestedModel: "offline", provider: "azure" };
}
function model(
    decide: (
        request: DecisionRequest,
    ) => Promise<DecisionResult<DecisionResponse>>,
): DecisionModel {
    return {
        provider: "azure",
        model: "offline",
        providerSource: "factory",
        configGeneration: getRuntimeConfigGeneration(),
        decide,
    };
}
const noAuthoring: TopicCurationCompletion = async () => {
    throw new Error("Unexpected generative call");
};
const author: TopicCurationCompletion = async (_rules, payload) => ({
    concepts: evidenceArray(evidenceRecord(payload).clusters, 256).map(
        (raw) => ({
            clusterId: evidenceText(evidenceRecord(raw).clusterId),
            label: "Mercury",
            scope: "Reference",
            purpose: "Understand this scoped explanation",
        }),
    ),
});
function run(
    value: TopicSnapshot,
    native: DecisionModel,
    complete = author,
    checkpoint?: (value: TopicCuration) => Promise<void>,
    reusable?: TopicCuration,
    onReceipt?: (value: TopicDecisionReceipt) => void,
) {
    return curateTopicsWithDecision(
        value,
        (node) => node.citations,
        complete,
        new AbortController().signal,
        { model: native, ...(onReceipt ? { onReceipt } : {}) },
        checkpoint,
        reusable,
    );
}
function task(value: TopicSnapshot, index = 0): TopicDecisionTask {
    return {
        candidate: groundTopicCandidate(
            value,
            value.nodes[index],
            value.nodes[index].citations,
            `n${index}`,
        ),
        targets: [],
        score: true,
    };
}

test("complete logical requests are o200k counted at the exact boundary and companion questions share evidence", () => {
    const value = snapshot(2);
    const first = task(value);
    const second = task(value, 1);
    second.targets.push({ key: "n0", candidate: first.candidate });
    const request = buildTopicDecisionRequest([first, second]);
    validateDecisionRequest(request);
    const serialized = JSON.stringify({ model: "offline", ...request });
    expect((serialized.match(/Mercury 0 is a scoped/g) ?? []).length).toBe(1);
    const tokens = countO200kTokens(serialized);
    expect(packTopicDecisions([first, second], "offline", tokens)).toHaveLength(
        1,
    );
    const single = packTopicDecisions([first], "offline")[0];
    expect(
        packTopicDecisions([first], "offline", single.tokens)[0].tokens,
    ).toBe(single.tokens);
    expect(() =>
        packTopicDecisions([first], "offline", single.tokens - 1),
    ).toThrow("candidate exceeds");
    expect(request.questions.salience_n1.instructions).toContain(
        "own evidence",
    );
});

test("bounded fixed-packet waves reduce in packet order despite reversed response order", async () => {
    const value = snapshot(4);
    const packets = packTopicDecisions(
        value.nodes.map((_, index) => task(value, index)),
        "offline",
        24576,
        (request) => {
            if (Object.keys(request.questions).length > 2)
                throw new RequestAdmissionError("One focal per request");
        },
    );
    let active = 0,
        peak = 0;
    const native = model(async (request) => {
        active++;
        peak = Math.max(peak, active);
        const key = Object.keys(request.questions)[0];
        await new Promise((resolve) =>
            setTimeout(resolve, key.endsWith("0") ? 20 : 1),
        );
        active--;
        return { success: true, data: answer(request) };
    });
    const responses = await executeTopicDecisionWave(
        { model: native, concurrency: 2 },
        packets,
        new AbortController().signal,
        "test",
    );
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(
        responses.map((response) => Object.keys(response.answers)[0]),
    ).toEqual(
        packets.map((packet) => Object.keys(packet.request.questions)[0]),
    );
});

test("partition receipts distinguish nominated concepts, actual target exposure and unavailable grounding without changing packets", async () => {
    const value = snapshot(4);
    const candidate = task(value);
    candidate.nomination = { availableConcepts: 3, nominatedConcepts: 3 };
    const targets = [task(value, 1).candidate, task(value, 2).candidate];
    targets[1].complete = false;
    const packets = targets.flatMap((target) =>
        packTopicDecisions(
            [
                {
                    ...candidate,
                    targets: [{ key: target.key, candidate: target }],
                },
            ],
            "offline",
        ),
    );
    const hashes = packets.map((packet) => viewHash(packet.request));
    const receipts: TopicDecisionReceipt[] = [];
    await executeTopicDecisionWave(
        {
            concurrency: 24,
            model: model(async (request) => ({
                success: true,
                data: answer(request),
            })),
            onReceipt: (receipt) => receipts.push(receipt),
        },
        packets,
        new AbortController().signal,
        "candidate-disposition",
    );
    expect(receipts.map((receipt) => receipt.requestHash)).toEqual(hashes);
    expect(packets.map((packet) => viewHash(packet.request))).toEqual(hashes);
    expect(receipts.map((receipt) => receipt.nativePhase)).toEqual([
        "classification",
        "classification",
    ]);
    expect(
        receipts.flatMap(
            (receipt) => receipt.targetExposure![0].evaluatedTargetIds,
        ),
    ).toEqual(targets.map((target) => target.node.id));
    expect(receipts[1].targetExposure![0].unavailableTargetIds).toEqual([
        targets[1].node.id,
    ]);
    expect(receipts[0].nomination![0].nominatedConcepts).toBe(3);
    expect(
        receipts.every(
            (receipt) => receipt.providerAttemptBreakdown === "unavailable",
        ),
    ).toBe(true);
});

test("failed waves cancel queued work and drain in-flight calls before rejecting", async () => {
    const value = snapshot(4);
    const packets = value.nodes.map(
        (_, index) => packTopicDecisions([task(value, index)], "offline")[0],
    );
    let calls = 0,
        active = 0;
    const native = model(async (request) => {
        calls++;
        active++;
        if (calls === 1) {
            await new Promise((resolve) => setTimeout(resolve, 2));
            active--;
            return {
                success: false,
                code: "provider",
                httpStatus: 500,
                message: "Synthetic provider failure",
                errorCategory: "provider",
                retryable: false,
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return { success: true, data: answer(request) };
    });
    await expect(
        executeTopicDecisionWave(
            { model: native, concurrency: 2 },
            packets,
            new AbortController().signal,
            "test",
        ),
    ).rejects.toThrow("inference failed");
    expect(calls).toBe(2);
    expect(active).toBe(0);
});

test.each([24, 48, "context"] as const)(
    "batch policy %s can exceed 24 without losing node coverage",
    async (batchSize) => {
        const value = snapshot(48);
        const prepared = prepareTopicDecisionBatch(
            value,
            {
                model: model(async (request) => ({
                    success: true,
                    data: answer(request),
                })),
                batchSize,
            },
            undefined,
            48,
        );
        if (batchSize === "context")
            expect(prepared.candidateIds.length).toBeGreaterThan(24);
        if (batchSize === 48) expect(prepared.candidateIds).toHaveLength(48);
        const index = new TopicEvidenceIndex(value);
        const result = await curateTopicsWithDecision(
            value,
            (node) => index.evidenceFor(node),
            author,
            new AbortController().signal,
            {
                model: model(async (request) => ({
                    success: true,
                    data: answer(request),
                })),
                batchSize,
                concurrency: 2,
            },
        );
        expect(
            result.concepts.flatMap((entry) => entry.memberIds),
        ).toHaveLength(48);
        expect(result.deferred).toHaveLength(0);
        validateTopicSnapshot({ ...value, curation: result });
    },
);

test.each([false, true])(
    "lookahead validates newly relevant nominations before reusing classifications (related=%s)",
    async (related) => {
        const value = snapshot(4);
        if (!related)
            value.nodes.forEach((node, index) => {
                node.label = `distinct${index}`;
            });
        const receipts: TopicDecisionReceipt[] = [];
        let active = 0,
            peak = 0;
        const native = model(async (request) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active--;
            return { success: true, data: answer(request) };
        });
        const result = await curateTopicsWithDecision(
            value,
            (node) => node.citations,
            author,
            new AbortController().signal,
            {
                model: native,
                batchSize: 2,
                lookahead: 2,
                concurrency: 2,
                onReceipt: (receipt) => receipts.push(receipt),
            },
        );
        validateTopicSnapshot({ ...value, curation: result });
        expect(
            result.concepts.flatMap((entry) => entry.memberIds),
        ).toHaveLength(4);
        expect(peak).toBe(2);
        expect(
            receipts.some(
                (entry) =>
                    entry.reason ===
                    (related ? "lookahead-inputs-changed" : "lookahead-reused"),
            ),
        ).toBe(true);
    },
);

test("execution options are validated and identity includes nondefault scheduling", () => {
    const native = model(async (request) => ({
        success: true,
        data: answer(request),
    }));
    for (const options of [
        { concurrency: 0 },
        { concurrency: 25 },
        { batchSize: 0 },
        { lookahead: 5 },
        { maxQuestions: 257 },
    ])
        expect(() => resolveTopicDecisionExecution(options)).toThrow();
    expect(topicDecisionIdentity(native)).toBe(
        topicDecisionIdentity(native, "v2", { concurrency: 1, batchSize: 24 }),
    );
    expect(topicDecisionIdentity(native, "v2", { concurrency: 4 })).not.toBe(
        topicDecisionIdentity(native),
    );
    expect(
        topicDecisionIdentity(native, "v2", { fullTransactions: true }),
    ).not.toBe(topicDecisionIdentity(native));
    expect(resolveTopicDecisionExecution({ concurrency: 24 }).concurrency).toBe(
        24,
    );
});

test.each([false, true])(
    "full transactions author in parallel and validate group commits (related=%s)",
    async (related) => {
        const value = snapshot(4);
        if (!related)
            value.nodes.forEach((node, index) => {
                node.label = `distinct${index}`;
            });
        const receipts: TopicDecisionReceipt[] = [];
        const checkpoints: TopicCuration[] = [];
        let active = 0,
            peak = 0;
        const complete: TopicCurationCompletion = async (...args) => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            const result = await author(...args);
            active--;
            return result;
        };
        const result = await curateTopicsWithDecision(
            value,
            (node) => node.citations,
            complete,
            new AbortController().signal,
            {
                model: model(async (request) => ({
                    success: true,
                    data: answer(request),
                })),
                batchSize: 2,
                lookahead: 2,
                concurrency: 24,
                fullTransactions: true,
                onReceipt: (receipt) => receipts.push(receipt),
            },
            async (curation) => {
                checkpoints.push(structuredClone(curation));
            },
        );
        validateTopicSnapshot({ ...value, curation: result });
        expect(peak).toBe(2);
        expect(active).toBe(0);
        expect(checkpoints).toHaveLength(related ? 2 : 1);
        expect(
            result.concepts.flatMap((entry) => entry.memberIds),
        ).toHaveLength(4);
        expect(
            receipts.some(
                (receipt) => receipt.reason === "nomination-inputs-changed",
            ),
        ).toBe(related);
        if (!related)
            expect(
                receipts.find(
                    (receipt) => receipt.reason === "atomic-group-committed",
                )?.committedTransactions,
            ).toBe(2);
    },
);

test("failed full transactions drain sibling authoring and publish no group", async () => {
    const value = snapshot(4);
    let calls = 0,
        drained = false,
        checkpoints = 0;
    const complete: TopicCurationCompletion = async (...args) => {
        const first = ++calls === 1;
        await new Promise((resolve) => setTimeout(resolve, first ? 2 : 10));
        if (first) throw new Error("Synthetic metadata failure");
        drained = true;
        return author(...args);
    };
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            complete,
            new AbortController().signal,
            {
                model: model(async (request) => ({
                    success: true,
                    data: answer(request),
                })),
                batchSize: 2,
                lookahead: 2,
                concurrency: 24,
                fullTransactions: true,
            },
            async () => {
                checkpoints++;
            },
        ),
    ).rejects.toThrow("Synthetic metadata failure");
    expect(drained).toBe(true);
    expect(checkpoints).toBe(0);
});

test("full transaction cancellation drains authoring before returning", async () => {
    const value = snapshot(4);
    const controller = new AbortController();
    let active = 0,
        checkpoints = 0;
    const complete: TopicCurationCompletion = async (...args) => {
        active++;
        if (active === 2) controller.abort(new Error("Synthetic cancellation"));
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return author(...args);
    };
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            complete,
            controller.signal,
            {
                model: model(async (request) => ({
                    success: true,
                    data: answer(request),
                })),
                batchSize: 2,
                lookahead: 2,
                concurrency: 24,
                fullTransactions: true,
            },
            async () => {
                checkpoints++;
            },
        ),
    ).rejects.toThrow("Synthetic cancellation");
    expect(active).toBe(0);
    expect(checkpoints).toBe(0);
});

test("the shared native limiter caps a large wave at 24 calls", async () => {
    const value = snapshot(48);
    const packets = value.nodes.map(
        (_, index) => packTopicDecisions([task(value, index)], "offline")[0],
    );
    let active = 0,
        peak = 0;
    await executeTopicDecisionWave(
        {
            concurrency: 24,
            model: model(async (request) => {
                active++;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                active--;
                return { success: true, data: answer(request) };
            }),
        },
        packets,
        new AbortController().signal,
        "24-call-bound",
    );
    expect(peak).toBe(24);
    expect(active).toBe(0);
});

test("packing processes every target, reserves seven sentinels, and enforces the application question guard", () => {
    const value = snapshot(33);
    const single = task(value);
    single.targets = Array.from({ length: 249 }, (_, index) => ({
        key: `c${index}`,
        concept: concept(value),
    }));
    const packets = packTopicDecisions([single], "offline");
    expect(
        packets.flatMap((packet) =>
            packet.tasks.flatMap((entry) => entry.targets),
        ),
    ).toHaveLength(249);
    expect(packets).toHaveLength(2);
    for (const packet of packets) {
        const question = packet.request.questions.disposition_n0;
        expect(question.type).toBe("choice");
        if (question.type === "choice")
            expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(
                255,
            );
    }
    const many = packTopicDecisions(
        value.nodes.map((_, index) => task(value, index)),
        "offline",
    );
    expect(many.flatMap((packet) => packet.tasks)).toHaveLength(33);
    for (const packet of many) {
        expect(
            Object.keys(packet.request.questions).length,
        ).toBeLessThanOrEqual(64);
        expect(packet.tokens).toBeLessThanOrEqual(24576);
    }
});

test("shared evidence and exact chronology round-trip without repeated candidate or concept excerpts", () => {
    const value = snapshot(2);
    value.nodes[1].citations = value.nodes[0].citations;
    value.occurrences[0].context = {
        role: "assistant",
        chronology: '{"messageTime":"unknown","correction":"retain exactly"}',
    };
    const tasks = [task(value), task(value, 1)];
    for (const entry of tasks)
        entry.targets = [{ key: "c0", concept: concept(value) }];
    const request = buildTopicDecisionRequest(tasks);
    const state = evidenceRecord(request.state);
    const evidence = evidenceRecord(state.evidence);
    const clocks = evidenceRecord(state.chronology);
    expect(Object.keys(evidence)).toHaveLength(2);
    expect(Object.keys(clocks)).toHaveLength(1);
    const candidates = evidenceRecord(state.candidates);
    for (const entry of tasks) {
        const normalized = evidenceRecord(candidates[entry.candidate.key]);
        const expanded = evidenceArray(normalized.evidenceIds, 100).map(
            (id) => {
                const { chronologyId, ...citation } = evidenceRecord(
                    evidence[evidenceText(id)],
                );
                return {
                    ...citation,
                    chronology: clocks[evidenceText(chronologyId)],
                };
            },
        );
        const original = evidenceArray(
            entry.candidate.grounding.evidence,
            100,
        ).map((raw) => {
            const { id: _id, ...citation } = evidenceRecord(raw);
            return citation;
        });
        expect(expanded).toEqual(original);
    }
    expect(JSON.stringify(request.questions)).not.toContain(
        "Mercury 0 is a scoped",
    );
    validateDecisionRequest(request);
});

test("packing obeys native output admission and never treats unexpected validation failures as capacity", () => {
    const value = snapshot(9);
    const tasks = value.nodes.map((_, index) => task(value, index));
    const packets = packTopicDecisions(tasks, "offline", 24576, (request) => {
        if (Object.keys(request.questions).length > 4)
            throw new RequestAdmissionError("Synthetic output bound");
    });
    expect(packets).toHaveLength(5);
    expect(packets.flatMap((entry) => entry.tasks)).toHaveLength(9);
    expect(() =>
        packTopicDecisions(tasks, "offline", 24576, () => {
            throw new Error("Invalid provider metadata");
        }),
    ).toThrow("Invalid provider metadata");
});

test("experimental chronology values recover exact original fields without losing opaque chronology", () => {
    const value = snapshot(3);
    const shared = {
        spans: ["source span with exact original chronology ".repeat(6)],
    };
    const clocks = [
        JSON.stringify({
            messageTime: "unknown",
            support: shared,
            role: "assistant",
        }),
        JSON.stringify({
            messageTime: "2026-10-25",
            support: shared,
            note: "retain",
        }),
        ' { "opaque": "noncanonical JSON remains byte-identical" }',
    ];
    value.occurrences.forEach((entry, index) => {
        entry.context = { role: "assistant", chronology: clocks[index] };
    });
    const tasks = value.nodes.map((_, index) => task(value, index));
    const baseline = buildTopicDecisionRequest(tasks);
    const treated = buildTopicDecisionRequest(tasks, "factored-best-fit");
    const original = evidenceRecord(evidenceRecord(baseline.state).chronology);
    const state = evidenceRecord(treated.state);
    const values = evidenceRecord(state.chronologyValues);
    const recovered = Object.fromEntries(
        Object.entries(evidenceRecord(state.chronology)).map(([id, record]) => {
            if (typeof record === "string") return [id, record];
            const entry = evidenceRecord(record);
            const fields = evidenceRecord(entry.fields);
            const refs = evidenceRecord(entry.valueRefs);
            const parsed = evidenceRecord(
                JSON.parse(evidenceText(original[id])),
            );
            const restored = Object.fromEntries(
                Object.keys(parsed).map((key) => [
                    key,
                    Object.prototype.hasOwnProperty.call(refs, key)
                        ? values[evidenceText(refs[key])]
                        : fields[key],
                ]),
            );
            return [id, JSON.stringify(restored)];
        }),
    );
    expect(recovered).toEqual(original);
    expect(Object.keys(values)).toHaveLength(1);
    for (const question of Object.values(treated.questions))
        expect(question.instructions).toContain("state.chronologyValues");
    validateDecisionRequest(treated);
    expect(buildTopicDecisionRequest(tasks)).toEqual(baseline);
    const native = model(async (request) => ({
        success: true,
        data: answer(request),
    }));
    expect(topicDecisionIdentity(native)).toBe(
        topicDecisionIdentity(native, "v2"),
    );
    expect(topicDecisionIdentity(native, "factored-best-fit")).not.toBe(
        topicDecisionIdentity(native),
    );
});

test("experimental packing preserves all targets and one score per candidate within native bounds", () => {
    const value = snapshot(9);
    const tasks = value.nodes.map((_, index) => task(value, index));
    tasks[0].targets = Array.from({ length: 249 }, (_, index) => ({
        key: `c${index}`,
        concept: concept(value),
    }));
    const packets = packTopicDecisions(
        tasks,
        "offline",
        24576,
        (request) => {
            validateDecisionRequest(request);
            if (Object.keys(request.questions).length > 4)
                throw new RequestAdmissionError("Synthetic output bound");
        },
        "factored-best-fit",
    );
    for (const value of packets) {
        expect(value.tokens).toBeLessThanOrEqual(24576);
        expect(
            new Set(value.tasks.map((entry) => entry.candidate.key)).size,
        ).toBe(value.tasks.length);
    }
    for (const expected of tasks) {
        const pieces = packets
            .flatMap((entry) => entry.tasks)
            .filter((entry) => entry.candidate.key === expected.candidate.key);
        expect(
            pieces
                .flatMap((entry) => entry.targets.map((target) => target.key))
                .sort(),
        ).toEqual(expected.targets.map((target) => target.key).sort());
        expect(pieces.filter((entry) => entry.score)).toHaveLength(1);
    }
    expect(() =>
        packTopicDecisions(
            tasks,
            "offline",
            24576,
            () => {
                throw new Error("Invalid provider metadata");
            },
            "factored-best-fit",
        ),
    ).toThrow("Invalid provider metadata");
});

test("experimental chronology preserves reserved field names as exact data", () => {
    const value = snapshot(1);
    const text =
        '{"__proto__":{"exact":"a long original chronology field value that must remain data"},"constructor":"literal","role":"assistant"}';
    value.occurrences[0].context = { role: "assistant", chronology: text };
    const state = evidenceRecord(
        buildTopicDecisionRequest([task(value)], "factored-best-fit").state,
    );
    const record = evidenceRecord(
        Object.values(evidenceRecord(state.chronology))[0],
    );
    const refs = evidenceRecord(record.valueRefs);
    const fields = evidenceRecord(record.fields);
    const values = evidenceRecord(state.chronologyValues);
    expect(Object.prototype.hasOwnProperty.call(refs, "__proto__")).toBe(true);
    expect(values[evidenceText(refs["__proto__"])]).toEqual(
        evidenceRecord(JSON.parse(text))["__proto__"],
    );
    expect(fields.constructor).toBe("literal");
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
});

test("diagnostic node limits return validated partial curation and capture native selected answers", async () => {
    const value = snapshot(3);
    const receipts: TopicDecisionReceipt[] = [];
    const native = model(async (request) => ({
        success: true,
        data: answer(request),
    }));
    const result = await curateTopicsWithDecision(
        value,
        (node) => node.citations,
        author,
        new AbortController().signal,
        {
            model: native,
            packetPolicy: "factored-best-fit",
            onReceipt: (receipt) => receipts.push(receipt),
        },
        undefined,
        undefined,
        2,
    );
    expect(result.concepts.flatMap((entry) => entry.memberIds)).toHaveLength(2);
    expect(value.curation).toBeUndefined();
    validateTopicSnapshot({ ...value, curationProgress: result });
    const initial = receipts.find((entry) => entry.stage === "decision");
    expect(initial?.answers?.disposition_n0).toBe("standalone_new");
    expect(initial?.answers?.salience_n0).toBe(4);
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            author,
            new AbortController().signal,
            { model: native },
            undefined,
            undefined,
            0,
        ),
    ).rejects.toThrow("positive integer");
});

test("overlapping evidence packs 24 independently scored candidates into one legal request", () => {
    const value = snapshot(24);
    const citation = {
        ...value.nodes[0].citations[0],
        excerpt:
            "A scoped original reference with a governing exception. ".repeat(
                200,
            ),
    };
    for (const node of value.nodes) node.citations = [citation];
    const tasks = value.nodes.map((_, index) => task(value, index));
    const packets = packTopicDecisions(tasks, "offline");
    expect(packets).toHaveLength(1);
    expect(packets[0].tasks).toHaveLength(24);
    expect(Object.keys(packets[0].request.questions)).toHaveLength(48);
    const duplicateBytes = JSON.stringify(
        tasks.map((entry) => entry.candidate.grounding),
    ).length;
    expect(JSON.stringify(packets[0].request).length).toBeLessThan(
        duplicateBytes / 2,
    );
});

test("fixed-cluster authoring interns shared support instead of overflowing on repeated member evidence", async () => {
    const value = snapshot(24);
    const citation = {
        ...value.nodes[0].citations[0],
        excerpt:
            "A scoped original reference with a governing exception. ".repeat(
                200,
            ),
    };
    for (const node of value.nodes) node.citations = [citation];
    for (const occurrence of value.occurrences)
        occurrence.citations = [citation];
    const duplicated = value.nodes.map(
        (node) =>
            groundTopicCandidate(value, node, node.citations, node.id)
                .grounding,
    );
    expect(countO200kTokens(JSON.stringify(duplicated))).toBeGreaterThan(16384);
    let calls = 0;
    const result = await run(
        value,
        model(async (request) => ({
            success: true,
            data: answer(request, (key) =>
                key === "n0" ? "standalone_new" : "n0",
            ),
        })),
        async (rules, payload) => {
            calls++;
            const state = evidenceRecord(payload);
            expect(Object.keys(evidenceRecord(state.candidates))).toHaveLength(
                24,
            );
            expect(
                JSON.stringify(payload).split(citation.excerpt),
            ).toHaveLength(2);
            expect(
                evidenceRecord(evidenceArray(state.clusters, 1)[0]).members,
            ).toHaveLength(24);
            return author(rules, payload);
        },
    );
    expect(calls).toBe(1);
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].memberIds).toHaveLength(24);
    expect(result.concepts[0].citations).toEqual([citation]);
});

test("independent redirected roots share a packet without c0 alias collisions", async () => {
    const value = snapshot(6);
    const receipts: TopicDecisionReceipt[] = [];
    let calls = 0;
    const initial: Record<string, string> = {
        n0: "c0",
        n1: "c1",
        n2: "n0",
        n3: "n1",
    };
    const native = model(async (request) => {
        calls++;
        if (calls === 2) {
            expect(Object.keys(request.questions)).toHaveLength(2);
            const state = evidenceRecord(request.state);
            expect(Object.keys(evidenceRecord(state.targets))).toEqual([
                "c0",
                "c1",
            ]);
        }
        return {
            success: true,
            data: answer(request, (key) => {
                if (calls === 1) return initial[key] ?? "standalone_new";
                return key === "n2" ? "c0" : "c1";
            }),
        };
    });
    value.curation = await run(
        value,
        native,
        noAuthoring,
        undefined,
        {
            concepts: [concept(value), concept(value, 1)],
            deferred: [],
        },
        (receipt) => receipts.push(receipt),
    );
    validateTopicSnapshot(value);
    expect(calls).toBe(2);
    expect(
        value.curation.concepts.map((entry) => entry.memberIds.length),
    ).toEqual([3, 3]);
    expect(
        receipts.find(
            (entry) =>
                entry.reason === "root-reconciliation" &&
                entry.stage === "decision",
        )?.candidates,
    ).toBe(2);
    expect(
        receipts
            .filter((entry) => entry.stage === "decision")
            .every((entry) => entry.transactionId && entry.batchOffset === 0),
    ).toBe(true);
});

test("deferred-root frontiers retain each candidate's original resolved-prefix universe", async () => {
    const value = snapshot(5);
    let calls = 0;
    const native = model(async (request) => {
        calls++;
        const choice =
            request.questions.disposition_n2 ??
            request.questions.disposition_n4;
        if (calls === 2 && choice.type === "choice") {
            expect(choice.criteria).toHaveProperty("n1");
            expect(choice.criteria).not.toHaveProperty("n3");
        }
        if (calls === 3 && choice.type === "choice")
            expect(choice.criteria).toHaveProperty("n3");
        return {
            success: true,
            data: answer(request, (key) =>
                calls === 1
                    ? key === "n0"
                        ? "defer_passing_mention"
                        : ["n2", "n4"].includes(key)
                          ? "n0"
                          : "standalone_new"
                    : calls === 2
                      ? "standalone_new"
                      : "defer_passing_mention",
            ),
        };
    });
    value.curation = await run(value, native);
    validateTopicSnapshot(value);
    expect(calls).toBe(3);
    expect(value.curation.deferred).toHaveLength(2);
});

test("original role and chronology preserve missing and mixed provenance explicitly", () => {
    const value = snapshot(1);
    value.occurrences[0].context = {
        role: "assistant",
        chronology: "Source-local clock; no timezone",
    };
    const grounded = task(value).candidate;
    expect(JSON.stringify(grounded.grounding)).toContain('"role":"assistant"');
    expect(JSON.stringify(grounded.grounding)).toContain("no timezone");
    delete value.occurrences[0].context;
    expect(JSON.stringify(task(value).candidate.grounding)).toContain(
        '"role":"unknown"',
    );
    value.occurrences.push({
        ...value.occurrences[0],
        id: "conflicting-original-context",
        context: {
            role: "assistant",
            chronology: "Source-local clock; no timezone",
        },
    });
    const mixed = JSON.stringify(task(value).candidate.grounding);
    expect(mixed).toContain('"role":"mixed"');
    expect(mixed).toContain("Mixed original chronology");
    expect(mixed).toContain("unknown");
    expect(mixed).toContain("Source-local clock; no timezone");
});
test("indexed incidence retains trustworthy role/time metadata without changing occurrence identity", () => {
    const block = {
        sourceId: "s",
        revisionId: "r1",
        blockOrdinal: 3,
        text: "A substantive assistant explanation.",
        score: 1,
    };
    const temporalContext = {
        version: 1 as const,
        sourceRevisionId: "r1",
        contextHash: "a".repeat(64),
        ownerId: "source-local-owner",
        role: "assistant",
        sourceSpan: { start: 0, end: block.text.length },
        inheritedDateEvidence: [],
    };
    const plain = indexedTopicOccurrence(block, "Reference", 0);
    const contextual = indexedTopicOccurrence(
        { ...block, temporalContext },
        "Reference",
        0,
    );
    expect(contextual.id).toBe(plain.id);
    expect(contextual.context?.role).toBe("assistant");
    expect(JSON.parse(contextual.context!.chronology)).toEqual(temporalContext);
});

test.each([0, 2.5, 7])(
    "salience %s is rounded from the native eight-level score without a confidence gate",
    (score) => {
        const response = answer(
            buildTopicDecisionRequest([task(snapshot(1))]),
            undefined,
            score,
        );
        expect(topicSalience(response, "n0")).toBe(Math.round(score) + 1);
    },
);
test.each([NaN, Infinity, -0.01, 7.01])(
    "invalid salience %s is not defaulted",
    (score) => {
        const response = answer(
            buildTopicDecisionRequest([task(snapshot(1))]),
            undefined,
            score,
        );
        expect(() => topicSalience(response, "n0")).toThrow("salience");
    },
);

test("host deferrals use no Luna calls and retain complete raw incidence", async () => {
    const value = snapshot();
    const before = structuredClone(value.occurrences);
    const native = model(async (request) => ({
        success: true,
        data: answer(request, () => "defer_passing_mention"),
    }));
    value.curation = await run(value, native, noAuthoring);
    validateTopicSnapshot(value);
    expect(value.curation.deferred).toHaveLength(3);
    expect(value.occurrences).toEqual(before);
});

test("new in-batch roots author one fixed cluster, preserve salience and never generate prose", async () => {
    const value = snapshot(3);
    let authored = 0;
    const native = model(async (request) => ({
        success: true,
        data: answer(
            request,
            (key) =>
                key === "n0"
                    ? "standalone_new"
                    : key === "n1"
                      ? "n0"
                      : "defer_incidental_noun_or_tag",
            2.5,
        ),
    }));
    value.curation = await run(value, native, async (...args) => {
        authored++;
        return author(...args);
    });
    validateTopicSnapshot(value);
    expect(authored).toBe(1);
    expect(value.curation.concepts).toHaveLength(1);
    expect(value.curation.concepts[0].memberIds).toHaveLength(2);
    expect(value.curation.concepts[0].salience).toBe(4);
    expect(value.curation.concepts[0].summaryState).toBe("pending");
    expect(value.curation.concepts[0].summary).toBe("");
    expect(value.curation.deferred).toHaveLength(1);
});

test("a direct existing-concept merge preserves metadata and identity without Luna", async () => {
    const value = snapshot(2);
    const existing = concept(value);
    const native = model(async (request) => ({
        success: true,
        data: answer(request, () => "c0", 6),
    }));
    value.curation = await run(value, native, noAuthoring, undefined, {
        concepts: [existing],
        deferred: [],
    });
    validateTopicSnapshot(value);
    expect(value.curation.concepts[0]).toMatchObject({
        id: existing.id,
        label: existing.label,
        scope: existing.scope,
        salience: 7,
    });
    expect(value.curation.concepts[0].memberIds).toHaveLength(2);
    expect(value.curation.concepts[0].citations).toHaveLength(2);
});

test.each(["redirected", "deferred", "redirected-new"])(
    "%s earlier roots are reconciled against actual admitted roots, not inherited transitively",
    async (mode) => {
        const value = snapshot(4);
        const reusable = { concepts: [concept(value)], deferred: [] };
        let calls = 0;
        const native = model(async (request) => {
            calls++;
            if (calls === 1)
                return {
                    success: true,
                    data: answer(request, (key) => {
                        if (key === "n0")
                            return mode === "deferred"
                                ? "defer_passing_mention"
                                : mode === "redirected-new"
                                  ? "standalone_new"
                                  : "c0";
                        return key === "n1"
                            ? "n0"
                            : mode === "redirected-new"
                              ? "n1"
                              : "standalone_new";
                    }),
                };
            const choice = Object.values(request.questions).find(
                (question) => question.type === "choice",
            );
            expect(choice?.type).toBe("choice");
            if (choice?.type === "choice") {
                expect(choice.criteria).not.toHaveProperty(
                    mode === "redirected-new" ? "n1" : "n0",
                );
                expect(choice.criteria).toHaveProperty(
                    mode === "redirected-new" ? "n0" : "c0",
                );
            }
            return {
                success: true,
                data: answer(request, () => "standalone_new"),
            };
        });
        value.curation = await run(value, native, author, undefined, reusable);
        validateTopicSnapshot(value);
        expect(calls).toBe(2);
        if (mode === "deferred")
            expect(
                value.curation.deferred.map((entry) => entry.nodeId),
            ).toEqual([value.nodes[1].id]);
        else
            expect(
                value.curation.concepts.find(
                    (entry) => entry.id === reusable.concepts[0].id,
                )?.memberIds,
            ).toHaveLength(mode === "redirected" ? 2 : 1);
    },
);

test("an uncertain root and its dependent candidates are resolved together atomically", async () => {
    const value = snapshot(2);
    let synthesized = 0;
    const receipts: TopicDecisionReceipt[] = [];
    const native = model(async (request) => ({
        success: true,
        data: answer(
            request,
            (key) => (key === "n0" ? "uncertain_needs_synthesis" : "n0"),
            6,
        ),
    }));
    value.curation = await run(
        value,
        native,
        async (_rules, payload) => {
            synthesized++;
            const input = evidenceRecord(payload);
            const nodes = evidenceArray(input.nodes, 24).map(evidenceRecord);
            const evidence = evidenceArray(input.evidence, 100).map(
                evidenceRecord,
            );
            return {
                concepts: [
                    {
                        label: "Mercury",
                        scope: "Resolved",
                        purpose: "Resolve combined evidence",
                        memberIds: nodes.map((node) => node.id),
                        evidenceIds: evidence.map((entry) => entry.id),
                        salience: 1,
                    },
                ],
                deferred: [],
            };
        },
        undefined,
        undefined,
        (receipt) => receipts.push(receipt),
    );
    validateTopicSnapshot(value);
    expect(synthesized).toBe(1);
    expect(value.curation.concepts[0].memberIds).toHaveLength(2);
    expect(value.curation.concepts[0].salience).toBe(7);
    expect(
        receipts.find((receipt) => receipt.stage === "resolution")?.inputTokens,
    ).toBeGreaterThan(0);
    expect(receipts[0].usage).toBeUndefined();
});

test("missing retained target support is expanded from original members before a direct merge", async () => {
    const value = snapshot(3);
    const existing = concept(value);
    existing.memberIds.push(value.nodes[1].id);
    let synthesized = 0;
    const native = model(async (request) => ({
        success: true,
        data: answer(request, () => "c0"),
    }));
    value.curation = await run(
        value,
        native,
        async (_rules, payload) => {
            synthesized++;
            const input = evidenceRecord(payload);
            return {
                concepts: [],
                deferred: evidenceArray(input.nodes, 24).map((raw) => ({
                    nodeId: evidenceRecord(raw).id,
                    reason: "The supplied explanation requires more context",
                })),
            };
        },
        undefined,
        { concepts: [existing], deferred: [] },
    );
    validateTopicSnapshot(value);
    expect(synthesized).toBe(0);
    expect(value.curation.concepts).toHaveLength(1);
    expect(value.curation.concepts[0].memberIds).toHaveLength(3);
    expect(value.curation.concepts[0].citations).toHaveLength(3);
    expect(value.curation.deferred).toHaveLength(0);
});

test.each(["invented", "salience", "authoring"])(
    "invalid %s output fails before any checkpoint",
    async (kind) => {
        const value = snapshot(1);
        let saved = 0;
        const native = model(async (request) => {
            const data = answer(request, () =>
                kind === "invented" ? "n1" : "standalone_new",
            );
            if (kind === "salience") delete data.answers.salience_n0;
            return { success: true, data };
        });
        await expect(
            run(
                value,
                native,
                async () => ({ concepts: [] }),
                async () => {
                    saved++;
                },
            ),
        ).rejects.toThrow();
        expect(saved).toBe(0);
        expect(value.curation).toBeUndefined();
    },
);

test.each(["provider", "authentication", "invalid_response"] as const)(
    "typed %s failures never activate a generative replacement",
    async (code) => {
        const native = model(async () => ({
            success: false,
            code,
            errorCategory:
                code === "authentication" ? "authentication" : "provider",
            retryable: false,
            message: "Synthetic failure",
        }));
        await expect(run(snapshot(), native, noAuthoring)).rejects.toThrow(
            `(${code})`,
        );
    },
);

test.each([false, true])(
    "only one typed Azure HTTP 422 repack is permitted; repeated=%s",
    async (repeated) => {
        let calls = 0;
        const native = model(async (request) => {
            calls++;
            return calls === 1 || repeated
                ? {
                      success: false,
                      code: "provider",
                      httpStatus: 422,
                      errorCategory: "provider",
                      retryable: false,
                      message: "Synthetic 422",
                  }
                : {
                      success: true,
                      data: answer(request, () => "defer_passing_mention"),
                  };
        });
        const operation = run(snapshot(25), native, noAuthoring);
        if (repeated) await expect(operation).rejects.toThrow("HTTP 422");
        else {
            const result = await operation;
            expect(result.deferred).toHaveLength(25);
        }
        expect(calls).toBe(repeated ? 2 : 4);
    },
);

test("Copilot HTTP 422 does not activate the Azure-specific repack", async () => {
    let calls = 0;
    const native = model(async () => {
        calls++;
        return {
            success: false,
            code: "provider",
            httpStatus: 422,
            errorCategory: "provider",
            retryable: false,
            message: "Synthetic failure",
        };
    });
    await expect(
        run(snapshot(1), { ...native, provider: "copilot" }, noAuthoring),
    ).rejects.toThrow("HTTP 422");
    expect(calls).toBe(1);
});

test("cancellation rejects a late model result before authoring or publication", async () => {
    const value = snapshot(1);
    const controller = new AbortController();
    const native = model(async (request) => {
        controller.abort();
        return { success: true, data: answer(request) };
    });
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            noAuthoring,
            controller.signal,
            { model: native },
        ),
    ).rejects.toThrow(/abort/i);
});

test("only validated checkpoints resume, and a failed checkpoint stops the producer", async () => {
    const value = snapshot(25);
    let checkpoint: TopicCuration | undefined;
    const native = model(async (request) => {
        if (JSON.stringify(request.state).includes("source-024"))
            return {
                success: false,
                code: "network",
                errorCategory: "network",
                retryable: true,
                message: "Synthetic outage",
            };
        return {
            success: true,
            data: answer(request, () => "defer_passing_mention"),
        };
    });
    await expect(
        run(value, native, noAuthoring, async (partial) => {
            checkpoint = partial;
        }),
    ).rejects.toThrow("network");
    expect(checkpoint?.deferred).toHaveLength(24);
    const resume = model(async (request) => {
        expect(Object.keys(request.questions)).toHaveLength(2);
        return {
            success: true,
            data: answer(request, () => "defer_passing_mention"),
        };
    });
    value.curation = await run(
        value,
        resume,
        noAuthoring,
        undefined,
        checkpoint,
    );
    validateTopicSnapshot(value);
    expect(value.curation.deferred).toHaveLength(25);
    await expect(
        run(snapshot(25), native, noAuthoring, async () => {
            throw new Error("Checkpoint IO failed");
        }),
    ).rejects.toThrow("Checkpoint IO failed");
});

test("runtime model/provider identity changes invalidate reuse and the opt-in rejects conflicting custom generation", () => {
    const native = model(async () => {
        throw new Error("unused");
    });
    expect(topicDecisionIdentity(native)).not.toBe(
        topicDecisionIdentity({ ...native, model: "changed" }),
    );
    expect(topicDecisionIdentity(native)).not.toBe(
        topicDecisionIdentity({
            ...native,
            configGeneration: native.configGeneration + 1,
        }),
    );
    expect(topicDecisionIdentity(native)).not.toBe(
        topicDecisionIdentity({ ...native, provider: "copilot" }),
    );
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "true",
        }).decisionTopics,
    ).toBe(true);
    expect(
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "0",
        }).decisionTopics,
    ).toBe(false);
    expect(() =>
        getConfiguredMemoryViewOptions({
            TYPEAGENT_MEMORY_DECISION_TOPICS: "invalid",
        }),
    ).toThrow("TYPEAGENT_MEMORY_DECISION_TOPICS");
    expect(
        () =>
            new FileMemoryService("unused", {
                decisionTopics: true,
                curatedTopics: false,
            }),
    ).toThrow("requires curated");
    expect(
        () =>
            new FileMemoryService("unused", {
                decisionTopics: true,
                viewSynthesisAdapter: {
                    identity: "custom",
                    generate: async () => {
                        throw new Error("unused");
                    },
                    validate: async () => {
                        throw new Error("unused");
                    },
                    generateTopics: async () => snapshot(1),
                },
            }),
    ).toThrow("cannot override a custom");
});

test("configured generation wires Decision, preserves human labels, checkpoints atomically and measures unchanged organization", async () => {
    const value = snapshot(2);
    const input: ViewBuildSnapshot = {
        corpusId: value.corpusId,
        actor: "offline",
        definition: {
            viewId: "topics",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        pipeline: "topics-v1",
        model: "offline-decision",
        fingerprint: value.inputFingerprint,
        influenceSources: value.influenceSources,
        topicInput: {
            occurrences: value.occurrences,
            authoredLabels: [
                {
                    id: value.nodes[0].id,
                    label: "Protected label",
                    aliases: [],
                },
            ],
        },
    };
    const receipts: TopicDecisionReceipt[] = [];
    let chatCalls = 0;
    const native = model(async (request) => ({
        success: true,
        data: answer(request),
    }));
    const generate = createConfiguredTopicGenerator({
        model: {
            completionSettings: { response_format: { type: "json_object" } },
            complete: async (messages) => {
                chatCalls++;
                if (typeof messages === "string")
                    throw new Error("Expected grounded system/user messages");
                const payload: unknown = JSON.parse(
                    String(messages[1].content),
                );
                const result = Array.isArray(payload)
                    ? { parents: [], related: [] }
                    : await author("", payload);
                return { success: true, data: JSON.stringify(result) };
            },
        },
        mode: {
            kind: "decision",
            createOptions: () => ({
                model: native,
                onReceipt: (receipt) => receipts.push(receipt),
            }),
        },
    });
    const saved: TopicSnapshot[] = [];
    const result = await generate(
        input,
        new AbortController().signal,
        async (partial) => {
            saved.push(partial);
        },
    );
    validateTopicSnapshot(result);
    expect(result.recipe).toBe(
        "offline-decision:editorial-v1:curated-decision-v2",
    );
    expect(result.nodes[0].label).toBe("Protected label");
    expect(result.nodes[0].authorship).toBe("human");
    expect(result.curation?.concepts).toHaveLength(2);
    expect(result.curationProgress).toBeUndefined();
    expect(saved[0].curationProgress?.concepts).toHaveLength(2);
    expect(saved[0].curation).toBeUndefined();
    expect(chatCalls).toBe(2);
    expect(receipts.map((receipt) => receipt.stage)).toEqual([
        "planning",
        "packing",
        "decision",
        "authoring",
        "transaction",
        "checkpoint",
        "organization",
    ]);
});

test("production Decision opt-in persists, reopens, replaces and forgets original evidence", async () => {
    class TopicIndex extends FakeSemanticCorpusIndex {
        async getTopicOccurrences(sourceIds: ReadonlySet<string>) {
            return this.documents
                .filter((document) => sourceIds.has(document.source.sourceId))
                .map((document) =>
                    indexedTopicOccurrence(
                        {
                            sourceId: document.source.sourceId,
                            revisionId: document.revision.revisionId,
                            blockOrdinal: 0,
                            text: document.content,
                            score: 1,
                        },
                        "Mercury",
                        0,
                    ),
                );
        }
    }
    const originalFetch = globalThis.fetch;
    const originalConfig = getRuntimeConfig();
    const directory = await mkdtemp(
        path.join(os.tmpdir(), "decision-topic-service-"),
    );
    const open = () =>
        new FileMemoryService(directory, {
            decisionTopics: true,
            maintenanceMode: "manual",
            sourceSynopses: false,
            indexFactory: (_id, root) => new TopicIndex(root),
        });
    let service: FileMemoryService | undefined;
    let calls = 0;
    async function rebuild(
        currentService: FileMemoryService,
        corpusId: string,
    ) {
        const job = await currentService.rebuildTopics(corpusId);
        let current = job;
        for (
            let attempt = 0;
            attempt < 500 && current.state === "running";
            attempt++
        ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            const next = await currentService.getViewBuild({
                corpusId,
                jobId: job.jobId,
            });
            if (!next) throw new Error("Decision topic build disappeared");
            current = next;
        }
        expect(current.state).toBe("complete");
        expect(current.results[0].missingEvidence ?? []).toEqual([]);
        expect(current.results[0].snapshot.model).toContain(
            "curated-decision-v2",
        );
    }
    try {
        setRuntimeConfig(
            buildConfig({
                AZURE_OPENAI_ENDPOINT:
                    "https://chat.example/openai/deployments/synthetic",
                AZURE_OPENAI_API_KEY: "offline-test",
                AZURE_OPENAI_ENDPOINT_GPT_6_LUNA_EASTUS:
                    "https://chat.example/openai/deployments/synthetic/chat/completions",
                AZURE_OPENAI_API_KEY_GPT_6_LUNA_EASTUS: "offline-test",
                AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
                    "https://eastus.example/providers/microsoft/v1/systemone",
                AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline-test",
                AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
            }),
        );
        globalThis.fetch = async (url, init) => {
            expect(String(url)).toContain("/providers/microsoft/v1/systemone");
            calls++;
            const request: DecisionRequest = JSON.parse(String(init?.body));
            const result = answer(request, () => "defer_passing_mention");
            return new Response(JSON.stringify({ answers: result.answers }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        };
        service = open();
        await service.initialize();
        const { corpusId } = await service.createCorpus("Decision integration");
        const ingested = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "reference",
                sourceType: "text",
                title: "Mercury",
                text: "Mercury is briefly mentioned.",
            },
        });
        await waitForMemoryJob(service, ingested.jobId, {
            pollIntervalMs: 10,
        });
        await rebuild(service, corpusId);
        const page = await service.queryTopics({ corpusId, curated: true });
        expect(page.totalNodes).toBe(1);
        expect(page.totalConcepts).toBe(0);
        expect(calls).toBe(1);
        await service.close();
        service = open();
        await service.initialize();
        const reopened = await service.queryTopics({
            corpusId,
            curated: true,
        });
        expect(reopened.generation).toBe(page.generation);
        expect(calls).toBe(1);
        const replacement = await service.replaceSource({
            corpusId,
            sourceId: "reference",
            expectedActiveRevisionId: ingested.revisionId,
            source: {
                sourceType: "text",
                title: "Mercury",
                text: "Mercury has a corrected passing mention.",
            },
        });
        await waitForMemoryJob(service, replacement.jobId, {
            pollIntervalMs: 10,
        });
        await rebuild(service, corpusId);
        const updated = await service.queryTopics({ corpusId });
        expect(updated.totalNodes).toBe(1);
        expect(
            updated.nodes[0].citations.every(
                (citation) => citation.revisionId === replacement.revisionId,
            ),
        ).toBe(true);
        expect(calls).toBe(2);
        const preview = await service.previewForgetSource(
            corpusId,
            "reference",
        );
        await service.forgetSource({
            corpusId,
            sourceId: "reference",
            confirmationToken: preview.confirmationToken,
        });
        await rebuild(service, corpusId);
        expect((await service.queryTopics({ corpusId })).totalNodes).toBe(0);
        expect(await service.getSource(corpusId, "reference")).toBeUndefined();
        expect(calls).toBe(2);
    } finally {
        await service?.close();
        globalThis.fetch = originalFetch;
        setRuntimeConfig(originalConfig);
        await rm(directory, { recursive: true, force: true });
    }
});
test("memory-shaped packets use the native Azure client, wire validation and cumulative inference budget", async () => {
    const native = createDecisionModel({
        provider: "azure",
        config: buildConfig({
            AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
                "https://eastus.example/providers/microsoft/v1/systemone",
            AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline-test",
            AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
        }),
    });
    if (!native.success) throw new Error(native.message);
    const original = globalThis.fetch;
    let calls = 0;
    const budget = new RequestBudget({
        inputTokens: 32768,
        outputTokens: 100000,
        safetyTokens: 1000,
        chatAttempts: 1,
        embeddingAttempts: 1,
        elapsedMs: 60000,
        reservedTokens: 200000,
        tokenizer: "o200k_base",
        countTokens: countO200kTokens,
    });
    try {
        globalThis.fetch = async (_url, init) => {
            calls++;
            const request: DecisionRequest = JSON.parse(String(init?.body));
            validateDecisionRequest(request);
            const result = answer(request, () => "defer_passing_mention");
            return new Response(
                JSON.stringify({
                    answers: result.answers,
                    model: "reported-native",
                }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                },
            );
        };
        const result = await runWithRequestBudget(budget, () =>
            run(snapshot(1), native.data, noAuthoring),
        );
        expect(result.deferred).toHaveLength(1);
        expect(budget.receipts).toHaveLength(1);
        expect(budget.receipts[0].kind).toBe("decision");
        await expect(
            runWithRequestBudget(budget, () =>
                run(snapshot(1), native.data, noAuthoring),
            ),
        ).rejects.toThrow("budget");
        expect(calls).toBe(1);
    } finally {
        globalThis.fetch = original;
    }
});
