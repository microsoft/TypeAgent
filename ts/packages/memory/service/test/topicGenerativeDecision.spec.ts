// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    RequestAdmissionError,
    type StructuredOutputJsonSchema,
} from "@typeagent/aiclient";
import {
    parseTopicChoiceAnswers,
    topicChoiceSchema,
    type TopicChoiceQuestions,
} from "../src/topicDecisionContract.js";
import {
    generativeTopicDecision,
    topicPartitionTask,
    type TopicGenerativeDecisionReceipt,
} from "../src/topicGenerativeDecision.js";
import {
    curateTopics,
    type TopicCurationCompletion,
} from "../src/topicCuration.js";
import {
    topicCurationPolicy,
    validateTopicCurationSettings,
} from "../src/topicCurationSettings.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { initialTopicNodes } from "../src/topicSnapshot.js";
import type { TopicSnapshot, TopicCurationPacket } from "../src/topicTypes.js";

const questions: TopicChoiceQuestions = {
    q: { type: "choice", instructions: "Choose", criteria: { a: "A", b: "B" } },
};

function answer(choice = "a", a = 0.25, b = 0.75) {
    return {
        type: "choice" as const,
        choice,
        probabilities: { a, b },
        confidence: 0.6,
    };
}

test("shared schema and native parser preserve actual scores without forcing argmax", () => {
    const response = { answers: { q: answer() } };
    expect(parseTopicChoiceAnswers(response, questions)).toEqual(
        response.answers,
    );
    expect(topicChoiceSchema(questions)).toMatchObject({ strict: true });
});

test.each([
    {},
    { answers: {} },
    { answers: { q: answer(), extra: answer() } },
    { answers: { q: { ...answer(), choice: "unoffered" } } },
    { answers: { q: { ...answer(), probabilities: { a: 1 } } } },
    { answers: { q: answer("a", 0.8, 0.25) } },
    { answers: { q: answer("a", -0.1, 1.1) } },
    { answers: { q: { ...answer(), confidence: NaN } } },
    { answers: { q: { ...answer(), rationale: "Not native output" } } },
    {
        answers: {
            q: { type: "choice", choice: "a", probabilities: { a: 1, b: 0 } },
        },
    },
    { answers: { q: answer() }, model: "invented" },
])("invalid answer contracts are rejected, not normalized: %j", (response) => {
    expect(() => parseTopicChoiceAnswers(response, questions)).toThrow();
});

const payload = {
    nodes: [
        {
            id: "new-0",
            label: "Service policy",
            scope: "Installation",
            evidenceIds: ["e0"],
        },
        {
            id: "new-1",
            label: "Service policy",
            scope: "Installation",
            evidenceIds: ["e1"],
        },
        {
            id: "prior-0",
            role: "prior",
            label: "Service policy",
            scope: "Installation",
            evidenceIds: ["e2"],
        },
    ],
    evidence: [
        { id: "e0", excerpt: "Installation requires explicit approval." },
        { id: "e1", excerpt: "Approval must precede installation." },
        { id: "e2", excerpt: "The existing service policy requires approval." },
    ],
};
const originalSchema: StructuredOutputJsonSchema = {
    name: "original-curation",
    strict: true,
    schema: { type: "object" },
};
const authored = {
    concepts: [{ memberIds: ["new-0", "new-1", "prior-0"] }],
    deferred: [],
};
const originalRules =
    "Original evidence-grounded policy. Return original prose.";

function nativeAssignments(input: unknown, selections?: string[]) {
    const task = topicPartitionTask(input);
    return {
        answers: Object.fromEntries(
            task.slots.map((slot, index) => {
                const choice = selections?.[index] ?? "group_0";
                return [
                    slot.id,
                    {
                        type: "choice",
                        choice,
                        probabilities: Object.fromEntries(
                            Object.keys(slot.options).map((key) => [
                                key,
                                key === choice
                                    ? 0.8
                                    : 0.2 /
                                      (Object.keys(slot.options).length - 1),
                            ]),
                        ),
                        confidence: 0.65,
                    },
                ];
            }),
        ),
    };
}

