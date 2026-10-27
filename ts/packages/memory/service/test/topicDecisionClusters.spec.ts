// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getRuntimeConfigGeneration,
    type DecisionModel,
    type DecisionRequest,
    type DecisionResponse,
} from "@typeagent/aiclient";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import {
    initialTopicNodes,
    queryTopicSnapshot,
    validateTopicSnapshot,
} from "../src/topicSnapshot.js";
import {
    curateTopicsWithDecision,
    pendingTopicDecisionNodes,
} from "../src/topicDecisionCuration.js";
import {
    resolveTopicDecisionExecution,
    topicDecisionIdentity,
    type TopicDecisionReceipt,
    buildTopicDecisionState,
    groundTopicCandidate,
    indexTopicDecisionEvidence,
    groundTopicConcept,
} from "../src/topicDecision.js";
import { createLimiter } from "@typeagent/common-utils";
import { TopicEvidenceIndex } from "../src/topicIndexes.js";
import { curateTopicClusters } from "../src/topicDecisionClusters.js";
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
import { viewHash } from "../src/viewContent.js";
import {
    maintainTopicClusters,
    prioritizeTopicMaintenance,
} from "../src/topicClusterMaintenance.js";

function fixture(count = 3, labels?: string[]): TopicSnapshot {
    const occurrences = Array.from({ length: count }, (_, index) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${String(index).padStart(3, "0")}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: `${labels?.[index] ?? "Mercury"} ${index} has its own scoped original evidence.`,
                score: 1,
            },
            labels?.[index] ?? "Mercury",
            0,
        ),
    );
    return {
        schemaVersion: 1,
        corpusId: "test",
        generation: "generation",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: "2026-10-26T00:00:00Z",
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
function oldConcept(value: TopicSnapshot, index = 0): TopicConcept {
    return {
        id: `concept:${String(index).padStart(32, "0")}`,
        label: "Mercury",
        scope: "Astronomy",
        purpose: "Understand a reference concept",
        memberIds: [value.nodes[index].id],
        citations: value.nodes[index].citations,
        summary: "",
        summaryState: "pending",
        salience: 4,
    };
}
type Select = (name: string, request: DecisionRequest) => string;
function response(request: DecisionRequest, select: Select): DecisionResponse {
    const answers: DecisionResponse["answers"] = {};
    for (const [name, question] of Object.entries(request.questions)) {
        if (question.type === "choice") {
            const choice = select(name, request);
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
                score: 4,
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
function coherent(name: string) {
    if (name === "coherence") return "coherent";
    if (name.startsWith("fit_")) return "keep";
    return name === "disposition_n0" ? "standalone_new" : "n0";
}
function phase(request: DecisionRequest): string | undefined {
    return evidenceRecord(request.state).cluster
        ? evidenceText(
              evidenceRecord(evidenceRecord(request.state).cluster).phase,
          )
        : undefined;
}
const author: TopicCurationCompletion = async (_rules, payload) => {
    const request = evidenceRecord(payload);
    if (request.memberKeys) {
        const native = evidenceRecord(request.native);
        const choices = evidenceRecord(native.members);
        return {
            members: evidenceArray(request.memberKeys, 255).map((key) => ({
                key,
                disposition: ["keep", "different_concept"].includes(
                    evidenceText(choices[evidenceText(key)]),
                )
                    ? choices[evidenceText(key)]
                    : "uncertain",
            })),
            joint: native.coherence === "coherent" ? "compatible" : "uncertain",
            conflicts: [],
            rationale:
                "Synthetic unresolved review preserves native member uncertainty.",
        };
    }
    return {
        concepts: evidenceArray(evidenceRecord(payload).clusters, 256).map(
            (raw) => {
                const key = evidenceText(evidenceRecord(raw).clusterId);
                return {
                    clusterId: key,
                    label: `Mercury group ${key}`,
                    scope: "Astronomy",
                    purpose: "Preserve scoped reference evidence",
                };
            },
        ),
    };
};
function harness(value = fixture(), select: Select = coherent) {
    const requests: DecisionRequest[] = [],
        receipts: TopicDecisionReceipt[] = [];
    const model: DecisionModel = {
        provider: "azure",
        model: "offline",
        providerSource: "factory",
        configGeneration: getRuntimeConfigGeneration(),
        decide: async (request) => {
            requests.push(request);
            return { success: true, data: response(request, select) };
        },
    };
    return {
        requests,
        receipts,
        model,
        run: (prior?: TopicCuration, complete = author, maxQuestions = 64) =>
            curateTopicsWithDecision(
                value,
                (node) => node.citations,
                complete,
                new AbortController().signal,
                {
                    model,
                    clusterValidation: true,
                    concurrency: 24,
                    batchSize: 24,
                    lookahead: 1,
                    maxQuestions,
                    onReceipt: (receipt) => receipts.push(receipt),
                },
                undefined,
                prior,
            ),
    };
}

test("one shared-context localization check asks coherence and every member disposition, then validates authored scope", async () => {
    const value = fixture(),
        original = structuredClone(value);
    const test = harness(value);
    const result = await test.run();
    expect(result.concepts).toHaveLength(1);
    expect([...result.concepts[0].memberIds].sort()).toEqual(
        value.nodes.map((node) => node.id).sort(),
    );
    expect(result.pending).toBeUndefined();
    expect(result.concepts[0].validation).toMatchObject({
        recipe: "cluster-local-v1",
        inputFingerprint: value.inputFingerprint,
        score: 1,
    });
    expect(result.concepts[0].validation?.memberScores).toHaveLength(3);
    const checks = test.requests.filter(
        (request) => evidenceRecord(request.state).cluster,
    );
    expect(checks).toHaveLength(2);
    expect(Object.keys(checks[0].questions)).toEqual([
        "coherence",
        "fit_n0",
        "fit_n1",
        "fit_n2",
    ]);
    expect(phase(checks[0])).toBe("localization");
    expect(phase(checks[1])).toBe("publication");
    for (const request of checks)
        for (const [name, question] of Object.entries(request.questions))
            if (name.startsWith("fit_") && question.type === "choice")
                expect(
                    Object.values(question.criteria).every((criterion) =>
                        criterion.startsWith(
                            `For ONLY state.candidates.${name.slice(4)}:`,
                        ),
                    ),
                ).toBe(true);
    expect(
        evidenceRecord(
            evidenceRecord(evidenceRecord(checks[1].state).cluster).definition,
        ).label,
    ).toBe("Mercury group n0");
    expect(
        test.receipts.some(
            (receipt) =>
                receipt.reason ===
                "explicit-uncertainty-or-incomplete-evidence",
        ),
    ).toBe(false);
    validateTopicSnapshot({ ...value, curation: result });
    expect(value).toEqual(original);
});

test("compact cluster grounding reconstructs every source, role and chronology value exactly", async () => {
    const value = fixture();
    const common = "Exact shared clock qualification. ".repeat(30);
    value.occurrences.forEach((entry, index) => {
        entry.context = {
            role: index === 1 ? "assistant" : "user",
            chronology:
                index === 2
                    ? "opaque original clock"
                    : JSON.stringify({
                          common,
                          ownerId: `turn:${index}`,
                          contextHash: String(index).repeat(64),
                      }),
        };
    });
    const extra = {
        ...value.nodes[0].citations[0],
        excerpt: "Additional exact original evidence.",
    };
    value.nodes[0].citations.push(extra);
    value.occurrences[0].citations.push(extra);
    const contexts = indexTopicDecisionEvidence(value);
    const members = value.nodes.map((node, index) =>
        groundTopicCandidate(
            value,
            node,
            node.citations,
            `n${index}`,
            contexts,
        ),
    );
    const expected = buildTopicDecisionState(
        members.map((candidate) => ({
            candidate,
            score: false,
            targets: [{ key: "n0", candidate: members[0] }],
        })),
    );
    const test = harness(value);
    await test.run();
    const state = structuredClone(
        evidenceRecord(
            test.requests.find((request) => phase(request) === "localization")!
                .state,
        ),
    );
    const sources = evidenceRecord(state.sources);
    for (const raw of Object.values(evidenceRecord(state.evidence))) {
        const record = evidenceRecord(raw);
        if (record.sourceRef !== undefined) {
            Object.assign(
                record,
                evidenceRecord(sources[evidenceText(record.sourceRef)]),
            );
            delete record.sourceRef;
        }
    }
    const chronologyValues = evidenceRecord(state.chronologyValues);
    for (const [id, raw] of Object.entries(evidenceRecord(state.chronology))) {
        if (typeof raw === "string") continue;
        const clock = evidenceRecord(raw);
        const reconstructed = { ...evidenceRecord(clock.fields) };
        for (const [name, ref] of Object.entries(
            evidenceRecord(clock.valueRefs),
        ))
            reconstructed[name] = chronologyValues[evidenceText(ref)];
        expect(reconstructed).toEqual(
            JSON.parse(evidenceText(evidenceRecord(expected.chronology)[id])),
        );
        evidenceRecord(state.chronology)[id] = evidenceRecord(
            expected.chronology,
        )[id];
    }
    delete state.cluster;
    delete state.sources;
    delete state.chronologyValues;
    expect(state).toEqual(expected);
});

test("lossless factoring admits a complete cluster that exceeds the literal logical budget", async () => {
    const value = fixture(6);
    value.occurrences.forEach((entry, index) => {
        entry.context = {
            role: "user",
            chronology: JSON.stringify({
                common: "Original shared qualification remains intact. ".repeat(
                    1400,
                ),
                ownerId: `turn:${index}`,
            }),
        };
    });
    const test = harness(value, (name, request) => {
        const question = request.questions[name];
        if (name.startsWith("disposition_") && question.type === "choice")
            return "n0" in question.criteria ? "n0" : "standalone_new";
        return coherent(name);
    });
    const result = await test.run();
    expect(result.pending).toBeUndefined();
    expect(result.concepts[0].memberIds).toHaveLength(6);
    expect(
        test.receipts.some(
            (receipt) =>
                receipt.uncompactedInputTokens! > 24576 &&
                receipt.inputTokens <= 24576,
        ),
    ).toBe(true);
    validateTopicSnapshot({ ...value, curation: result });
});

test.each(["coherent", "not_coherent", "uncertain"])(
    "singleton publication uses one logically identical membership/coherence claim: %s",
    async (verdict) => {
        const value = fixture(1);
        const test = harness(value, (name, request) =>
            phase(request) === "publication" && name === "coherence"
                ? verdict
                : coherent(name),
        );
        const result = await test.run();
        const request = test.requests.find(
            (request) => phase(request) === "publication",
        )!;
        expect(Object.keys(request.questions)).toEqual(["coherence"]);
        expect(result.concepts).toHaveLength(verdict === "coherent" ? 1 : 0);
        expect(result.pending?.length ?? 0).toBe(
            verdict === "coherent" ? 0 : 1,
        );
        if (verdict === "coherent")
            expect(result.concepts[0].validation!.memberScores).toEqual([
                { nodeId: value.nodes[0].id, score: 1 },
            ]);
        validateTopicSnapshot({ ...value, curation: result });
    },
);

test("a negative whole-cluster verdict localizes one unresolved member without withholding validated siblings", async () => {
    const value = fixture();
    const test = harness(value, (name, request) => {
        if (phase(request) === "localization") {
            if (name === "coherence") return "not_coherent";
            if (name === "fit_n2") return "uncertain";
        }
        return coherent(name);
    });
    const result = await test.run();
    expect([...result.concepts[0].memberIds].sort()).toEqual(
        value.nodes
            .slice(0, 2)
            .map((node) => node.id)
            .sort(),
    );
    expect(result.pending?.map((entry) => entry.nodeId)).toEqual([
        value.nodes[2].id,
    ]);
    expect(
        pendingTopicDecisionNodes(value, result).map((node) => node.id),
    ).toEqual([value.nodes[2].id]);
    validateTopicSnapshot({ ...value, curation: result });
    const page = queryTopicSnapshot(
        { ...value, curation: result },
        { corpusId: "test", curated: true },
    );
    expect(page.pendingCount).toBe(1);
    expect(page.pendingAssignments).toEqual(result.pending);
    expect(page.limits.join(" ")).toContain("not validated concepts");
});

test("localized distinct members become separate proposals and every resulting version is revalidated", async () => {
    const value = fixture();
    const test = harness(value, (name, request) => {
        if (phase(request) === "localization") {
            if (name === "coherence") return "not_coherent";
            if (name === "fit_n2") return "different_concept";
        }
        if (phase(request) === "alternatives" && name === "fit_n2")
            return "standalone_new";
        return coherent(name);
    });
    const result = await test.run();
    expect(
        result.concepts.map((concept) => concept.memberIds.length).sort(),
    ).toEqual([1, 2]);
    expect(
        test.requests.filter((request) => phase(request) === "publication"),
    ).toHaveLength(2);
    expect(result.concepts.every((concept) => concept.validation)).toBe(true);
    validateTopicSnapshot({ ...value, curation: result });
});

test.each(["coherent", "not_coherent", "uncertain"])(
    "inconsistent or unresolved %s verdict cannot publish an uncertified cluster",
    async (verdict) => {
        const test = harness(fixture(), (name, request) => {
            if (phase(request) === "localization") {
                if (name === "coherence") return verdict;
                if (verdict === "coherent" && name === "fit_n2")
                    return "uncertain";
            }
            return coherent(name);
        });
        const result = await test.run();
        expect(result.concepts).toHaveLength(verdict === "coherent" ? 1 : 0);
        expect(result.pending).toHaveLength(verdict === "coherent" ? 1 : 3);
        expect(
            test.requests.filter((request) => phase(request) === "publication"),
        ).toHaveLength(verdict === "coherent" ? 1 : 0);
    },
);

test("rejected final metadata scope does not reuse the earlier coherent receipt", async () => {
    const test = harness(fixture(), (name, request) =>
        phase(request) === "publication" && name === "coherence"
            ? "uncertain"
            : coherent(name),
    );
    const result = await test.run();
    expect(result.concepts).toHaveLength(0);
    expect(result.pending).toHaveLength(3);
    expect(result.pending![0].reason).toContain("Final cluster version");
});

test("a nominated alternative is usable without rewriting its old members or an unrelated concept", async () => {
    const value = fixture(5);
    const prior: TopicCuration = {
        concepts: [oldConcept(value, 0), oldConcept(value, 1)],
        deferred: [],
    };
    const original = structuredClone(prior);
    const test = harness(value, (name, request) => {
        if (phase(request) === "localization") {
            if (name === "coherence") return "not_coherent";
            if (name === "fit_n2") return "different_concept";
        }
        if (phase(request) === "alternatives" && name === "fit_n2") return "c0";
        return coherent(name);
    });
    const result = await test.run(prior);
    const changed = result.concepts.find(
        (concept) => concept.id === prior.concepts[0].id,
    )!;
    expect([...changed.memberIds].sort()).toEqual(
        [value.nodes[0].id, value.nodes[4].id].sort(),
    );
    expect(
        result.concepts.find((concept) => concept.id === prior.concepts[1].id),
    ).toEqual(prior.concepts[1]);
    expect(prior).toEqual(original);
    validateTopicSnapshot({ ...value, curation: result });
});

test.each(["uncertain", "different_concept"])(
    "aviation measures join their fixed collection despite %s old members, with version-bound maintenance priority",
    async (oldDisposition) => {
        const value = fixture(3, [
            "environmental impact of aviation",
            "sustainable aviation fuels",
            "electric aircraft",
        ]);
        const prior: TopicCuration = {
            concepts: [oldConcept(value)],
            deferred: [],
        };
        Object.assign(prior.concepts[0], {
            label: "Reducing air travel's carbon footprint",
            scope: "Aviation emissions and proposed mitigation measures",
            purpose:
                "Explain sustainable fuels, electric planes, efficient aircraft and offsets.",
        });
        const test = harness(value, (name, request) => {
            if (!evidenceRecord(request.state).cluster) return "c0";
            if (name === "coherence") return "not_coherent";
            if (name === "fit_m0") return oldDisposition;
            return "keep";
        });
        const result = await test.run(prior);
        expect(result.concepts[0].memberIds).toEqual(
            value.nodes.map((node) => node.id).sort(),
        );
        expect(result.concepts[0].maintenance).toMatchObject({
            priority: 1,
            suspectMemberIds: [value.nodes[0].id],
        });
        expect(result.concepts[0].validation).toMatchObject({
            coverage: "member-admission-v2",
            method: "decision",
            validatedMemberIds: value.nodes
                .slice(1)
                .map((node) => node.id)
                .sort(),
        });
        expect(result.concepts[0].validation!.memberScores).toHaveLength(2);
        expect(result.pending).toBeUndefined();
        expect(prior.concepts[0].memberIds).toEqual([value.nodes[0].id]);
        expect(
            test.receipts.some(
                (receipt) =>
                    receipt.reason === "local-generative-collection-review",
            ),
        ).toBe(false);
        expect(result.deferred).toEqual([]);
        validateTopicSnapshot({ ...value, curation: result });
    },
);

test("capacity rejection keeps complete evidence and records pending assignments instead of splitting certification", async () => {
    const value = fixture();
    const test = harness(value);
    const result = await test.run(undefined, author, 2);
    expect(result.pending).toHaveLength(3);
    expect(result.pending![0].reason).toContain("question budget");
    expect(
        test.requests.some((request) => evidenceRecord(request.state).cluster),
    ).toBe(false);
    expect(
        test.receipts.some(
            (receipt) =>
                receipt.stage === "validation" && receipt.pendingMembers === 3,
        ),
    ).toBe(true);
    validateTopicSnapshot({ ...value, curation: result });
});

test("pending assignments are retried without duplicate ownership on a later explicit build", async () => {
    const value = fixture();
    const first = await harness(value, (name, request) =>
        phase(request) === "localization" && name === "coherence"
            ? "uncertain"
            : coherent(name),
    ).run();
    const result = await harness(value).run(first);
    expect(result.pending).toBeUndefined();
    expect(result.concepts).toHaveLength(1);
    validateTopicSnapshot({ ...value, curation: result });
});

test("a final localized outlier does not block validated siblings and the reduced version is checked again", async () => {
    const value = fixture();
    const test = harness(value, (name, request) => {
        if (phase(request) === "publication" && "fit_n2" in request.questions) {
            if (name === "coherence") return "not_coherent";
            if (name === "fit_n2") return "uncertain";
        }
        return coherent(name);
    });
    const result = await test.run();
    expect(result.pending).toHaveLength(1);
    expect(result.concepts[0].memberIds).toHaveLength(2);
    expect(result.concepts[0].validation!.memberScores).toHaveLength(2);
    expect(
        test.requests.filter((request) => phase(request) === "publication"),
    ).toHaveLength(2);
    validateTopicSnapshot({ ...value, curation: result });
});

test("cyclic per-member proposals become local pending assignments rather than recursive merges", async () => {
    const value = fixture(4);
    const test = harness(value, (name, request) => {
        if (phase(request) === "localization") {
            if (name === "coherence") return "not_coherent";
            if (name === "fit_n1" || name === "fit_n2")
                return "different_concept";
        }
        if (phase(request) === "alternatives" && name === "fit_n1") return "n2";
        if (phase(request) === "alternatives" && name === "fit_n2") return "n1";
        return coherent(name);
    });
    const result = await test.run();
    expect(result.pending).toHaveLength(2);
    expect(result.concepts[0].memberIds).toHaveLength(2);
    expect(
        result.pending!.every((entry) => entry.reason.includes("cyclic")),
    ).toBe(true);
    validateTopicSnapshot({ ...value, curation: result });
});

test("a failed cluster wave drains started siblings before rejecting and never checkpoints", async () => {
    const value = fixture(2);
    const test = harness(value, (name) =>
        name === "coherence"
            ? "coherent"
            : name.startsWith("fit_")
              ? "keep"
              : "standalone_new",
    );
    const original = test.model.decide;
    let calls = 0,
        active = 0;
    test.model.decide = async (request, options) => {
        if (phase(request) !== "publication") return original(request, options);
        active++;
        const index = calls++;
        try {
            await new Promise((resolve) =>
                setTimeout(resolve, index === 0 ? 2 : 20),
            );
            if (index === 0)
                return {
                    success: false,
                    code: "provider",
                    httpStatus: 503,
                    message: "Synthetic cluster failure",
                    errorCategory: "provider",
                    retryable: false,
                };
            return original(request, options);
        } finally {
            active--;
        }
    };
    const checkpoint = import.meta.jest.fn();
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            author,
            new AbortController().signal,
            { model: test.model, clusterValidation: true, concurrency: 24 },
            checkpoint,
        ),
    ).rejects.toThrow("HTTP 503");
    expect(calls).toBe(2);
    expect(active).toBe(0);
    expect(checkpoint).not.toHaveBeenCalled();
});

test("stale scope, changed evidence context and incomplete canonical support invalidate publication receipts", async () => {
    const value = fixture();
    const result = await harness(value).run();
    for (const mutate of [
        (copy: TopicSnapshot) => {
            copy.curation!.concepts[0].purpose = "A changed concept";
        },
        (copy: TopicSnapshot) => {
            copy.occurrences[0].context = {
                role: "user",
                chronology: "changed",
            };
        },
        (copy: TopicSnapshot) => {
            copy.curation!.concepts[0].citations.pop();
        },
    ]) {
        const copy = structuredClone({ ...value, curation: result });
        mutate(copy);
        expect(() => validateTopicSnapshot(copy)).toThrow(
            /Stale topic cluster|complete original member support/,
        );
    }
});

test("malformed model answers and failed publication inference surface errors without a checkpoint", async () => {
    const value = fixture();
    const test = harness(value);
    const original = test.model.decide;
    const checkpoint = import.meta.jest.fn();
    test.model.decide = async (request, options) => {
        const result = await original(request, options);
        if (phase(request) === "publication" && result.success)
            delete result.data.answers.fit_n1;
        return result;
    };
    await expect(
        curateTopicsWithDecision(
            value,
            (node) => node.citations,
            author,
            new AbortController().signal,
            { model: test.model, clusterValidation: true },
            checkpoint,
        ),
    ).rejects.toThrow("incomplete answer set");
    expect(checkpoint).not.toHaveBeenCalled();
});

test("24 independent publication checks use the existing shared 24-call limiter", async () => {
    const value = fixture(24);
    const test = harness(value, (name) =>
        name === "coherence"
            ? "coherent"
            : name.startsWith("fit_")
              ? "keep"
              : "standalone_new",
    );
    const original = test.model.decide;
    let active = 0,
        peak = 0;
    test.model.decide = async (request, options) => {
        active++;
        peak = Math.max(peak, active);
        try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return await original(request, options);
        } finally {
            active--;
        }
    };
    const result = await test.run();
    expect(peak).toBe(24);
    expect(active).toBe(0);
    expect(result.concepts).toHaveLength(24);
    expect(
        test.receipts.filter(
            (receipt) => receipt.reason === "cluster-publication",
        ),
    ).toHaveLength(24);
    validateTopicSnapshot({ ...value, curation: result });
});

test("cluster policy is opt-in, identity-distinct and rejects unsupported speculative combinations", () => {
    const { model } = harness();
    expect(resolveTopicDecisionExecution().concurrency).toBe(1);
    expect(
        resolveTopicDecisionExecution({ clusterValidation: false }),
    ).not.toHaveProperty("clusterValidation");
    expect(
        topicDecisionIdentity(model, "v2", { clusterValidation: true }),
    ).not.toBe(topicDecisionIdentity(model));
    for (const options of [{ lookahead: 2 }, { fullTransactions: true }])
        expect(() =>
            resolveTopicDecisionExecution({
                ...options,
                clusterValidation: true,
            }),
        ).toThrow("lookahead 1");
    expect(viewHash(fixture())).toHaveLength(64);
});

function reviewAnswer(
    payload: unknown,
    disposition: (key: string) => string = () => "keep",
    joint = "compatible",
    conflicts: string[] = [],
) {
    return {
        members: evidenceArray(evidenceRecord(payload).memberKeys, 255).map(
            (key) => ({ key, disposition: disposition(evidenceText(key)) }),
        ),
        joint,
        conflicts,
        rationale: "Synthetic evidence-grounded local collection review.",
    };
}

test("one local generative review resolves a final contradiction with honest method and member coverage", async () => {
    const value = fixture();
    const test = harness(value, (name, request) =>
        phase(request) === "publication" && name === "coherence"
            ? "not_coherent"
            : coherent(name),
    );
    let reviews = 0;
    const result = await test.run(undefined, async (rules, payload, schema) => {
        if (evidenceRecord(payload).memberKeys) {
            reviews++;
            expect(schema?.strict).toBe(true);
            return reviewAnswer(payload);
        }
        return author(rules, payload, schema);
    });

    expect(reviews).toBe(1);
    expect(result.pending).toBeUndefined();
    expect(result.concepts[0].validation).toMatchObject({
        coverage: "member-admission-v2",
        method: "generative",
        validatedMemberIds: value.nodes.map((node) => node.id).sort(),
    });
    expect(result.concepts[0].validation!.memberScores).toBeUndefined();
    expect(result.concepts[0].validation!.score).toBeUndefined();
    validateTopicSnapshot({ ...value, curation: result });
});

test.each(["uncertain", "different_concept"])(
    "the same existing-collection version is adjudicated only once, including a final %s fit",
    async (finalChoice) => {
        const value = fixture();
        const prior: TopicCuration = {
            concepts: [oldConcept(value)],
            deferred: [],
        };
        const test = harness(value, (name, request) => {
            if (!phase(request)) return "c0";
            return name === "fit_n1"
                ? phase(request) === "publication"
                    ? finalChoice
                    : "uncertain"
                : "keep";
        });
        let calls = 0;
        const result = await test.run(prior, async (_rules, payload) => {
            calls++;
            return reviewAnswer(payload);
        });
        expect(calls).toBe(1);
        expect(result.pending).toBeUndefined();
        expect(result.concepts[0].validation!.method).toBe("generative");
        validateTopicSnapshot({ ...value, curation: result });
    },
);

test("a witnessed new-group conflict localizes its members rather than blocking unrelated siblings", async () => {
    const value = fixture();
    const test = harness(value, (name, request) =>
        phase(request) === "localization" && name === "coherence"
            ? "not_coherent"
            : coherent(name),
    );
    let reviews = 0;
    const result = await test.run(undefined, async (rules, payload, schema) => {
        if (evidenceRecord(payload).memberKeys) {
            reviews++;
            return reviewAnswer(payload, () => "keep", "conflict", [
                "n1",
                "n2",
            ]);
        }
        return author(rules, payload, schema);
    });
    expect(reviews).toBe(1);
    expect(result.concepts[0].memberIds).toEqual([value.nodes[0].id]);
    expect(result.pending!.map((entry) => entry.nodeId).sort()).toEqual(
        value.nodes
            .slice(1)
            .map((node) => node.id)
            .sort(),
    );
    validateTopicSnapshot({ ...value, curation: result });
});

test.each([
    "invented-member",
    "missing-witness",
    "extra-field",
    "provider-failure",
])(
    "invalid local adjudication surfaces errors instead of publishing: %s",
    async (failure) => {
        const test = harness(fixture(), (name, request) =>
            phase(request) === "localization" && name === "coherence"
                ? "not_coherent"
                : coherent(name),
        );
        await expect(
            test.run(undefined, async (_rules, payload) => {
                if (failure === "provider-failure")
                    throw new Error("Synthetic provider failure");
                const review = reviewAnswer(payload);
                if (failure === "invented-member")
                    review.members[0].key = "invented";
                if (failure === "missing-witness") review.joint = "conflict";
                return failure === "extra-field"
                    ? { ...review, citations: [] }
                    : review;
            }),
        ).rejects.toThrow();
    },
);

test("fixed checks exclude alternative context and rejected members search the complete nominated universe separately", async () => {
    const value = fixture(5);
    const prior: TopicCuration = {
        concepts: [oldConcept(value, 0), oldConcept(value, 1)],
        deferred: [],
    };
    const test = harness(value, (name, request) => {
        if (phase(request) === "localization" && name === "fit_n2")
            return "different_concept";
        if (phase(request) === "alternatives" && name === "fit_n2") return "c0";
        return coherent(name);
    });
    await test.run(prior);
    const fixed = test.requests.find(
        (request) => phase(request) === "localization",
    )!;
    expect(
        Object.keys(evidenceRecord(evidenceRecord(fixed.state).targets)),
    ).toHaveLength(0);
    const search = test.requests.find(
        (request) => phase(request) === "alternatives",
    )!;
    const alternatives = Object.keys(
        evidenceRecord(evidenceRecord(search.state).targets),
    );
    expect(alternatives).toEqual(expect.arrayContaining(["c0", "c1"]));
    expect(Object.keys(search.questions)).toEqual(["coherence", "fit_n2"]);
});

test("old-member questions exceeding capacity do not consume the new admission budget", async () => {
    const value = fixture();
    const prior: TopicCuration = {
        concepts: [oldConcept(value)],
        deferred: [],
    };
    const test = harness(value, (name, request) =>
        phase(request) ? "keep" : "c0",
    );
    const result = await test.run(prior, author, 2);
    expect(result.pending).toBeUndefined();
    expect(result.concepts[0].memberIds).toHaveLength(3);
    expect(result.concepts[0].maintenance!.priority).toBe(1);
    expect(result.concepts[0].maintenance!.reasons.join(" ")).toContain(
        "capacity",
    );
    for (const request of test.requests.filter((request) => phase(request))) {
        const state = evidenceRecord(request.state);
        expect(Object.keys(evidenceRecord(state.targets))).toHaveLength(0);
        expect(
            Object.values(evidenceRecord(state.evidence)).every(
                (raw) => evidenceRecord(raw).sourceId !== "source-000",
            ),
        ).toBe(true);
        expect(
            evidenceText(evidenceRecord(state.cluster).anchorHealth),
        ).toContain("Not checked");
    }
    validateTopicSnapshot({ ...value, curation: result });
});

test("old-anchor evidence exceeding 24576 tokens is explicitly excluded from the narrower complete admission question", async () => {
    const value = fixture();
    value.occurrences[0].context = {
        role: "user",
        chronology: "Exact original old-anchor clock qualification. ".repeat(
            10000,
        ),
    };
    const prior: TopicCuration = {
        concepts: [oldConcept(value)],
        deferred: [],
    };
    const test = harness(value, () => "keep");
    const contexts = indexTopicDecisionEvidence(value);
    const candidates = value.nodes
        .slice(1)
        .map((node, index) =>
            groundTopicCandidate(
                value,
                node,
                node.citations,
                `n${index}`,
                contexts,
            ),
        );
    const anchor = groundTopicConcept(value, prior.concepts[0], "c0", contexts);
    const result = await curateTopicClusters(
        {
            snapshot: value,
            candidates,
            concepts: prior.concepts,
            evidenceContexts: contexts,
            evidenceIndex: new TopicEvidenceIndex(value),
            options: {
                model: test.model,
                clusterValidation: true,
                onReceipt: (receipt) => test.receipts.push(receipt),
            },
            signal: new AbortController().signal,
            limiter: createLimiter(24),
        },
        prior,
        candidates.map((candidate) => ({
            candidate,
            targets: [anchor],
            score: false,
        })),
        new Map(candidates.map((candidate) => [candidate.key, "c0"])),
        new Map(candidates.map((candidate) => [candidate.key, 4])),
        async () => [],
        author,
    );
    expect(
        test.receipts.some(
            (receipt) =>
                receipt.stage === "packing" && receipt.inputTokens > 24576,
        ),
    ).toBe(true);
    expect(
        test.receipts.some(
            (receipt) =>
                receipt.stage === "packing" && receipt.inputTokens <= 24576,
        ),
    ).toBe(true);
    expect(result.concepts[0].memberIds).toHaveLength(3);
    expect(result.concepts[0].maintenance!.priority).toBe(1);
    expect(result.pending).toBeUndefined();
    for (const request of test.requests) {
        expect(
            Object.keys(
                evidenceRecord(evidenceRecord(request.state).candidates),
            ).sort(),
        ).toEqual(["n0", "n1"]);
        expect(
            Object.keys(evidenceRecord(evidenceRecord(request.state).targets)),
        ).toHaveLength(0);
    }
    validateTopicSnapshot({ ...value, curation: result });
});

test("oversized complete maintenance retains a durable capacity signal without inference or silent success", async () => {
    const value = fixture(1);
    value.occurrences[0].context = {
        role: "user",
        chronology: "Exact original complete maintenance context. ".repeat(
            10000,
        ),
    };
    const concept = oldConcept(value);
    prioritizeTopicMaintenance(
        value,
        concept,
        concept.memberIds,
        0.8,
        "Unresolved old anchor",
    );
    const { model } = harness(value);
    const complete = import.meta.jest.fn();
    const checkpoint = import.meta.jest.fn();
    const result = await maintainTopicClusters(
        value,
        { concepts: [concept], deferred: [] },
        complete,
        new AbortController().signal,
        { model, clusterValidation: true },
        checkpoint,
    );
    expect(complete).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(result.concepts[0].maintenance!.priority).toBe(0.8);
    expect(result.concepts[0].maintenance!.reasons.join(" ")).toContain(
        "context budget",
    );
    expect(result.concepts[0].memberIds).toEqual(concept.memberIds);
    validateTopicSnapshot({ ...value, curation: result });
});

test("maintenance really processes highest uncertainty first, with stable ties, and only positive outliers move", async () => {
    const value = fixture(4);
    const prior: TopicCuration = {
        concepts: value.nodes.map((_, index) => oldConcept(value, index)),
        deferred: [],
    };
    [0.2, 0.8, 0.8, 0.4].forEach((priority, index) =>
        prioritizeTopicMaintenance(
            value,
            prior.concepts[index],
            [value.nodes[index].id],
            priority,
            "Synthetic old-anchor uncertainty",
        ),
    );
    const original = structuredClone(prior);
    const order: string[] = [];
    const { model } = harness(value);
    const checkpoints: TopicCuration[] = [];
    const result = await maintainTopicClusters(
        value,
        prior,
        async (_rules, payload) => {
            const state = evidenceRecord(evidenceRecord(payload).state);
            const member = Object.values(evidenceRecord(state.candidates))[0];
            order.push(evidenceText(evidenceRecord(member).label));
            return reviewAnswer(payload);
        },
        new AbortController().signal,
        { model, clusterValidation: true },
        async (curation) => {
            checkpoints.push(structuredClone(curation));
        },
    );
    // Distinct scopes identify the original member even though all labels are Mercury.
    expect(order).toHaveLength(4);
    const completedIds = checkpoints
        .map((curation, index) =>
            prior.concepts
                .filter(
                    (concept) =>
                        concept.maintenance &&
                        !curation.concepts.find(
                            (entry) => entry.id === concept.id,
                        )!.maintenance,
                )
                .map((concept) => concept.id)
                .filter(
                    (id) =>
                        index === 0 ||
                        checkpoints[index - 1].concepts.find(
                            (entry) => entry.id === id,
                        )!.maintenance,
                ),
        )
        .flat();
    expect(completedIds).toEqual(
        [1, 2, 3, 0].map((index) => prior.concepts[index].id),
    );
    expect(result.concepts.every((concept) => !concept.maintenance)).toBe(true);
    expect(prior).toEqual(original);
    validateTopicSnapshot({ ...value, curation: result });
});

test("maintenance preserves uncertain members and returns positive old outliers to pending without erasing evidence", async () => {
    const value = fixture();
    const concept = oldConcept(value);
    concept.memberIds = value.nodes.map((node) => node.id).sort();
    concept.citations = value.nodes.flatMap((node) => node.citations);
    prioritizeTopicMaintenance(
        value,
        concept,
        concept.memberIds,
        1,
        "Review this cluster",
    );
    const prior: TopicCuration = { concepts: [concept], deferred: [] };
    const { model } = harness(value);
    const result = await maintainTopicClusters(
        value,
        prior,
        async (_rules, payload) =>
            reviewAnswer(payload, (key) =>
                key === "m0"
                    ? "different_concept"
                    : key === "m1"
                      ? "uncertain"
                      : "keep",
            ),
        new AbortController().signal,
        { model, clusterValidation: true },
    );
    expect(result.concepts[0].memberIds).toEqual(concept.memberIds.slice(1));
    expect(result.pending!.map((entry) => entry.nodeId)).toEqual([
        concept.memberIds[0],
    ]);
    expect(result.concepts[0].maintenance!.suspectMemberIds).toEqual([
        concept.memberIds[1],
    ]);
    expect(result.concepts[0].validation!.validatedMemberIds).toEqual([
        concept.memberIds[2],
    ]);
    validateTopicSnapshot({ ...value, curation: result });
});

test.each(["stale", "provider", "cancelled"])(
    "failed maintenance retains the caller's signal and cannot checkpoint: %s",
    async (failure) => {
        const value = fixture(1);
        const concept = oldConcept(value);
        prioritizeTopicMaintenance(
            value,
            concept,
            concept.memberIds,
            1,
            "Unresolved old anchor",
        );
        if (failure === "stale")
            concept.maintenance!.signature = "f".repeat(64);
        const prior: TopicCuration = { concepts: [concept], deferred: [] };
        const original = structuredClone(prior);
        const { model } = harness(value);
        const controller = new AbortController();
        const checkpoint = import.meta.jest.fn();
        await expect(
            maintainTopicClusters(
                value,
                prior,
                async (_rules, payload) => {
                    if (failure === "cancelled") {
                        controller.abort();
                        return reviewAnswer(payload);
                    }
                    throw new Error("Synthetic provider failure");
                },
                controller.signal,
                { model, clusterValidation: true },
                checkpoint,
            ),
        ).rejects.toThrow();
        expect(checkpoint).not.toHaveBeenCalled();
        expect(prior).toEqual(original);
    },
);
