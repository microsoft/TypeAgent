// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import { initialTopicNodes } from "../src/topicSnapshot.js";
import { viewHash } from "../src/viewMerge.js";
import {
    buildTopicDecisionRequest,
    planTopicDecisionChoice,
} from "../src/topicDecision.js";
import {
    curateTopics,
    type TopicCurationCompletion,
} from "../src/topicCuration.js";
import {
    prepareTopicDecisionGroups,
    reconcilePreparedTopicChoices,
    type PreparedTopicFallback,
} from "../src/topicPreparedDecision.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "../src/topicTypes.js";
import type { PreparedTopicWindow } from "../src/topicFrozenPreparation.js";
import {
    reviewPreparedTopicChoices,
    reconcileGeneratedPreparedTopics,
    type PreparedTopicReview,
} from "../src/topicPreparedDecisionReview.js";
import type { DecisionModel } from "@typeagent/aiclient";

const reviewModel: DecisionModel = {
    provider: "azure",
    model: "offline",
    providerSource: "factory",
    configGeneration: 1,
    decide: async () => {
        throw new Error("Offline review must not dispatch");
    },
};

const positiveReview: PreparedTopicReview = async (packets, reason) =>
    packets.map((packet) =>
        Object.fromEntries(
            Object.keys(packet.request.questions).map((key) => [
                key,
                reason === "prepared-raw-usefulness"
                    ? "useful_reference"
                    : reason === "prepared-generated-equivalence"
                      ? "retain_admitted"
                      : key === "coherence"
                        ? "coherent"
                        : "keep",
            ]),
        ),
    );

function generatedReconciler(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    review: PreparedTopicReview = positiveReview,
) {
    return async (priors: TopicConcept[], generated: TopicCuration) =>
        (
            await reconcileGeneratedPreparedTopics(
                snapshot,
                window,
                priors,
                generated,
                { model: reviewModel },
                review,
            )
        ).curation;
}

function fixture(count = 4) {
    const occurrences = Array.from({ length: count }, (_, ordinal) =>
        indexedTopicOccurrence(
            {
                sourceId: `source-${ordinal}`,
                revisionId: "r1",
                blockOrdinal: 0,
                text: "The service requires explicit installation approval.",
                score: 1,
            },
            "Installation approval",
            0,
        ),
    );
    const nodes = initialTopicNodes("prepared", occurrences);
    const snapshot: TopicSnapshot = {
        schemaVersion: 1,
        corpusId: "prepared",
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
    const concept = (ids: number[]): TopicConcept => {
        const memberIds = ids.map((index) => nodes[index].id).sort();
        return {
            id: `concept:${viewHash(["prepared", "Installation approval", "Service", memberIds[0]]).slice(0, 32)}`,
            label: "Installation approval",
            scope: "Service",
            purpose: "Explain the installation approval requirement",
            memberIds,
            citations: ids.flatMap((index) => nodes[index].citations),
            summary: "",
            summaryState: "pending",
            salience: 5,
        };
    };
    const window: PreparedTopicWindow = {
        current: { concepts: [concept([0])], deferred: [] },
        prepared: [
            {
                concepts: [concept([1, 2])],
                deferred: [{ nodeId: nodes[3].id, reason: "Needs context" }],
            },
        ],
    };
    return { snapshot, nodes, window, concept };
}

const noAuthoring: TopicCurationCompletion = async () => {
    throw new Error("Unexpected generative authoring");
};

test("prepared reconciliation rejects omitted groups rather than validating a partial subset as complete", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window).slice(0, 1);
    await expect(
        reconcilePreparedTopicChoices(
            snapshot,
            window,
            groups,
            new Map([["g0", "standalone_new"]]),
            noAuthoring,
            new AbortController().signal,
        ),
    ).rejects.toThrow("complete window membership");
});

