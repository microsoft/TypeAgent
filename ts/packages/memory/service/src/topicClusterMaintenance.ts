// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { TopicCurationCompletion } from "./topicCuration.js";
import {
    buildTopicDecisionState,
    compactTopicDecisionState,
    groundTopicCandidate,
    indexTopicDecisionEvidence,
    topicClusterSignature,
    topicDecisionIdentity,
    type TopicDecisionOptions,
} from "./topicDecision.js";
import {
    reviewTopicCluster,
    type TopicClusterReview,
} from "./topicClusterReview.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "./topicTypes.js";
import { viewHash } from "./viewMerge.js";

export function topicMaintenanceSignature(
    snapshot: TopicSnapshot,
    concept: TopicConcept,
): string {
    return viewHash({
        inputFingerprint: snapshot.inputFingerprint,
        definition: [concept.label, concept.scope, concept.purpose],
        members: [...concept.memberIds].sort(),
    });
}

export function prioritizeTopicMaintenance(
    snapshot: TopicSnapshot,
    concept: TopicConcept,
    suspectMemberIds: string[],
    priority: number,
    reason: string,
): void {
    const prior = concept.maintenance;
    concept.maintenance = {
        signature: topicMaintenanceSignature(snapshot, concept),
        priority: Math.max(prior?.priority ?? 0, priority),
        reasons: [...new Set([reason, ...(prior?.reasons ?? [])])].slice(0, 16),
        suspectMemberIds: [
            ...new Set([
                ...(prior?.suspectMemberIds ?? []),
                ...suspectMemberIds,
            ]),
        ].filter((id) => concept.memberIds.includes(id)),
    };
}

export function validateTopicMaintenance(
    snapshot: TopicSnapshot,
    concept: TopicConcept,
): void {
    const signal = concept.maintenance;
    if (!signal) return;
    if (
        signal.signature !== topicMaintenanceSignature(snapshot, concept) ||
        !Number.isFinite(signal.priority) ||
        signal.priority < 0 ||
        signal.priority > 1 ||
        !signal.reasons.length ||
        signal.reasons.length > 16 ||
        signal.reasons.some(
            (reason) => !reason.trim() || reason.length > 2000,
        ) ||
        new Set(signal.suspectMemberIds).size !==
            signal.suspectMemberIds.length ||
        signal.suspectMemberIds.some((id) => !concept.memberIds.includes(id))
    )
        throw new Error("Invalid or stale topic maintenance signal");
}

export function certifyTopicMembers(
    snapshot: TopicSnapshot,
    concept: TopicConcept,
    options: TopicDecisionOptions,
    memberIds: string[],
    method: "decision" | "generative",
    scores?: Array<{ nodeId: string; score: number }>,
    score?: number,
): void {
    concept.validation = {
        recipe: "cluster-local-v1",
        coverage: "member-admission-v2",
        method,
        validatedMemberIds: [...memberIds].sort(),
        signature: "",
        modelIdentity: topicDecisionIdentity(
            options.model,
            options.packetPolicy,
            options,
        ),
        inputFingerprint: snapshot.inputFingerprint,
        ...(scores ? { memberScores: scores } : {}),
        ...(score !== undefined ? { score } : {}),
    };
    concept.validation.signature = topicClusterSignature(
        snapshot,
        concept,
        concept.validation.modelIdentity,
    );
    if (concept.maintenance)
        concept.maintenance.signature = topicMaintenanceSignature(
            snapshot,
            concept,
        );
}

function maintenanceState(snapshot: TopicSnapshot, concept: TopicConcept) {
    const contexts = indexTopicDecisionEvidence(snapshot);
    const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const members = concept.memberIds.map((id, index) => {
        const node = nodes.get(id);
        if (!node) throw new Error("Maintenance lost original topic evidence");
        return groundTopicCandidate(
            snapshot,
            node,
            node.citations,
            `m${index}`,
            contexts,
        );
    });
    const state = buildTopicDecisionState(
        members.map((candidate) => ({ candidate, targets: [], score: false })),
    );
    compactTopicDecisionState(state);
    state.cluster = {
        phase: "maintenance",
        definition: {
            label: concept.label,
            scope: concept.scope,
            purpose: concept.purpose,
        },
        members: members.map((member) => member.key),
    };
    return { state, members, nodes };
}

