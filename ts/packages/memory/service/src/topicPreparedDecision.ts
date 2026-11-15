// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createTopicConceptGrounder,
    groundTopicCandidate,
    groundTopicConcept,
    indexTopicDecisionEvidence,
    topicDispositionCriteria,
    type TopicDecisionTask,
} from "./topicDecision.js";
import {
    curateTopicEvidence,
    validateTopicCurationProgress,
    type TopicCurationCandidate,
    type TopicCurationCompletion,
} from "./topicCuration.js";
import { TopicConceptIndex, TopicEvidenceIndex } from "./topicLookup.js";
import type { PreparedTopicWindow } from "./topicFrozenPreparation.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "./topicTypes.js";
import { viewHash } from "./viewMerge.js";

export const preparedTopicDecisionRecipe = "prepared-group-decision-v6";

export interface PreparedTopicDecisionGroup {
    task: TopicDecisionTask;
    memberIds: string[];
    concept?: TopicConcept;
}

export interface PreparedTopicFallback {
    candidateId: string;
    members: number;
    targets: number;
    kind: "metadata" | "resolution";
    reason: string;
}

function requireResolvedPreparedWindow(window: PreparedTopicWindow): void {
    if (
        [window.current, ...window.prepared].some(
            (part) => part.pending?.length,
        )
    )
        throw new Error(
            "Prepared topic reconciliation requires resolved priors",
        );
}

export function prepareTopicDecisionGroups(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    nominationConcepts?: TopicConcept[],
): PreparedTopicDecisionGroup[] {
    requireResolvedPreparedWindow(window);
    const concepts = [
        ...window.current.concepts,
        ...window.prepared.flatMap((part) => part.concepts),
    ];
    validateTopicCurationProgress({
        ...snapshot,
        curationProgress: {
            concepts,
            deferred: [
                ...window.current.deferred,
                ...window.prepared.flatMap((part) => part.deferred),
            ],
        },
    });
    const index = new TopicEvidenceIndex(snapshot);
    const contexts = indexTopicDecisionEvidence(snapshot);
    const ground = createTopicConceptGrounder(snapshot, contexts, index);
    const nominatedConcepts = nominationConcepts ?? concepts;
    const nominations = new TopicConceptIndex(nominatedConcepts);
    const positions = new Map(
        nominatedConcepts.map((concept, ordinal) => [concept.id, ordinal]),
    );
    const raw = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const groups = window.prepared.flatMap((part) => [
        ...part.concepts.map((concept) => {
            const members = index.members(concept.memberIds);
            const target = groundTopicConcept(
                snapshot,
                concept,
                "group",
                contexts,
                index,
            );
            const node = {
                ...members[0],
                id: concept.id,
                identity: viewHash([concept.id, concept.memberIds]),
                label: concept.label,
                scope: concept.scope,
                aliases: [],
                occurrenceIds: members.flatMap(
                    (member) => member.occurrenceIds,
                ),
                citations: members.flatMap((member) => member.citations),
                summary: "",
                summaryState: "pending" as const,
            };
            const candidate = groundTopicCandidate(
                snapshot,
                node,
                concept.citations,
                "group",
                contexts,
            );
            candidate.complete = target.complete === true;
            candidate.grounding = {
                ...target.grounding,
                prepared: true,
                rawMembers: members.map((member) => ({
                    id: member.id,
                    label: member.label,
                    scope: member.scope,
                    locators: member.citations.map(
                        (citation) => citation.locator,
                    ),
                })),
            };
            return { candidate, memberIds: [...concept.memberIds], concept };
        }),
        ...part.deferred.map((entry) => {
            const node = raw.get(entry.nodeId);
            if (!node)
                throw new Error("Prepared deferral lost original evidence");
            const candidate = groundTopicCandidate(
                snapshot,
                node,
                node.citations,
                "group",
                contexts,
            );
            candidate.grounding = { ...candidate.grounding, prepared: false };
            return { candidate, memberIds: [node.id], concept: undefined };
        }),
    ]);
    return groups.map((group, ordinal) => {
        const key = `g${ordinal}`;
        group.candidate.key = key;
        const nominated = nominations.related(
            [group.candidate.node],
            group.concept?.id,
        );
        return {
            memberIds: group.memberIds,
            ...(group.concept ? { concept: group.concept } : {}),
            task: {
                candidate: group.candidate,
                targets: nominated.map((concept) =>
                    ground(concept, `t${positions.get(concept.id)}`),
                ),
                score: false,
                referenceGroup: true,
                reason: "prepared-group-reconciliation",
                nomination: {
                    availableConcepts:
                        nominatedConcepts.length -
                        Number(
                            Boolean(
                                group.concept &&
                                    positions.has(group.concept.id),
                            ),
                        ),
                    nominatedConcepts: nominated.length,
                },
            },
        };
    });
}