test("raw reference usefulness is independent of adoption and group disposition", async () => {
    const { snapshot, window, nodes } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const selected = new Map(
        groups.map((group) => [
            group.task.candidate.key,
            "defer_unadopted_assistant_suggestion",
        ]),
    );
    const original = structuredClone(groups);
    const guarded = await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        selected,
        { model: reviewModel },
        async (packets, reason) => {
            expect(reason).toBe("prepared-raw-usefulness");
            for (const packet of packets)
                for (const question of Object.values(
                    packet.request.questions,
                )) {
                    expect(question.instructions).toContain(
                        "independent of user adoption",
                    );
                    expect(
                        Object.keys(
                            question.type === "choice" ? question.criteria : {},
                        ),
                    ).toEqual(["useful_reference", "incidental", "uncertain"]);
                }
            return positiveReview(packets, reason);
        },
    );
    expect([...guarded.choices.values()]).toEqual([
        "uncertain_needs_synthesis",
        "uncertain_needs_synthesis",
    ]);
    expect([...guarded.usefulRawIds].sort()).toEqual(
        nodes
            .slice(1)
            .map((node) => node.id)
            .sort(),
    );
    expect(groups).toEqual(original);
});

test("whole original-member validation rejects incompatible prepared definitions", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const guarded = await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "standalone_new"],
            ["g1", "defer_passing_mention"],
        ]),
        { model: reviewModel },
        async (packets, reason) => {
            const answers = await positiveReview(packets, reason);
            if (reason === "prepared-fixed-root-validation")
                for (const answer of answers)
                    answer.fit_m0 = "different_concept";
            return answers;
        },
    );
    expect(guarded.choices.get("g0")).toBe("uncertain_needs_synthesis");
    expect(guarded.certifications[0].certified).toBe(false);
});

test("separate incoming groups targeting the same existing root receive one joint certification", async () => {
    const { snapshot, window, nodes, concept } = fixture();
    window.prepared[0].concepts = [concept([1]), concept([2])];
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const selected = new Map(
        groups.map((group, index) => [
            group.task.candidate.key,
            index < 2
                ? group.task.targets.find(
                      (target) =>
                          target.concept?.id === window.current.concepts[0].id,
                  )!.key
                : "standalone_new",
        ]),
    );
    const guarded = await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        selected,
        { model: reviewModel },
        async (packets, reason) => {
            if (reason === "prepared-fixed-root-validation") {
                expect(packets).toHaveLength(1);
                expect(
                    packets[0].tasks
                        .map((task) => task.candidate.node.id)
                        .sort(),
                ).toEqual([nodes[1].id, nodes[2].id].sort());
                expect(packets[0].request.questions.coherence).toBeDefined();
            }
            return positiveReview(packets, reason);
        },
    );
    expect(guarded.certifications[0].candidateKeys).toEqual(["g0", "g1"]);
});

test("negative raw usefulness receives bounded adjudication without repeating positive raw work", async () => {
    const { snapshot, window, nodes } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const guarded = await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "standalone_new"],
            ["g1", "defer_passing_mention"],
        ]),
        { model: reviewModel },
        async (packets, reason) => {
            const answers = await positiveReview(packets, reason);
            if (reason === "prepared-raw-usefulness")
                for (const [index, packet] of packets.entries())
                    for (const task of packet.tasks)
                        if (task.candidate.node.id === nodes[3].id)
                            answers[index][`usefulness_${task.candidate.key}`] =
                                "incidental";
            return answers;
        },
        async (packets, reason) => {
            expect(
                packets.flatMap((packet) =>
                    packet.tasks.map((task) => task.candidate.node.id),
                ),
            ).toEqual([nodes[3].id]);
            return positiveReview(packets, reason);
        },
    );
    expect(guarded.usefulnessReviews.primary[nodes[3].id]).toBe("incidental");
    expect(guarded.usefulnessReviews.adjudication[nodes[3].id]).toBe(
        "useful_reference",
    );
    expect(guarded.usefulness[nodes[3].id]).toBe("useful_reference");
    expect(guarded.choices.get("g1")).toBe("uncertain_needs_synthesis");
    expect(guarded.usefulRawIds.has(nodes[3].id)).toBe(true);
});