test.each(["decomposed", "output-contract"] as const)(
    "both generative stages preserve source content and require separate authoring (%s)",
    async (stage) => {
        const calls: Array<{
            rules: string;
            payload: unknown;
            schema: StructuredOutputJsonSchema | undefined;
            kind: string | undefined;
        }> = [];
        const receipts: TopicGenerativeDecisionReceipt[] = [];
        const complete: TopicCurationCompletion = async (
            rules,
            input,
            schema,
            context,
        ) => {
            calls.push({ rules, payload: input, schema, kind: context?.kind });
            return context?.kind === "metadata"
                ? authored
                : stage === "output-contract"
                  ? nativeAssignments(payload)
                  : {
                        assignments: {
                            assignment_0: "group_0",
                            assignment_1: "group_0",
                            assignment_2: "group_0",
                        },
                    };
        };
        expect(
            await generativeTopicDecision(
                originalRules,
                payload,
                originalSchema,
                complete,
                { kind: "normal", signal: new AbortController().signal },
                stage,
                (receipt) => receipts.push(receipt),
            ),
        ).toEqual(authored);
        expect(calls.map((call) => call.kind)).toEqual([
            "adjudication",
            "metadata",
        ]);
        expect(calls[0].payload).toMatchObject(payload);
        expect(calls[1].payload).toMatchObject(payload);
        expect(calls[0].rules.startsWith(originalRules)).toBe(true);
        expect(calls[0].payload).not.toHaveProperty("state");
        expect(calls[0].payload).not.toHaveProperty("questions");
        expect(calls[1].schema).toEqual(originalSchema);
        expect(
            receipts.map((receipt) => [receipt.operation, receipt.outcome]),
        ).toEqual([
            ["decision", "valid"],
            ["mapping", "valid"],
            ["authoring", "returned"],
        ]);
    },
);

test("non-unit first response remains failed and charged separately from original fallback", async () => {
    const bad = nativeAssignments(payload);
    bad.answers.assignment_0.probabilities.group_0 = 0.85;
    const receipts: TopicGenerativeDecisionReceipt[] = [];
    const kinds: string[] = [];
    const complete: TopicCurationCompletion = async (
        _rules,
        _input,
        _schema,
        context,
    ) => {
        kinds.push(context!.kind);
        return context?.kind === "resolution" ? authored : bad;
    };
    expect(
        await generativeTopicDecision(
            originalRules,
            payload,
            originalSchema,
            complete,
            { kind: "normal", signal: new AbortController().signal },
            "output-contract",
            (receipt) => receipts.push(receipt),
        ),
    ).toEqual(authored);
    expect(kinds).toEqual(["adjudication", "resolution"]);
    expect(receipts[0]).toMatchObject({
        operation: "decision",
        outcome: "failed",
        response: bad,
    });
    expect(receipts[1]).toMatchObject({
        operation: "fallback",
        outcome: "returned",
    });
    expect(bad.answers.assignment_0.probabilities.group_0).toBe(0.85);
});

test.each([
    [["synthesize", "group_1", "group_2"]],
    [["defer", "group_0", "group_2"]],
])(
    "unresolved or inconsistent leaders do not install partial membership (%j)",
    async (selections) => {
        const receipts: TopicGenerativeDecisionReceipt[] = [];
        const kinds: string[] = [];
        const complete: TopicCurationCompletion = async (
            _rules,
            _input,
            _schema,
            context,
        ) => {
            kinds.push(context!.kind);
            return context?.kind === "resolution"
                ? authored
                : nativeAssignments(payload, selections);
        };
        await generativeTopicDecision(
            originalRules,
            payload,
            originalSchema,
            complete,
            { kind: "normal", signal: new AbortController().signal },
            "output-contract",
            (receipt) => receipts.push(receipt),
        );
        expect(kinds).toEqual(["adjudication", "resolution"]);
        expect(receipts[0].outcome).toBe("valid");
        expect(receipts[1]).toMatchObject({
            operation: "mapping",
            outcome: "failed",
        });
    },
);

test("authorship cannot quietly change a valid bounded partition", async () => {
    const kinds: string[] = [];
    const receipts: TopicGenerativeDecisionReceipt[] = [];
    const complete: TopicCurationCompletion = async (
        _rules,
        _input,
        _schema,
        context,
    ) => {
        kinds.push(context!.kind);
        if (context?.kind === "adjudication") return nativeAssignments(payload);
        if (context?.kind === "metadata")
            return { concepts: [{ memberIds: ["new-0"] }], deferred: [] };
        return authored;
    };
    await generativeTopicDecision(
        originalRules,
        payload,
        originalSchema,
        complete,
        { kind: "normal", signal: new AbortController().signal },
        "output-contract",
        (receipt) => receipts.push(receipt),
    );
    expect(kinds).toEqual(["adjudication", "metadata", "resolution"]);
    expect(
        receipts.some(
            (receipt) =>
                receipt.operation === "authoring" &&
                receipt.outcome === "failed",
        ),
    ).toBe(true);
});

test("existing required-reference authority is preserved without adding new source policy", () => {
    const task = topicPartitionTask({
        ...payload,
        nodes: [{ ...payload.nodes[0], referenceRequired: true }],
    });
    expect(task.slots[0].options).not.toHaveProperty("defer");
    expect(task.payload.nodes).toEqual([
        { ...payload.nodes[0], referenceRequired: true },
    ]);
});