export function mergePreparedTopicMembers(
    snapshot: TopicSnapshot,
    concept: TopicConcept,
    ids: string[],
    salience: number,
): void {
    concept.memberIds = [...new Set([...concept.memberIds, ...ids])].sort();
    concept.salience = Math.max(concept.salience, salience);
    const members = new Set(concept.memberIds);
    concept.citations = [
        ...new Map(
            [
                ...concept.citations,
                ...snapshot.nodes
                    .filter((node) => members.has(node.id))
                    .flatMap((node) => node.citations),
            ].map((citation) => [viewHash(citation), citation]),
        ).values(),
    ];
    concept.summary = "";
    concept.summaryState = "pending";
    delete concept.summaryCitations;
    delete concept.validation;
    delete concept.maintenance;
}

function groupCandidate(
    group: PreparedTopicDecisionGroup,
): TopicCurationCandidate {
    return {
        id: group.task.candidate.node.id,
        label: group.task.candidate.node.label,
        scope: group.task.candidate.node.scope,
        citations: group.task.candidate.node.citations,
        memberIds: group.memberIds,
        ...(group.concept ? { purpose: group.concept.purpose } : {}),
    };
}

function unresolvedTopicChoiceReason(
    choice: string | undefined,
    hasTarget: boolean,
): string {
    if (!choice) return "Missing bounded answer";
    if (choice === "standalone_new") return "Missing canonical metadata";
    if (hasTarget)
        return "Target is not a fixed standalone root; transitive merging is not certified";
    return "Uncertain bounded disposition";
}

function stagePreparedTopicChoices(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    groups: PreparedTopicDecisionGroup[],
    choices: ReadonlyMap<string, string>,
    signal: AbortSignal,
) {
    requireResolvedPreparedWindow(window);
    const staged = new Map(
        window.current.concepts.map((concept) => [
            concept.id,
            structuredClone(concept),
        ]),
    );
    const deferred = structuredClone(window.current.deferred);
    for (const group of groups)
        if (
            group.concept &&
            choices.get(group.task.candidate.key) === "standalone_new"
        )
            staged.set(group.concept.id, structuredClone(group.concept));
    const unresolved: Array<{
        group: PreparedTopicDecisionGroup;
        reason: string;
    }> = [];
    for (const group of groups) {
        signal.throwIfAborted();
        const choice = choices.get(group.task.candidate.key);
        const target = group.task.targets.find(
            (target) => target.key === choice,
        );
        const root = target?.concept
            ? staged.get(target.concept.id)
            : undefined;
        if (choice === "standalone_new" && group.concept) continue;
        if (choice?.startsWith("defer_")) {
            if (!(choice in topicDispositionCriteria))
                throw new Error("Unknown prepared topic deferral");
            const reason =
                topicDispositionCriteria[
                    choice as keyof typeof topicDispositionCriteria
                ];
            deferred.push(
                ...group.memberIds.map((nodeId) => ({ nodeId, reason })),
            );
        } else if (root) {
            mergePreparedTopicMembers(
                snapshot,
                root,
                group.memberIds,
                group.concept?.salience ?? root.salience,
            );
        } else {
            if (
                choice &&
                choice !== "standalone_new" &&
                choice !== "uncertain_needs_synthesis" &&
                !target
            )
                throw new Error("Prepared topic selected an unoffered target");
            unresolved.push({
                group,
                reason: unresolvedTopicChoiceReason(choice, Boolean(target)),
            });
        }
    }
    return { staged, deferred, unresolved };
}