test("unchanged read-only priors retain audited summaries through generative resolution", async () => {
    const { snapshot, window } = fixture();
    const prior = window.current.concepts[0];
    prior.summary = "Audited installation approval requirement.";
    prior.summaryState = "ready";
    prior.summaryCitations = [...prior.citations];
    const original = structuredClone(prior);
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "uncertain_needs_synthesis"],
            ["g1", "defer_passing_mention"],
        ]),
        author,
        new AbortController().signal,
        undefined,
        undefined,
        generatedReconciler(snapshot, window),
    );
    expect(
        result.concepts.find((concept) => concept.id === original.id),
    ).toEqual(original);
});

test("fixed-root admission validates editable original evidence without repeating old-anchor evidence", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const root = groups[0].task.targets.find(
        (target) => target.concept?.id === window.current.concepts[0].id,
    )!;
    await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", root.key],
            ["g1", "standalone_new"],
        ]),
        { model: reviewModel },
        async (packets, reason) => {
            if (reason === "prepared-fixed-root-validation") {
                expect(packets).toHaveLength(1);
                expect(packets[0].tasks).toHaveLength(2);
                expect(JSON.stringify(packets[0].request.state)).not.toContain(
                    "source-0",
                );
                expect(JSON.stringify(packets[0].request.state)).toContain(
                    "Explain the installation approval requirement",
                );
            }
            return positiveReview(packets, reason);
        },
    );
});

test("mutual prepared selections install only after joint original-root certification", async () => {
    const { snapshot, window, concept } = fixture();
    window.prepared[0].concepts = [concept([1]), concept([2])];
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const target = (from: number, to: number) =>
        groups[from].task.targets.find(
            (target) => target.concept?.id === groups[to].concept?.id,
        )!.key;
    const guarded = await reviewPreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", target(0, 1)],
            ["g1", target(1, 0)],
            ["g2", "standalone_new"],
        ]),
        { model: reviewModel },
        positiveReview,
    );
    expect(guarded.certifications).toHaveLength(1);
    expect(guarded.certifications[0].certified).toBe(true);
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        guarded.groups,
        guarded.choices,
        author,
        new AbortController().signal,
        undefined,
        guarded.usefulRawIds,
    );
    expect(result.concepts).toHaveLength(3);
    expect(
        result.concepts.some((concept) => concept.memberIds.length === 2),
    ).toBe(true);
});

test("missing semantic-review answers fail explicitly rather than certifying an empty result", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    await expect(
        reviewPreparedTopicChoices(
            snapshot,
            window,
            groups,
            new Map(),
            { model: reviewModel },
            async (packets) => packets.map(() => ({})),
        ),
    ).rejects.toThrow("missing a bounded answer");
});

test("unresolved prepared groups are split into original raws and useful raws cannot be deferred", async () => {
    const { snapshot, window, nodes } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const sizes: number[] = [];
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "uncertain_needs_synthesis"],
            ["g1", "defer_passing_mention"],
        ]),
        async (...args) => {
            const data = args[1] as {
                nodes: Array<{ referenceRequired?: boolean }>;
            };
            expect(data.nodes).toHaveLength(2);
            expect(args[2]).toMatchObject({
                schema: { properties: { deferred: { maxItems: 0 } } },
            });
            sizes.push(
                data.nodes.filter((node) => node.referenceRequired).length,
            );
            return author(...args);
        },
        new AbortController().signal,
        undefined,
        new Set(window.prepared[0].concepts[0].memberIds),
        generatedReconciler(snapshot, window),
    );
    expect(sizes).toEqual([2]);
    expect(
        result.concepts.flatMap((concept) => concept.memberIds).sort(),
    ).toEqual(
        nodes
            .slice(0, 3)
            .map((node) => node.id)
            .sort(),
    );
    expect(result.concepts).toHaveLength(3);
});

