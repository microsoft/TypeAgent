// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RequestAdmissionError, type DecisionModel } from "@typeagent/aiclient";
import {
    buildTopicDecisionRequest,
    planTopicDecisionChoice,
} from "../src/topicDecision.js";
import type { TopicCurationCompletion } from "../src/topicCuration.js";
import type { PreparedTopicWindow } from "../src/topicFrozenPreparation.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { initialTopicNodes } from "../src/topicSnapshot.js";
import {
    refinePreparedTopicCuration,
    type PreparedTopicRefinementOptions,
} from "../src/topicPreparedRefinement.js";
import type { PreparedTopicReview } from "../src/topicPreparedDecisionReview.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "../src/topicTypes.js";
import { viewHash } from "../src/viewMerge.js";
import {
    evidenceArray,
    evidenceRecord,
    evidenceText,
} from "../src/viewSynthesisEvidence.js";

const model: DecisionModel = {
    provider: "azure",
    model: "offline",
    providerSource: "factory",
    configGeneration: 1,
    decide: async () => {
        throw new Error("Offline refinement must not dispatch");
    },
};

function fixture(count = 4, sharedSource = false) {
    const occurrences = Array.from({ length: count }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${sharedSource ? 0 : ordinal}`,
                revisionId: "r1",
                blockOrdinal: sharedSource ? ordinal : 0,
                text: "The service requires explicit installation approval.",
                score: 1,
            },
            "Installation approval",
            0,
        ),
    );
    const nodes = initialTopicNodes("refinement", occurrences);
    const snapshot: TopicSnapshot = {
        schemaVersion: 1,
        corpusId: "refinement",
        generation: "test",
        inputFingerprint: "a".repeat(64),
        recipe: "test",
        generatedAt: new Date().toISOString(),
        occurrences,
        nodes,
        influenceSources: [],
        parents: [],
        related: [],
        limits: [],
    };
    const concept = (indices: number[]): TopicConcept => ({
        id: `concept:${viewHash(["approval", nodes[indices[0]].id]).slice(0, 32)}`,
        label: "Installation approval",
        scope: "Service",
        purpose: "Explain the installation approval requirement",
        memberIds: indices.map((index) => nodes[index].id).sort(),
        citations: indices.flatMap((index) => nodes[index].citations),
        summary: "",
        summaryState: "pending",
        salience: 5,
    });
    const window: PreparedTopicWindow = {
        current: { concepts: [concept([0])], deferred: [] },
        prepared: [
            {
                concepts: [concept([1, 2])],
                deferred: [{ nodeId: nodes[3].id, reason: "Passing mention" }],
            },
        ],
    };
    const curation: TopicCuration = {
        concepts: [concept([0, 1, 2])],
        deferred: [{ nodeId: nodes[3].id, reason: "Passing mention" }],
    };
    return { snapshot, window, nodes, concept, curation };
}

const positive: PreparedTopicReview = async (packets) =>
    packets.map((packet) =>
        Object.fromEntries(
            Object.keys(packet.request.questions).map((key) => [
                key,
                key.startsWith("evidence_")
                    ? "reported_episode"
                    : key.startsWith("disposition_")
                      ? (packet.tasks.find(
                            (task) =>
                                `disposition_${task.candidate.key}` === key,
                        )?.targets[0]?.key ?? "not_covered")
                      : key === "repair_kind"
                        ? "split_membership"
                        : key === "coherence"
                          ? "coherent"
                          : "keep",
            ]),
        ),
    );

const noAuthoring: TopicCurationCompletion = async () => {
    throw new Error("Unexpected authoring");
};

function options(
    overrides: Partial<PreparedTopicRefinementOptions> = {},
): PreparedTopicRefinementOptions {
    return {
        model,
        recoverOwnership: false,
        repairDefinitions: false,
        review: positive,
        complete: noAuthoring,
        signal: new AbortController().signal,
        ...overrides,
    };
}

function generated(payload: unknown, merge = false) {
    const nodes = evidenceArray(evidenceRecord(payload).nodes, 1000).map(
        evidenceRecord,
    );
    const groups = merge ? [nodes] : nodes.map((node) => [node]);
    return {
        concepts: groups.map((group) => ({
            label: "Repaired installation approval",
            scope: "Service",
            purpose: "Explain the source-qualified installation requirement",
            memberIds: group.map((node) => evidenceText(node.id)),
            evidenceIds: [
                ...new Set(
                    group.flatMap((node) =>
                        evidenceArray(node.evidenceIds, 1000).map((id) =>
                            evidenceText(id),
                        ),
                    ),
                ),
            ],
            salience: 5,
        })),
        deferred: [],
    };
}

function localization(
    payload: unknown,
    disposition: (key: string) => "keep" | "different_concept" | "uncertain",
) {
    const keys = evidenceArray(evidenceRecord(payload).memberKeys, 1000).map(
        (key) => evidenceText(key),
    );
    return {
        members: keys.map((key) => ({ key, disposition: disposition(key) })),
        joint: "compatible",
        conflicts: [],
        rationale: "Original evidence identifies the mismatched scope.",
    };
}

test("strict single-original metadata repair preserves original anchors and uses its rationale without a redundant repair-kind decision", async () => {
    const { snapshot, window, concept, curation, nodes } = fixture(4, true);
    curation.concepts = [concept([0]), concept([1]), concept([2])];
    const kinds: Array<string | undefined> = [];
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            definitionAdequacy: true,
            review: async (packets, reason) => {
                expect(reason).not.toBe("prepared-definition-repair-kind");
                return positive(packets, reason);
            },
            complete: async (rules, payload, schema, call) => {
                if (schema?.name === "memory_local_collection_review") {
                    expect(evidenceRecord(payload).definitionAuthority).toBe(
                        "new-owner",
                    );
                    expect(rules).toContain(
                        "Every material clause of a new definition",
                    );
                    expect(rules).toContain("whole source contains no answer");
                    expect(rules).toContain(
                        "local-information and current-information limitations",
                    );
                    expect(rules).toContain(
                        "Repair may narrow a rejected overbroad definition",
                    );
                    const state = evidenceRecord(evidenceRecord(payload).state);
                    const definition = evidenceRecord(
                        evidenceRecord(state.cluster).definition,
                    );
                    const fixed =
                        definition.label === "Repaired installation approval";
                    const value = localization(payload, () =>
                        fixed ? "keep" : "different_concept",
                    );
                    return {
                        ...value,
                        rationale: "Members do not conflict.",
                        members: value.members.map((member) => ({
                            ...member,
                            rationale: fixed
                                ? "The approval actor is explained."
                                : "The definition omits the required approval actor.",
                        })),
                    };
                }
                kinds.push(call?.kind);
                expect(rules).toContain("explicitly coordinated subjects");
                expect(rules).toContain(
                    "Every material clause of a new definition",
                );
                expect(JSON.stringify(payload)).toContain(
                    "The definition omits the required approval actor.",
                );
                expect(JSON.stringify(payload)).toContain(
                    "Review concern to investigate, not source fact",
                );
                expect(JSON.stringify(payload)).not.toContain(
                    "Repair the rejected hypothesis [",
                );
                for (const raw of evidenceArray(
                    evidenceRecord(payload).nodes,
                    1000,
                ))
                    expect(evidenceText(evidenceRecord(raw).purpose)).toContain(
                        '"subjectEvidence":[',
                    );
                const authored = generated(payload);
                for (const concept of authored.concepts)
                    concept.evidenceIds = concept.evidenceIds.slice(0, 1);
                return authored;
            },
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(kinds).toEqual(["metadata"]);
    expect(result.curation.concepts.map((c) => c.memberIds).sort()).toEqual(
        curation.concepts.map((c) => c.memberIds).sort(),
    );
    for (const id of [nodes[1].id, nodes[2].id]) {
        const owner = result.curation.concepts.find((entry) =>
            entry.memberIds.includes(id),
        );
        expect(owner?.citations).toEqual(
            expect.arrayContaining(
                nodes.find((node) => node.id === id)!.citations,
            ),
        );
    }
    expect(result.curation.concepts[0]).toEqual(curation.concepts[0]);
});

test("source adjacency nominates lexically missed owners without bypassing complete-union validation", async () => {
    const { snapshot, window, nodes, curation } = fixture(4, true);
    nodes[3].label = "Unrelated lexical label";
    let nominated = 0;
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            subjectMateriality: true,
            review: async (packets, reason) => {
                if (reason === "prepared-reference-coverage")
                    nominated = packets.flatMap((p) =>
                        p.tasks.flatMap((t) => t.targets),
                    ).length;
                return positive(packets, reason);
            },
        }),
    );
    expect(nominated).toBeGreaterThan(0);
    expect(result.outcome).toBe("complete");
    expect(result.events).toContainEqual(
        expect.objectContaining({
            outcome: "jointly-certified-existing-ownership",
        }),
    );
    expect(result.curation.concepts).toHaveLength(1);
    expect(result.curation.concepts[0].memberIds).toContain(nodes[3].id);
});

test.each([
    ["compatible", "keep", true],
    ["conflict", "keep", false],
    ["uncertain", "keep", false],
    ["compatible", "uncertain", false],
    ["compatible", "different_concept", false],
] as const)(
    "strict complete-union adjudication requires compatible joint and every member kept: %s / %s",
    async (joint, disposition, accepted) => {
        const { snapshot, window, nodes, curation } = fixture();
        const checked: string[][] = [];
        let authored = 0;
        const result = await refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                recoverOwnership: true,
                definitionAdequacy: true,
                review: async (packets, reason) => {
                    if (reason !== "prepared-fixed-root-validation")
                        return positive(packets, reason);
                    checked.push(
                        ...packets.map((packet) =>
                            packet.tasks
                                .map((task) => task.candidate.node.id)
                                .sort(),
                        ),
                    );
                    return packets.map((packet) =>
                        Object.fromEntries(
                            Object.keys(packet.request.questions).map((key) => [
                                key,
                                "uncertain",
                            ]),
                        ),
                    );
                },
                complete: async (_rules, payload, _schema, call) => {
                    if (call?.kind !== "adjudication") {
                        authored++;
                        return generated(payload);
                    }
                    expect(evidenceRecord(payload).native).toBeNull();
                    const review = localization(payload, () => disposition);
                    expect(review.members).toHaveLength(3);
                    return {
                        ...review,
                        joint,
                        conflicts:
                            joint === "conflict"
                                ? review.members.slice(0, 2).map((m) => m.key)
                                : [],
                        members: review.members.map((member) => ({
                            ...member,
                            rationale:
                                "The original source explicitly scopes the installation approval requirement.",
                        })),
                    };
                },
            }),
        );
        expect(checked).toEqual([
            nodes
                .slice(1)
                .map((node) => node.id)
                .sort(),
        ]);
        expect(result.outcome).toBe("complete");
        expect(authored).toBe(accepted ? 0 : 1);
        expect(
            result.events.some(
                (event) =>
                    event.outcome === "jointly-certified-existing-ownership",
            ),
        ).toBe(accepted);
        expect(result.curation.concepts).toHaveLength(accepted ? 1 : 2);
    },
);

test.each([true, false])(
    "repair-first reconsiders pending ownership only with prior admission: %s",
    async (previouslyOwned) => {
        const { snapshot, window, concept, curation, nodes } = fixture();
        curation.concepts = [concept([0]), concept([1]), concept([2])];
        if (!previouslyOwned) {
            curation.concepts.splice(1, 1);
            curation.pending = [
                {
                    nodeId: nodes[1].id,
                    candidateTargetIds: [],
                    reason: "Admission remains uncertain",
                },
            ];
        }
        let localized = 0;
        let finalValidationBatches = 0;
        const result = await refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                recoverOwnership: true,
                repairDefinitions: true,
                definitionAdequacy: true,
                repairFirst: true,
                review: async (packets, reason) => {
                    if (reason === "prepared-final-definition-validation")
                        finalValidationBatches++;
                    if (
                        reason === "prepared-definition-repair-kind" ||
                        reason === "prepared-reference-evidence"
                    )
                        return packets.map((packet) =>
                            Object.fromEntries(
                                Object.keys(packet.request.questions).map(
                                    (key) => [
                                        key,
                                        reason === "prepared-reference-evidence"
                                            ? "incidental"
                                            : "uncertain",
                                    ],
                                ),
                            ),
                        );
                    return positive(packets, reason);
                },
                complete: async (_rules, payload, _schema, call) => {
                    expect(call?.kind).toBe("adjudication");
                    localized++;
                    const review = localization(payload, () =>
                        previouslyOwned && localized === 1
                            ? "uncertain"
                            : "keep",
                    );
                    return {
                        ...review,
                        members: review.members.map((member) => ({
                            ...member,
                            rationale:
                                "The original approval requirement needs a supported owner, not a new admission decision.",
                        })),
                    };
                },
            }),
        );
        expect(result.outcome).toBe(
            previouslyOwned ? "complete" : "needs-review",
        );
        expect(
            result.curation.concepts
                .flatMap((owner) => owner.memberIds)
                .includes(nodes[1].id),
        ).toBe(previouslyOwned);
        expect(
            result.curation.pending?.map((entry) => entry.nodeId) ?? [],
        ).toEqual(previouslyOwned ? [] : [nodes[1].id]);
        expect(finalValidationBatches).toBe(1);
        expect(localized).toBe(previouslyOwned ? 3 : 1);
    },
);

test("refinement is opt-in and does not mutate captured inputs", async () => {
    const { snapshot, window, curation } = fixture();
    const originals = structuredClone({ snapshot, window, curation });
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options(),
    );
    expect(result).toMatchObject({
        outcome: "complete",
        curation,
        events: [],
    });
    expect({ snapshot, window, curation }).toEqual(originals);
});

test("subject materiality adjudicates positives without borrowing substance from another subject", async () => {
    const { snapshot, window, curation } = fixture();
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            subjectMateriality: true,
            adjudicateEvidence: async (packets) =>
                packets.map((packet) => {
                    for (const question of Object.values(
                        packet.request.questions,
                    )) {
                        expect(question.type).toBe("choice");
                        expect(question.instructions).toContain(
                            "SUBJECT MATERIALITY",
                        );
                        expect(question.instructions).toContain(
                            "unspecified future artifact",
                        );
                        expect(question.instructions).toContain(
                            "Supported chronological coreference",
                        );
                        expect(question.instructions).toContain(
                            "request or intention",
                        );
                    }
                    return Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            "incidental",
                        ]),
                    );
                }),
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(result.curation).toEqual(curation);
    expect(result.events).toContainEqual(
        expect.objectContaining({
            stage: "evidence",
            outcome: "incidental",
        }),
    );
    expect(result.recipe).toContain("subject-materiality-v5");
});

test("definition adequacy checks even native-certified owners and requires per-member evidence", async () => {
    const { snapshot, window, curation } = fixture();
    let reviewed = 0;
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            definitionAdequacy: true,
            complete: async (rules, payload) => {
                reviewed++;
                expect(rules).toContain("ALL essential developed dimensions");
                expect(rules).toContain("explicitly coordinated subjects");
                expect(rules).toContain(
                    "missing local wording does not establish",
                );
                expect(rules).toContain(
                    "A member need not independently establish every clause",
                );
                expect(evidenceRecord(payload).definitionAuthority).toBe(
                    "fixed-prior",
                );
                expect(rules).not.toContain(
                    "Every material clause of a new definition",
                );
                const value = localization(payload, () => "keep");
                return {
                    ...value,
                    members: value.members.map((member) => ({
                        ...member,
                        rationale:
                            "Original source requires explicit installation approval; the unchanged purpose states that requirement.",
                    })),
                };
            },
        }),
    );
    expect(reviewed).toBe(1);
    expect(result.outcome).toBe("complete");
    expect(result.curation).toEqual(curation);
    expect(result.recipe).toContain("definition-adequacy-v5");
});

test("strict native and local reviews share complete indexed source context without crossing revisions", async () => {
    const { snapshot, window, curation } = fixture(4, true);
    const otherRevision = indexedTopicOccurrence(
        {
            sourceId: "source-0",
            revisionId: "r2",
            blockOrdinal: 4,
            text: "Unrelated revision evidence must stay outside the review.",
            score: 1,
        },
        "Other revision",
        0,
    );
    snapshot.occurrences.push(otherRevision);
    snapshot.nodes.push(...initialTopicNodes("refinement", [otherRevision]));
    const original = structuredClone(snapshot);
    let nativeReviewed = 0;
    let locallyReviewed = 0;
    const check = (state: unknown) => {
        const candidates = Object.values(
            evidenceRecord(evidenceRecord(state).candidates),
        ).map(evidenceRecord);
        for (const candidate of candidates) {
            const anchors = evidenceArray(candidate.subjectEvidence, 1000).map(
                evidenceRecord,
            );
            expect(anchors).toHaveLength(1);
            expect(anchors[0].sourceId).toBe("source-0");
            expect(anchors[0].revisionId).toBe("r1");
        }
        if (candidates.length > 1)
            expect(candidates[0]).not.toEqual(candidates[1]);
        const evidence = Object.values(
            evidenceRecord(evidenceRecord(state).evidence),
        ).map(evidenceRecord);
        expect(evidence).toHaveLength(4);
        expect(JSON.stringify(evidence)).not.toContain(
            "Unrelated revision evidence",
        );
    };
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            subjectMateriality: true,
            repairDefinitions: true,
            definitionAdequacy: true,
            review: async (packets, reason) => {
                for (const packet of packets) {
                    check(packet.request.state);
                    if (reason === "prepared-final-definition-validation")
                        expect(
                            evidenceRecord(
                                evidenceRecord(packet.request.state).cluster,
                            ).rules,
                        ).toContain("subjectEvidence citation tuples");
                    nativeReviewed++;
                }
                return positive(packets, reason);
            },
            adjudicateEvidence: async (packets) =>
                packets.map((packet) =>
                    Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            "incidental",
                        ]),
                    ),
                ),
            complete: async (_rules, payload) => {
                check(evidenceRecord(payload).state);
                locallyReviewed++;
                const value = localization(payload, () => "keep");
                return {
                    ...value,
                    members: value.members.map((member) => ({
                        ...member,
                        rationale:
                            "The source context preserves the approval requirement.",
                    })),
                };
            },
        }),
    );
    expect(nativeReviewed).toBeGreaterThan(0);
    expect(locallyReviewed).toBeGreaterThan(0);
    expect(result.outcome).toBe("complete");
    expect(result.curation).toEqual(curation);
    expect(snapshot).toEqual(original);
});

test("definition adequacy rejects missing per-member rationales rather than accepting a global verdict", async () => {
    const { snapshot, window, curation } = fixture();
    await expect(
        refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                repairDefinitions: true,
                definitionAdequacy: true,
                complete: async (_rules, payload) =>
                    localization(payload, () => "keep"),
            }),
        ),
    ).rejects.toThrow("Invalid local collection review fields");
});

test("repair-first reuses exact unchanged owner certificates across ownership admission", async () => {
    const { snapshot, window, curation } = fixture();
    const reasons: string[] = [];
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            repairFirst: true,
            recoverOwnership: true,
            review: async (packets, reason) => {
                reasons.push(reason);
                return reason === "prepared-reference-evidence"
                    ? packets.map((packet) =>
                          Object.fromEntries(
                              Object.keys(packet.request.questions).map(
                                  (key) => [key, "incidental"],
                              ),
                          ),
                      )
                    : positive(packets, reason);
            },
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(reasons).toEqual([
        "prepared-final-definition-validation",
        "prepared-reference-evidence",
    ]);
    expect(result.recipe).toContain("repair-first");
});
test("admitted duplicate receives jointly validated ownership, including earlier incoming members", async () => {
    const { snapshot, window, nodes, curation } = fixture();
    const checked: string[][] = [];
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            review: async (packets, reason) => {
                if (reason === "prepared-reference-evidence") {
                    for (const packet of packets) {
                        expect(
                            packet.tasks.every((task) => !task.targets.length),
                        ).toBe(true);
                        expect(JSON.stringify(packet.request)).toContain(
                            "lasting user identity",
                        );
                    }
                }
                if (reason === "prepared-fixed-root-validation")
                    checked.push(
                        ...packets.map((packet) =>
                            packet.tasks
                                .map((task) => task.candidate.node.id)
                                .sort(),
                        ),
                    );
                return positive(packets, reason);
            },
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(result.curation.deferred).toEqual([]);
    expect(result.curation.concepts).toHaveLength(1);
    expect(result.curation.concepts[0].memberIds).toEqual(
        nodes.map((node) => node.id).sort(),
    );
    expect(checked).toEqual([
        nodes
            .slice(1)
            .map((node) => node.id)
            .sort(),
    ]);
    expect(result.events).toContainEqual(
        expect.objectContaining({
            stage: "coverage",
            outcome: "jointly-certified-existing-ownership",
        }),
    );
});

test.each(["incidental", "uncertain"] as const)(
    "evidence adjudication does not force admission after %s",
    async (revised) => {
        const { snapshot, window, curation, nodes } = fixture();
        const answer: PreparedTopicReview = async (packets) =>
            packets.map((packet) =>
                Object.fromEntries(
                    Object.keys(packet.request.questions).map((key) => [
                        key,
                        "incidental",
                    ]),
                ),
            );
        const result = await refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                recoverOwnership: true,
                review: answer,
                adjudicateEvidence: async (packets) =>
                    packets.map((packet) =>
                        Object.fromEntries(
                            Object.keys(packet.request.questions).map((key) => [
                                key,
                                revised,
                            ]),
                        ),
                    ),
            }),
        );
        expect(result.curation.concepts).toEqual(curation.concepts);
        if (revised === "incidental") {
            expect(result.outcome).toBe("complete");
            expect(result.curation.deferred).toEqual(curation.deferred);
        } else {
            expect(result.outcome).toBe("needs-review");
            expect(
                result.curation.pending?.map((entry) => entry.nodeId),
            ).toEqual([nodes[3].id]);
            expect(result.curation.deferred).toEqual([]);
        }
    },
);

test("a positive source-role adjudication can recover a previously incidental raw", async () => {
    const { snapshot, window, curation } = fixture();
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            review: async (packets, reason) =>
                reason === "prepared-reference-evidence"
                    ? packets.map((packet) =>
                          Object.fromEntries(
                              Object.keys(packet.request.questions).map(
                                  (key) => [key, "incidental"],
                              ),
                          ),
                      )
                    : positive(packets, reason),
            adjudicateEvidence: positive,
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(result.curation.deferred).toEqual([]);
});

test("uncovered admitted material is authored with required-reference guards", async () => {
    const { snapshot, window, curation, nodes } = fixture();
    let authored = 0;
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            review: async (packets, reason) =>
                reason === "prepared-reference-coverage"
                    ? packets.map((packet) =>
                          Object.fromEntries(
                              Object.keys(packet.request.questions).map(
                                  (key) => [key, "not_covered"],
                              ),
                          ),
                      )
                    : positive(packets, reason),
            complete: async (rules, payload, schema) => {
                authored++;
                expect(rules).toContain(
                    "All supplied original members have already been admitted",
                );
                expect(schema).toMatchObject({
                    schema: { properties: { deferred: { maxItems: 0 } } },
                });
                return generated(payload);
            },
        }),
    );
    expect(authored).toBe(1);
    expect(
        result.curation.concepts.flatMap((concept) => concept.memberIds).sort(),
    ).toEqual(nodes.map((node) => node.id).sort());
});

test("localization moves only the misfit and rechecks the surviving complete membership", async () => {
    const { snapshot, window, curation } = fixture();
    const old = curation.concepts[0];
    const incoming = old.memberIds.filter(
        (id) => !window.current.concepts[0].memberIds.includes(id),
    );
    const outlier = incoming[1];
    const checked: string[][] = [];
    let outlierKey = "";
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            review: async (packets, reason) => {
                expect(reason).not.toBe("prepared-definition-repair-kind");
                const answers = await positive(packets, reason);
                for (const [index, packet] of packets.entries()) {
                    if (packet.fixedDefinitionTargetId !== old.id) continue;
                    checked.push(
                        packet.tasks.map((task) => task.candidate.node.id),
                    );
                    const misfit = packet.tasks.find(
                        (task) => task.candidate.node.id === outlier,
                    );
                    if (misfit) {
                        outlierKey = misfit.candidate.key;
                        answers[index][`fit_${outlierKey}`] =
                            "different_concept";
                    }
                }
                return answers;
            },
            complete: async (_rules, payload, schema) =>
                schema?.name === "memory_local_collection_review"
                    ? localization(payload, (key) =>
                          key === outlierKey ? "different_concept" : "keep",
                      )
                    : generated(payload),
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(checked).toEqual([incoming, [incoming[0]]]);
    expect(
        result.curation.concepts.find((concept) => concept.id === old.id)
            ?.memberIds,
    ).not.toContain(outlier);
    expect(
        result.curation.concepts.filter((concept) =>
            concept.memberIds.includes(outlier),
        ),
    ).toHaveLength(1);
    expect(
        result.curation.concepts.find((concept) => concept.id === old.id)
            ?.purpose,
    ).toBe(old.purpose);
});

test("new metadata repair preserves its exact original partition and leaves priors untouched", async () => {
    const { snapshot, window, concept, nodes } = fixture();
    const current: TopicCuration = {
        concepts: [concept([0]), concept([1, 2])],
        deferred: [{ nodeId: nodes[3].id, reason: "Passing mention" }],
    };
    const authorKinds: Array<string | undefined> = [];
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        current,
        options({
            repairDefinitions: true,
            review: async (packets, reason) => {
                if (reason === "prepared-definition-repair-kind")
                    return packets.map(() => ({
                        repair_kind: "repair_metadata",
                    }));
                const answers = await positive(packets, reason);
                for (const [index, packet] of packets.entries())
                    if (
                        packet.fixedDefinitionTargetId ===
                        current.concepts[1].id
                    )
                        answers[index].coherence = "not_coherent";
                return answers;
            },
            complete: async (_rules, payload, schema, call) => {
                if (schema?.name === "memory_local_collection_review")
                    return localization(payload, () => "different_concept");
                authorKinds.push(call?.kind);
                return generated(payload);
            },
        }),
    );
    expect(result.outcome).toBe("complete");
    expect(authorKinds).toEqual(["metadata"]);
    expect(result.curation.concepts[0]).toEqual(window.current.concepts[0]);
    expect(result.curation.concepts[1].memberIds).toEqual(
        current.concepts[1].memberIds,
    );
    expect(result.curation.concepts[1].label).toBe(
        "Repaired installation approval",
    );
    expect(result.events).toContainEqual(
        expect.objectContaining({
            stage: "authoring",
            outcome: "repaired-fixed-membership-metadata",
        }),
    );
});

test("localization preserves provider inspection and leaves over-capacity members pending without dispatch", async () => {
    const { snapshot, window, curation } = fixture();
    let dispatched = 0;
    const complete: TopicCurationCompletion = Object.assign(
        async () => {
            dispatched++;
            throw new Error("Over-capacity review must not dispatch");
        },
        {
            inspectRequest: () => {
                throw new RequestAdmissionError(
                    "Synthetic local review capacity",
                );
            },
        },
    );
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            review: async (packets) =>
                packets.map((packet) =>
                    Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            key === "coherence"
                                ? "not_coherent"
                                : "different_concept",
                        ]),
                    ),
                ),
            complete,
        }),
    );
    expect(dispatched).toBe(0);
    expect(result.outcome).toBe("needs-review");
    expect(result.curation.pending).toHaveLength(2);
    expect(result.curation.concepts).toEqual(window.current.concepts);
    expect(result.events).toContainEqual(
        expect.objectContaining({
            stage: "localization",
            outcome: "capacity-unresolved",
        }),
    );
});

test("repair-kind capacity is explicit rather than an unexplained uncertain repair", async () => {
    const { snapshot, window, concept, curation } = fixture();
    curation.concepts = [concept([0]), concept([1, 2])];
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            model: {
                ...model,
                checkRequest: (request) => {
                    if ("repair_kind" in request.questions)
                        throw new RequestAdmissionError(
                            "Synthetic repair-kind capacity",
                        );
                },
            },
            review: async (packets) =>
                packets.map((packet) =>
                    Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            key === "coherence"
                                ? "not_coherent"
                                : "different_concept",
                        ]),
                    ),
                ),
            complete: async (_rules, payload) =>
                localization(payload, () => "different_concept"),
        }),
    );
    expect(result.outcome).toBe("needs-review");
    expect(result.events).toContainEqual(
        expect.objectContaining({
            stage: "localization",
            outcome: "repair-kind-capacity-unresolved",
        }),
    );
});

test("repair exhaustion preserves admitted raws as explicit pending, never deferrals", async () => {
    const { snapshot, window, curation, nodes } = fixture();
    let authored = 0;
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            repairDefinitions: true,
            review: async (packets, reason) =>
                reason === "prepared-definition-repair-kind"
                    ? packets.map(() => ({ repair_kind: "split_membership" }))
                    : packets.map((packet) =>
                          Object.fromEntries(
                              Object.keys(packet.request.questions).map(
                                  (key) => [
                                      key,
                                      key === "coherence"
                                          ? "not_coherent"
                                          : "different_concept",
                                  ],
                              ),
                          ),
                      ),
            complete: async (_rules, payload, schema) => {
                if (schema?.name === "memory_local_collection_review")
                    return localization(payload, () => "different_concept");
                authored++;
                return generated(payload);
            },
        }),
    );
    expect(authored).toBe(2);
    expect(result.outcome).toBe("needs-review");
    expect(result.curation.concepts).toEqual(window.current.concepts);
    expect(
        result.curation.pending?.map((entry) => entry.nodeId).sort(),
    ).toEqual(
        nodes
            .slice(1, 3)
            .map((node) => node.id)
            .sort(),
    );
    expect(result.curation.deferred).toEqual(curation.deferred);
});

test("failed authoring preserves a validated progress artifact and propagates the error", async () => {
    const { snapshot, window, curation, nodes } = fixture();
    let saved: TopicCuration | undefined;
    await expect(
        refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                recoverOwnership: true,
                review: async (packets, reason) =>
                    reason === "prepared-reference-coverage"
                        ? packets.map((packet) =>
                              Object.fromEntries(
                                  Object.keys(packet.request.questions).map(
                                      (key) => [key, "not_covered"],
                                  ),
                              ),
                          )
                        : positive(packets, reason),
                complete: async () => {
                    throw new Error("owned authoring failure");
                },
                onProgress: async (progress) => {
                    saved = progress;
                },
            }),
        ),
    ).rejects.toThrow("owned authoring failure");
    expect(saved?.pending?.map((entry) => entry.nodeId)).toEqual([nodes[3].id]);
    expect(saved?.concepts).toEqual(curation.concepts);
    expect(curation.pending).toBeUndefined();
});

test("missing bounded answers fail instead of manufacturing a repair verdict", async () => {
    const { snapshot, window, curation } = fixture();
    await expect(
        refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                repairDefinitions: true,
                review: async (packets) => packets.map(() => ({})),
            }),
        ),
    ).rejects.toThrow("missing a bounded answer");
});

test("coverage partitions retain admitted evidence and never offer deferred outcomes", async () => {
    const { snapshot, window, curation } = fixture();
    await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            review: async (packets, reason) => {
                if (reason === "prepared-reference-coverage") {
                    const task = packets[0].tasks[0];
                    const request = buildTopicDecisionRequest([task]);
                    expect(
                        Object.keys(
                            request.questions.disposition_o0.type === "choice"
                                ? request.questions.disposition_o0.criteria
                                : {},
                        ),
                    ).not.toContain("standalone_new");
                    expect(JSON.stringify(request.questions)).not.toContain(
                        "defer_",
                    );
                    expect(
                        planTopicDecisionChoice(task, [
                            "not_covered",
                            task.targets[0].key,
                        ]),
                    ).toBe(task.targets[0].key);
                }
                return positive(packets, reason);
            },
        }),
    );
});

test("a coverage vote cannot bypass joint membership certification", async () => {
    const { snapshot, window, curation, nodes } = fixture();
    const result = await refinePreparedTopicCuration(
        snapshot,
        window,
        curation,
        options({
            recoverOwnership: true,
            review: async (packets, reason) => {
                const answers = await positive(packets, reason);
                if (reason === "prepared-fixed-root-validation")
                    for (const answer of answers)
                        answer.coherence = "not_coherent";
                return answers;
            },
            complete: async (_rules, payload) => generated(payload),
        }),
    );
    expect(result.curation.concepts[0]).toEqual(curation.concepts[0]);
    expect(result.curation.concepts[1].memberIds).toEqual([nodes[3].id]);
    expect(result.curation.deferred).toEqual([]);
});

test("refinement rejects incomplete captured accounting and edited prior definitions", async () => {
    const { snapshot, window, curation } = fixture();
    await expect(
        refinePreparedTopicCuration(
            snapshot,
            window,
            {
                ...curation,
                deferred: [],
            },
            options(),
        ),
    ).rejects.toThrow("lost original raw accounting");
    const edited = structuredClone(curation);
    edited.concepts[0].purpose = "A broader unrelated purpose";
    await expect(
        refinePreparedTopicCuration(snapshot, window, edited, options()),
    ).rejects.toThrow("changed a read-only prior");
});

test("metadata-only repair cannot merge separate fixed partitions", async () => {
    const { snapshot, window, concept, nodes } = fixture(6);
    const deferred = [{ nodeId: nodes[5].id, reason: "Passing mention" }];
    window.prepared = [
        {
            concepts: [concept([1, 2]), concept([3, 4])],
            deferred,
        },
    ];
    const curation: TopicCuration = {
        concepts: [concept([0]), ...window.prepared[0].concepts],
        deferred,
    };
    await expect(
        refinePreparedTopicCuration(
            snapshot,
            window,
            curation,
            options({
                repairDefinitions: true,
                review: async (packets, reason) =>
                    reason === "prepared-definition-repair-kind"
                        ? packets.map(() => ({
                              repair_kind: "repair_metadata",
                          }))
                        : packets.map((packet) =>
                              Object.fromEntries(
                                  Object.keys(packet.request.questions).map(
                                      (key) => [
                                          key,
                                          key === "coherence"
                                              ? "not_coherent"
                                              : "different_concept",
                                      ],
                                  ),
                              ),
                          ),
                complete: async (_rules, payload, schema) =>
                    schema?.name === "memory_local_collection_review"
                        ? localization(payload, () => "different_concept")
                        : generated(payload, true),
            }),
        ),
    ).rejects.toThrow("changed admitted ownership partitions");
});