export async function reconcilePreparedTopicChoices(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    groups: PreparedTopicDecisionGroup[],
    choices: ReadonlyMap<string, string>,
    complete: TopicCurationCompletion,
    signal: AbortSignal,
    onFallback?: (event: PreparedTopicFallback) => void,
    usefulRawIds?: ReadonlySet<string>,
    reconcileGenerated?: (
        priors: TopicConcept[],
        generated: TopicCuration,
    ) => Promise<TopicCuration>,
): Promise<TopicCuration> {
    const { staged, deferred, unresolved } = stagePreparedTopicChoices(
        snapshot,
        window,
        groups,
        choices,
        signal,
    );
    for (const metadata of [true, false]) {
        const batch = unresolved.filter(
            ({ group }) =>
                (choices.get(group.task.candidate.key) === "standalone_new") ===
                metadata,
        );
        if (!batch.length) continue;
        signal.throwIfAborted();
        const priors = metadata ? [] : [...staged.values()];
        const kind = metadata ? "metadata" : "resolution";
        for (const { group, reason } of batch) {
            onFallback?.({
                candidateId: group.task.candidate.node.id,
                members: group.memberIds.length,
                targets: priors.length,
                kind,
                reason,
            });
            console.warn(`Prepared topic ${kind} fallback: ${reason}`);
        }
        let resolved = await curateTopicEvidence(
            snapshot,
            (node) => node.citations,
            (rules, payload, schema, call) =>
                complete(
                    metadata
                        ? `${rules}\nThese candidates were independently selected as standalone. Author each candidate independently; never merge distinct supplied candidates or reconsider admission. Preserve each candidate's original membership, source role and qualifications.`
                        : `${rules}\nThese are original raw members of unresolved prepared groups. Split incompatible factual scopes rather than treating a prepared group as indivisible. Keep substantive assistant reference as qualified advice or possibilities, not adopted user facts. Previously admitted external priors are not editable inputs; the host reconciles them separately.`,
                    payload,
                    schema,
                    call?.kind === "normal" ? { ...call, kind } : call,
                ),
            signal,
            true,
            undefined,
            undefined,
            {
                candidates: metadata
                    ? batch.map(({ group }) => ({
                          ...groupCandidate(group),
                          referenceRequired: true,
                      }))
                    : batch.flatMap(({ group }) =>
                          snapshot.nodes
                              .filter((node) =>
                                  group.memberIds.includes(node.id),
                              )
                              .map((node) => ({
                                  id: node.id,
                                  label: node.label,
                                  scope: node.scope,
                                  citations: node.citations,
                                  ...(usefulRawIds?.has(node.id)
                                      ? { referenceRequired: true }
                                      : {}),
                              })),
                      ),
                priorDeltas: true,
                compactIds: true,
            },
        );
        if (!metadata && priors.length) {
            if (!reconcileGenerated)
                throw new Error(
                    "Prepared resolution requires bounded reconciliation against read-only priors",
                );
            resolved = await reconcileGenerated(priors, resolved);
        }
        if (
            metadata &&
            resolved.concepts.some(
                (concept) =>
                    !batch.some(
                        ({ group }) =>
                            concept.memberIds.length ===
                                group.memberIds.length &&
                            concept.memberIds.every((id) =>
                                group.memberIds.includes(id),
                            ),
                    ),
            )
        )
            throw new Error(
                "Prepared metadata authoring changed standalone partitions",
            );
        for (const prior of priors) {
            const retained = resolved.concepts.find(
                (concept) =>
                    concept.label === prior.label &&
                    concept.scope === prior.scope &&
                    concept.purpose === prior.purpose &&
                    prior.memberIds.every((id) =>
                        concept.memberIds.includes(id),
                    ),
            );
            if (!retained)
                throw new Error(
                    "Prepared resolution changed a read-only prior definition or membership",
                );
        }
        resolved.concepts = resolved.concepts.map((concept) => {
            const unchanged = priors.find(
                (prior) =>
                    prior.label === concept.label &&
                    prior.scope === concept.scope &&
                    prior.purpose === concept.purpose &&
                    prior.memberIds.length === concept.memberIds.length &&
                    prior.memberIds.every((id) =>
                        concept.memberIds.includes(id),
                    ),
            );
            if (unchanged) return structuredClone(unchanged);
            mergePreparedTopicMembers(snapshot, concept, [], concept.salience);
            return concept;
        });
        for (const prior of priors) staged.delete(prior.id);
        for (const concept of resolved.concepts)
            staged.set(concept.id, concept);
        deferred.push(...resolved.deferred);
    }
    const result = { concepts: [...staged.values()], deferred };
    validateTopicCurationProgress({ ...snapshot, curationProgress: result });
    const ids = (curation: TopicCuration) => [
        ...curation.concepts.flatMap((concept) => concept.memberIds),
        ...curation.deferred.map((entry) => entry.nodeId),
    ];
    const expected = new Set([window.current, ...window.prepared].flatMap(ids));
    const accounted = new Set(ids(result));
    if (
        expected.size !== accounted.size ||
        [...expected].some((id) => !accounted.has(id))
    )
        throw new Error(
            "Prepared reconciliation lost complete window membership",
        );
    return result;
}