test("metadata generation cannot reverse certified admission and repairs a rejected deferral", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const kinds: string[] = [];
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "standalone_new"],
            ["g1", "standalone_new"],
        ]),
        async (...args) => {
            kinds.push(args[3]!.kind);
            if (kinds.length > 1) return author(...args);
            const data = args[1] as { nodes: Array<{ id: string }> };
            return {
                concepts: [],
                deferred: data.nodes.map((node) => ({
                    nodeId: node.id,
                    reason: "Not adopted",
                })),
            };
        },
        new AbortController().signal,
    );
    expect(kinds).toEqual(["metadata", "contract-repair"]);
    expect(result.deferred).toHaveLength(0);
});

test("persistent metadata admission reversal fails the window after bounded repair", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    let calls = 0;
    await expect(
        reconcilePreparedTopicChoices(
            snapshot,
            window,
            groups,
            new Map([
                ["g0", "standalone_new"],
                ["g1", "standalone_new"],
            ]),
            async (_rules, payload) => {
                calls++;
                const data = payload as { nodes: Array<{ id: string }> };
                return {
                    concepts: [],
                    deferred: data.nodes.map((node) => ({
                        nodeId: node.id,
                        reason: "Not adopted",
                    })),
                };
            },
            new AbortController().signal,
        ),
    ).rejects.toThrow("independently required reference");
    expect(calls).toBe(2);
});

test("attachments preserve the maximum prepared salience and invalidate prior summaries", async () => {
    const { snapshot, window } = fixture();
    window.current.concepts[0].summary =
        "Installation requires explicit approval.";
    window.current.concepts[0].summaryState = "ready";
    window.current.concepts[0].summaryCitations = [
        ...window.current.concepts[0].citations,
    ];
    window.prepared[0].concepts[0].salience = 7;
    const original = structuredClone(window);
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const root = groups[0].task.targets.find(
        (target) => target.concept?.id === window.current.concepts[0].id,
    )!;
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", root.key],
            ["g1", root.key],
        ]),
        noAuthoring,
        new AbortController().signal,
    );
    expect(result.concepts[0].salience).toBe(7);
    expect(result.concepts[0].summary).toBe("");
    expect(result.concepts[0].summaryState).toBe("pending");
    expect(result.concepts[0].summaryCitations).toBeUndefined();
    expect(window).toEqual(original);
});

const author: TopicCurationCompletion = async (_rules, payload) => {
    const data = payload as {
        nodes: Array<{
            id: string;
            label: string;
            scope: string;
            purpose?: string;
            evidenceIds: string[];
        }>;
    };
    return {
        concepts: data.nodes.map((node) => ({
            label: node.label,
            scope: node.scope,
            purpose: node.purpose ?? "Explain installation approval",
            memberIds: [node.id],
            evidenceIds: node.evidenceIds,
            salience: 5,
        })),
        deferred: [],
    };
};

test("prepared tasks preserve entire groups, original roles and immutable metadata", () => {
    const { snapshot, window } = fixture();
    const original = structuredClone(window);
    const groups = prepareTopicDecisionGroups(snapshot, window);
    expect(groups.map((group) => group.memberIds.length)).toEqual([2, 1]);
    expect(
        groups[0].task.targets.some(
            (target) => target.concept?.id === groups[0].concept?.id,
        ),
    ).toBe(false);
    expect(groups[0].task.candidate.complete).toBe(true);
    const request = buildTopicDecisionRequest(
        groups.map((group) => group.task),
        "factored-best-fit",
    );
    expect(request.questions.disposition_g0.instructions).toContain(
        "not a test that all raw labels are synonyms",
    );
    expect(request.questions.disposition_g0.instructions).toContain(
        "Substantive assistant explanations",
    );
    expect(JSON.stringify(request.state)).toContain("rawMembers");
    expect(JSON.stringify(request.state)).toContain("Installation approval");
    expect(request.state).toMatchObject({
        candidates: { g0: { purpose: groups[0].concept!.purpose } },
    });
    expect(window).toEqual(original);
});