export async function maintainTopicClusters(
    snapshot: TopicSnapshot,
    curation: TopicCuration,
    complete: TopicCurationCompletion,
    signal: AbortSignal,
    options: TopicDecisionOptions,
    checkpoint?: (curation: TopicCuration) => Promise<void>,
): Promise<TopicCuration> {
    let result = structuredClone(curation);
    const queue = result.concepts
        .filter((concept) => concept.maintenance)
        .sort(
            (a, b) =>
                b.maintenance!.priority - a.maintenance!.priority ||
                a.id.localeCompare(b.id),
        );
    for (const original of queue) {
        signal.throwIfAborted();
        validateTopicMaintenance(snapshot, original);
        const { state, members, nodes } = maintenanceState(snapshot, original);
        const review = await reviewTopicCluster(
            state,
            members.map((member) => member.key),
            null,
            complete,
            signal,
            options,
        );
        const staged = structuredClone(result);
        const concept = staged.concepts.find(
            (entry) => entry.id === original.id,
        )!;
        if (!review) {
            prioritizeTopicMaintenance(
                snapshot,
                concept,
                concept.maintenance!.suspectMemberIds,
                concept.maintenance!.priority,
                "Complete maintenance evidence exceeds local review context budget",
            );
        } else
            applyMaintenanceReview(
                snapshot,
                staged,
                concept,
                { state, members, nodes },
                review,
                options,
            );
        signal.throwIfAborted();
        if (checkpoint) await checkpoint(staged);
        result = staged;
    }
    return result;
}

function applyMaintenanceReview(
    snapshot: TopicSnapshot,
    staged: TopicCuration,
    concept: TopicConcept,
    { members, nodes }: ReturnType<typeof maintenanceState>,
    review: TopicClusterReview,
    options: TopicDecisionOptions,
) {
    const removed = members.filter(
        (member) => review.choices.get(member.key) === "different_concept",
    );
    const unresolved = members.filter(
        (member) =>
            !removed.includes(member) &&
            (review.choices.get(member.key) === "uncertain" ||
                review.conflicts.includes(member.key)),
    );
    concept.memberIds = concept.memberIds.filter(
        (id) => !removed.some((member) => member.node.id === id),
    );
    staged.pending = [
        ...(staged.pending ?? []),
        ...removed.map((member) => ({
            nodeId: member.node.id,
            candidateTargetIds: concept.memberIds.length ? [concept.id] : [],
            reason: "View maintenance rejected collection membership; reassignment remains unresolved",
        })),
    ];
    if (!staged.pending.length) delete staged.pending;
    if (concept.memberIds.length) {
        concept.citations = [
            ...new Map(
                concept.memberIds.flatMap((id) =>
                    nodes
                        .get(id)!
                        .citations.map(
                            (citation) =>
                                [viewHash(citation), citation] as const,
                        ),
                ),
            ).values(),
        ];
        concept.summary = "";
        concept.summaryState = "pending";
        delete concept.summaryCitations;
        delete concept.validation;
        delete concept.maintenance;
        if (unresolved.length || review.joint !== "compatible")
            prioritizeTopicMaintenance(
                snapshot,
                concept,
                unresolved.map((member) => member.node.id),
                Math.max(
                    unresolved.length / concept.memberIds.length,
                    review.joint === "compatible" ? 0 : 1,
                ),
                `Unresolved maintenance review: ${review.rationale}`.slice(
                    0,
                    2000,
                ),
            );
        const checked = members.filter(
            (member) =>
                concept.memberIds.includes(member.node.id) &&
                !unresolved.includes(member) &&
                review.choices.get(member.key) === "keep",
        );
        if (checked.length)
            certifyTopicMembers(
                snapshot,
                concept,
                options,
                checked.map((member) => member.node.id),
                "generative",
            );
    } else
        staged.concepts = staged.concepts.filter(
            (entry) => entry.id !== concept.id,
        );
}