test.each([
    new Error("Authentication failed"),
    new Error("Budget exhausted"),
    new RequestAdmissionError("Durable inference reservation failed"),
])(
    "provider/admission errors propagate without fallback: %s",
    async (error) => {
        let calls = 0;
        const complete: TopicCurationCompletion = async () => {
            calls++;
            throw error;
        };
        await expect(
            generativeTopicDecision(
                originalRules,
                payload,
                originalSchema,
                complete,
                { kind: "normal", signal: new AbortController().signal },
                "output-contract",
            ),
        ).rejects.toThrow(error);
        expect(calls).toBe(1);
    },
);

test("child cancellation prevents authoring and fallback dispatch", async () => {
    const controller = new AbortController();
    let calls = 0;
    const complete: TopicCurationCompletion = async () => {
        calls++;
        controller.abort(new Error("Cancelled"));
        return nativeAssignments(payload);
    };
    await expect(
        generativeTopicDecision(
            originalRules,
            payload,
            originalSchema,
            complete,
            { kind: "normal", signal: controller.signal },
            "output-contract",
        ),
    ).rejects.toThrow("Cancelled");
    expect(calls).toBe(1);
});

function snapshot(): TopicSnapshot {
    const occurrences = Array.from({ length: 4 }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${index}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "Installation requires explicit approval.",
                score: 1,
            },
            "Service policy",
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "phase1",
        generation: "g1",
        inputFingerprint: "a".repeat(64),
        recipe: "phase1-test",
        generatedAt: "2026-11-15T00:00:00Z",
        occurrences,
        nodes: initialTopicNodes("phase1", occurrences),
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        parents: [],
        related: [],
        limits: [],
    };
}

interface CurationPayload {
    nodes: Array<{ id: string; evidenceIds: string[] }>;
}

function merged(input: unknown) {
    const packet = input as CurationPayload;
    return {
        concepts: [
            {
                label: "Service policy",
                scope: "Installation approval",
                purpose: "Explain approval before installation.",
                memberIds: packet.nodes.map((node) => node.id),
                evidenceIds: [
                    ...new Set(
                        packet.nodes.flatMap((node) => node.evidenceIds),
                    ),
                ],
                salience: 6,
            },
        ],
        deferred: [],
    };
}

test.each([undefined, "decomposed", "output-contract"] as const)(
    "frozen integration preserves preparation, compact identities and host installation (%s)",
    async (stage) => {
        const value = snapshot();
        const calls: Array<{
            phase: string | undefined;
            kind: string | undefined;
            schema: string | undefined;
        }> = [];
        const receipts: TopicGenerativeDecisionReceipt[] = [];
        const packets: TopicCurationPacket[] = [];
        const complete: TopicCurationCompletion = async (
            _rules,
            input,
            schema,
            context,
        ) => {
            calls.push({
                phase: context?.phase,
                kind: context?.kind,
                schema: schema?.name,
            });
            if (schema?.name === "topic_decision_answers")
                return nativeAssignments(input);
            if (schema?.name === "topic_partition_assignments")
                return {
                    assignments: Object.fromEntries(
                        topicPartitionTask(input).slots.map((slot) => [
                            slot.id,
                            "group_0",
                        ]),
                    ),
                };
            return merged(input);
        };
        value.curation = await curateTopics(
            value,
            (node) => node.citations,
            complete,
            new AbortController().signal,
            true,
            undefined,
            undefined,
            {
                priorDeltas: true,
                compactIds: true,
                generativeDecisionStage: stage,
                onGenerativeDecision: (receipt) => receipts.push(receipt),
                onPacket: (packet) => packets.push(packet),
            },
        );
        expect(
            value.curation.concepts
                .flatMap((concept) => concept.memberIds)
                .sort(),
        ).toEqual(value.nodes.map((node) => node.id).sort());
        expect(
            calls
                .filter((call) => call.phase === "preparation")
                .every((call) => call.kind === "normal"),
        ).toBe(true);
        expect(
            calls.filter((call) => call.kind === "adjudication").length,
        ).toBe(stage ? 1 : 0);
        expect(
            receipts.filter((receipt) => receipt.operation === "decision")
                .length,
        ).toBe(stage ? 1 : 0);
        expect(packets).toHaveLength(1);
    },
);

test("stage recipe identities are distinct and invalid native stages are rejected", () => {
    const baseline = topicCurationPolicy(true, {
        compactIds: true,
        priorDeltas: true,
    });
    expect(topicCurationPolicy(true)).toBe(baseline);
    expect(
        topicCurationPolicy(true, { generativeDecisionStage: "decomposed" }),
    ).not.toBe(baseline);
    expect(
        topicCurationPolicy(true, {
            generativeDecisionStage: "output-contract",
        }),
    ).not.toBe(
        topicCurationPolicy(true, { generativeDecisionStage: "decomposed" }),
    );
    expect(() =>
        validateTopicCurationSettings(
            JSON.parse('{"generativeDecisionStage":"native"}'),
        ),
    ).toThrow("Invalid topic curation settings");
});