test("prepared groups retain all 24 external nomination slots after self-exclusion", () => {
    const { snapshot, window, concept } = fixture(30);
    window.current.concepts.push(
        ...Array.from({ length: 26 }, (_, ordinal) => concept([ordinal + 4])),
    );
    const groups = prepareTopicDecisionGroups(snapshot, window);
    expect(groups[0].task.targets).toHaveLength(24);
    expect(
        groups[0].task.targets.some(
            (target) => target.concept?.id === groups[0].concept?.id,
        ),
    ).toBe(false);
});

test("direct fixed-root attachment expands raw membership without changing the original window", async () => {
    const { snapshot, window, nodes } = fixture();
    const original = structuredClone(window);
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const target = groups[0].task.targets.find(
        (target) => target.concept?.id === window.current.concepts[0].id,
    )!;
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", target.key],
            ["g1", "defer_incidental_noun_or_tag"],
        ]),
        noAuthoring,
        new AbortController().signal,
    );
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].memberIds).toEqual(
        nodes
            .slice(0, 3)
            .map((node) => node.id)
            .sort(),
    );
    expect(result.concepts[0].id).toBe(window.current.concepts[0].id);
    expect(result.deferred.map((entry) => entry.nodeId)).toEqual([nodes[3].id]);
    expect(window).toEqual(original);
});

test("existing prepared metadata is reused; newly admitted raw evidence receives explicit authoring", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const events: PreparedTopicFallback[] = [];
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "standalone_new"],
            ["g1", "standalone_new"],
        ]),
        author,
        new AbortController().signal,
        (event) => events.push(event),
    );
    expect(result.concepts).toHaveLength(3);
    expect(events).toEqual([
        expect.objectContaining({ kind: "metadata", members: 1, targets: 0 }),
    ]);
    expect(
        result.concepts.some((concept) => concept.id === groups[0].concept?.id),
    ).toBe(true);
});

test("mutually selected prepared groups require local resolution rather than transitive installation", async () => {
    const { snapshot, window, concept } = fixture();
    window.prepared[0].concepts = [concept([1]), concept([2])];
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const target = (from: number, to: number) =>
        groups[from].task.targets.find(
            (target) => target.concept?.id === groups[to].concept?.id,
        )!.key;
    const events: PreparedTopicFallback[] = [];
    let calls = 0;
    const completion: TopicCurationCompletion = async (...args) => {
        calls++;
        return author(...args);
    };
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", target(0, 1)],
            ["g1", target(1, 0)],
            ["g2", "defer_passing_mention"],
        ]),
        completion,
        new AbortController().signal,
        (event) => events.push(event),
        undefined,
        generatedReconciler(snapshot, window),
    );
    expect(events).toHaveLength(2);
    expect(calls).toBe(1);
    expect(events.every((event) => event.kind === "resolution")).toBe(true);
    expect(events.every((event) => event.reason.includes("transitive"))).toBe(
        true,
    );
    const assigned = [
        ...result.concepts.flatMap((concept) => concept.memberIds),
        ...result.deferred.map((entry) => entry.nodeId),
    ];
    expect(new Set(assigned).size).toBe(snapshot.nodes.length);
});

test("raw-only resolution never exposes read-only priors to generative editing", async () => {
    const { snapshot, window } = fixture();
    window.current.concepts[0].summary = "Previously validated summary";
    window.current.concepts[0].summaryState = "ready";
    const prior = structuredClone(window.current.concepts[0]);
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map([
            ["g0", "uncertain_needs_synthesis"],
            ["g1", "defer_passing_mention"],
        ]),
        async (...args) => {
            const data = args[1] as {
                nodes: Array<{ role: string; memberIds: string[] }>;
            };
            expect(data.nodes.every((node) => node.role === "new")).toBe(true);
            expect(JSON.stringify(data)).not.toContain(prior.id);
            return author(...args);
        },
        new AbortController().signal,
        undefined,
        undefined,
        generatedReconciler(snapshot, window),
    );
    expect(result.concepts.find((concept) => concept.id === prior.id)).toEqual(
        prior,
    );
});

test("generated equivalence cannot reconsider admission or claim global novelty", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(
        snapshot,
        window,
        window.current.concepts,
    );
    const task = { ...groups[0].task, equivalenceOnly: true };
    const request = buildTopicDecisionRequest([task]);
    const question = request.questions.disposition_g0;
    expect(question.type).toBe("choice");
    if (question.type !== "choice") throw new Error("Missing choice");
    expect(Object.keys(question.criteria)).toEqual([
        "retain_admitted",
        "uncertain_needs_synthesis",
        ...task.targets.map((target) => target.key),
    ]);
    expect(question.criteria.retain_admitted).toContain(
        "does not certify global novelty",
    );
    expect(
        planTopicDecisionChoice(task, ["retain_admitted", task.targets[0].key]),
    ).toBe(task.targets[0].key);
});

test("generated groups sharing a prior require joint fit certification before host attachment", async () => {
    const { snapshot, window, concept } = fixture();
    const generated = {
        concepts: [concept([1]), concept([2])],
        deferred: [],
    };
    const original = structuredClone({
        priors: window.current.concepts,
        generated,
    });
    const execute = async (coherent: boolean) =>
        reconcileGeneratedPreparedTopics(
            snapshot,
            window,
            window.current.concepts,
            generated,
            { model: reviewModel },
            async (packets, reason) => {
                if (reason === "prepared-generated-equivalence")
                    return packets.map((packet) =>
                        Object.fromEntries(
                            Object.entries(packet.request.questions).map(
                                ([key, question]) => [
                                    key,
                                    question.type === "choice"
                                        ? Object.keys(question.criteria).find(
                                              (choice) =>
                                                  choice.startsWith("t"),
                                          )!
                                        : "",
                                ],
                            ),
                        ),
                    );
                expect(packets).toHaveLength(1);
                expect(packets[0].tasks).toHaveLength(2);
                expect(JSON.stringify(packets[0].request.state)).not.toContain(
                    "source-0",
                );
                const answers = await positiveReview(packets, reason);
                if (!coherent) answers[0].coherence = "uncertain";
                return answers;
            },
        );
    const rejected = await execute(false);
    expect(rejected.curation.concepts).toHaveLength(3);
    expect(rejected.review.retainedAdmittedIds).toHaveLength(2);
    expect(rejected.review.certifications[0].certified).toBe(false);
    const accepted = await execute(true);
    expect(accepted.curation.concepts).toHaveLength(1);
    expect(accepted.curation.concepts[0].memberIds).toHaveLength(3);
    expect(accepted.curation.concepts[0].id).toBe(
        window.current.concepts[0].id,
    );
    expect(accepted.review.retainedAdmittedIds).toHaveLength(0);
    expect({ priors: window.current.concepts, generated }).toEqual(original);
});

test("generated-root certification includes editable members attached earlier in the same window", async () => {
    const { snapshot, window, concept } = fixture();
    const prior = concept([0, 1]);
    const generated = { concepts: [concept([2])], deferred: [] };
    const result = await reconcileGeneratedPreparedTopics(
        snapshot,
        window,
        [prior],
        generated,
        { model: reviewModel },
        async (packets, reason) => {
            if (reason === "prepared-generated-equivalence")
                return packets.map((packet) =>
                    Object.fromEntries(
                        Object.keys(packet.request.questions).map((key) => [
                            key,
                            "t0",
                        ]),
                    ),
                );
            expect(packets).toHaveLength(1);
            expect(
                packets[0].tasks.map((task) => task.candidate.node.id).sort(),
            ).toEqual(
                snapshot.nodes
                    .slice(1, 3)
                    .map((node) => node.id)
                    .sort(),
            );
            expect(JSON.stringify(packets[0].request.state)).not.toContain(
                "source-0",
            );
            const answers = await positiveReview(packets, reason);
            answers[0].coherence = "not_coherent";
            return answers;
        },
    );
    expect(result.review.certifications[0].certified).toBe(false);
    expect(result.curation.concepts).toEqual([prior, ...generated.concepts]);
});

test("missing metadata is batched without merging independently selected standalone raws", async () => {
    const { snapshot, window, nodes } = fixture(5);
    window.prepared[0].deferred.push({
        nodeId: nodes[4].id,
        reason: "Needs context",
    });
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const calls: Parameters<TopicCurationCompletion>[] = [];
    const completion: TopicCurationCompletion = async (...args) => {
        calls.push(args);
        return author(...args);
    };
    const result = await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map(
            groups.map((group) => [group.task.candidate.key, "standalone_new"]),
        ),
        completion,
        new AbortController().signal,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("never merge distinct supplied candidates");
    expect(result.concepts).toHaveLength(4);
    expect(
        result.concepts.filter((concept) => concept.memberIds.length === 1),
    ).toHaveLength(3);
});

test("metadata generation cannot silently merge independently selected standalone partitions", async () => {
    const { snapshot, window, nodes } = fixture(5);
    window.prepared[0].deferred.push({
        nodeId: nodes[4].id,
        reason: "Needs context",
    });
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const merge: TopicCurationCompletion = async (_rules, payload) => {
        const data = payload as {
            nodes: Array<{ id: string; evidenceIds: string[] }>;
        };
        return {
            concepts: [
                {
                    label: "Installation approval",
                    scope: "Service",
                    purpose: "Explain installation approval",
                    salience: 5,
                    memberIds: data.nodes.map((node) => node.id),
                    evidenceIds: [
                        ...new Set(
                            data.nodes.flatMap((node) => node.evidenceIds),
                        ),
                    ],
                },
            ],
            deferred: [],
        };
    };
    await expect(
        reconcilePreparedTopicChoices(
            snapshot,
            window,
            groups,
            new Map(
                groups.map((group) => [
                    group.task.candidate.key,
                    "standalone_new",
                ]),
            ),
            merge,
            new AbortController().signal,
        ),
    ).rejects.toThrow("changed standalone partitions");
});

test("fallback accounting preserves omission repair calls instead of relabeling them as metadata", async () => {
    const { snapshot, window } = fixture();
    const groups = prepareTopicDecisionGroups(snapshot, window);
    const kinds: string[] = [];
    const completion: TopicCurationCompletion = async (...args) => {
        kinds.push(args[3]!.kind);
        if (kinds.length === 1) return { concepts: [], deferred: [] };
        return author(...args);
    };
    await reconcilePreparedTopicChoices(
        snapshot,
        window,
        groups,
        new Map(
            groups.map((group) => [group.task.candidate.key, "standalone_new"]),
        ),
        completion,
        new AbortController().signal,
    );
    expect(kinds).toEqual(["metadata", "omission-repair"]);
});

test("frozen replacement retains preparation, commits only validated windows and rejects generative replay", async () => {
    const { snapshot } = fixture(30);
    let calls = 0,
        reconciliations = 0;
    const completion: TopicCurationCompletion = async (...args) => {
        calls++;
        return author(...args);
    };
    const options = {
        preparedReconciliation: {
            recipe: "test-prepared-identity",
            reconcile: async (window: PreparedTopicWindow) => {
                reconciliations++;
                return {
                    concepts: [
                        ...window.current.concepts,
                        ...window.prepared.flatMap((part) => part.concepts),
                    ],
                    deferred: [
                        ...window.current.deferred,
                        ...window.prepared.flatMap((part) => part.deferred),
                    ],
                };
            },
        },
    };
    const result = await curateTopics(
        snapshot,
        (node) => node.citations,
        completion,
        new AbortController().signal,
        true,
        undefined,
        undefined,
        options,
    );
    expect(calls).toBe(2);
    expect(reconciliations).toBe(1);
    expect(
        result.concepts.flatMap((concept) => concept.memberIds),
    ).toHaveLength(30);
    expect(snapshot.recipe).toBe("test");
    await expect(
        curateTopics(
            snapshot,
            (node) => node.citations,
            noAuthoring,
            new AbortController().signal,
            true,
            undefined,
            undefined,
            {
                ...options,
                replayPackets: [],
            },
        ),
    ).rejects.toThrow("cannot reuse generative packet receipts");
});
