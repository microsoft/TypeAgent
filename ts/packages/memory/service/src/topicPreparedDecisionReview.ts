// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type TopicDecisionOptions,
    type TopicDecisionPacket,
    type TopicDecisionTask,
    groundTopicCandidate,
    groundTopicConcept,
    indexTopicDecisionEvidence,
    packTopicDecisions,
    planTopicDecisionChoice,
} from "./topicDecision.js";
import { buildTopicReferenceValidationPacket } from "./topicDecisionClusters.js";
import {
    mergePreparedTopicMembers,
    prepareTopicDecisionGroups,
    type PreparedTopicDecisionGroup,
} from "./topicPreparedDecision.js";
import type { PreparedTopicWindow } from "./topicFrozenPreparation.js";
import type {
    TopicConcept,
    TopicCuration,
    TopicSnapshot,
} from "./topicTypes.js";

export type PreparedTopicReview = (
    packets: TopicDecisionPacket[],
    reason:
        | "prepared-raw-usefulness"
        | "prepared-fixed-root-validation"
        | "prepared-generated-equivalence"
        | "prepared-reference-evidence"
        | "prepared-reference-coverage"
        | "prepared-final-definition-validation"
        | "prepared-definition-repair-kind",
) => Promise<Array<Record<string, string>>>;

export function assertReviewAnswers(
    packets: TopicDecisionPacket[],
    answers: Array<Record<string, string>>,
) {
    if (answers.length !== packets.length)
        throw new Error("Prepared review lost packet accounting");
    for (const [index, packet] of packets.entries())
        for (const [key, question] of Object.entries(packet.request.questions))
            if (
                question.type !== "choice" ||
                !Object.prototype.hasOwnProperty.call(
                    question.criteria,
                    answers[index][key],
                )
            )
                throw new Error("Prepared review is missing a bounded answer");
}

export function fixedRootCertified(
    packet: TopicDecisionPacket,
    verdict: Record<string, string>,
) {
    return (
        verdict.coherence === "coherent" &&
        packet.tasks.every(
            (task) =>
                verdict[`fit_${task.candidate.key}`] === "keep" ||
                (packet.tasks.length === 1 &&
                    !(`fit_${task.candidate.key}` in packet.request.questions)),
        )
    );
}

function components(
    groups: PreparedTopicDecisionGroup[],
    choices: ReadonlyMap<string, string>,
) {
    const owners = new Map(
        groups.flatMap((group, index) =>
            group.concept ? [[group.concept.id, index] as const] : [],
        ),
    );
    const edges = groups.map(() => new Set<number>());
    const targetOwners = new Map<string, number>();
    for (const [index, group] of groups.entries()) {
        const choice = choices.get(group.task.candidate.key);
        const target = group.task.targets.find(
            (target) => target.key === choice,
        );
        const owner =
            target?.concept &&
            (owners.get(target.concept.id) ??
                targetOwners.get(target.concept.id));
        if (typeof owner === "number") {
            edges[index].add(owner);
            edges[owner].add(index);
        }
        if (target?.concept) targetOwners.set(target.concept.id, index);
    }
    const seen = new Set<number>();
    const result: number[][] = [];
    for (const index of groups.keys()) {
        if (seen.has(index)) continue;
        const members: number[] = [];
        const queue = [index];
        while (queue.length) {
            const next = queue.pop()!;
            if (seen.has(next)) continue;
            seen.add(next);
            members.push(next);
            queue.push(...edges[next]);
        }
        result.push(members.sort((a, b) => a - b));
    }
    return result;
}

function definitionFor(
    groups: PreparedTopicDecisionGroup[],
    indices: number[],
    choices: ReadonlyMap<string, string>,
    current: TopicConcept[],
) {
    for (const index of indices) {
        const group = groups[index];
        const target = group.task.targets.find(
            (target) => target.key === choices.get(group.task.candidate.key),
        );
        if (
            target?.concept &&
            current.some((prior) => prior.id === target.concept!.id)
        )
            return target.concept;
    }
    const standalone = indices
        .map((index) => groups[index])
        .find(
            (group) =>
                choices.get(group.task.candidate.key) === "standalone_new" &&
                group.concept,
        );
    if (standalone) return standalone.concept;
    return indices
        .map((index) => groups[index].concept)
        .filter((concept): concept is TopicConcept => Boolean(concept))
        .sort((a, b) => a.id.localeCompare(b.id))[0];
}

function readUsefulness(
    packets: TopicDecisionPacket[],
    answers: Array<Record<string, string>>,
) {
    if (answers.length !== packets.length)
        throw new Error("Prepared usefulness review lost packet accounting");
    const usefulness = new Map<string, string>();
    for (const [index, packet] of packets.entries())
        for (const task of packet.tasks) {
            const value = answers[index][`usefulness_${task.candidate.key}`];
            if (
                !["useful_reference", "incidental", "uncertain"].includes(value)
            )
                throw new Error(
                    "Prepared usefulness review is missing a bounded answer",
                );
            usefulness.set(task.candidate.node.id, value);
        }
    return usefulness;
}

async function reviewUsefulness(
    tasks: TopicDecisionTask[],
    options: TopicDecisionOptions,
    review: PreparedTopicReview,
    adjudicateNegative?: PreparedTopicReview,
) {
    const pack = (tasks: TopicDecisionTask[]) =>
        packTopicDecisions(
            tasks,
            options.model.model,
            16384,
            options.model.checkRequest,
            "factored-best-fit",
        );
    const packets = pack(tasks);
    const primary = readUsefulness(
        packets,
        await review(packets, "prepared-raw-usefulness"),
    );
    const negative = tasks.filter(
        (task) => primary.get(task.candidate.node.id) !== "useful_reference",
    );
    const adjudication = new Map<string, string>();
    if (adjudicateNegative && negative.length) {
        const packets = pack(negative);
        const answers = readUsefulness(
            packets,
            await adjudicateNegative(packets, "prepared-raw-usefulness"),
        );
        for (const [id, choice] of answers) adjudication.set(id, choice);
    }
    const effective = new Map(primary);
    for (const [id, choice] of adjudication)
        effective.set(
            id,
            choice === "useful_reference"
                ? choice
                : choice === "incidental" && primary.get(id) === "incidental"
                  ? "incidental"
                  : "uncertain",
        );
    return { primary, adjudication, effective };
}

export async function reviewPreparedTopicChoices(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    groups: PreparedTopicDecisionGroup[],
    selected: ReadonlyMap<string, string>,
    options: TopicDecisionOptions,
    review: PreparedTopicReview,
    adjudicateNegative?: PreparedTopicReview,
) {
    const contexts = indexTopicDecisionEvidence(snapshot);
    const incoming = new Set(groups.flatMap((group) => group.memberIds));
    const raw = snapshot.nodes.filter((node) => incoming.has(node.id));
    const tasks: TopicDecisionTask[] = raw.map((node, index) => ({
        candidate: groundTopicCandidate(
            snapshot,
            node,
            node.citations,
            `u${index}`,
            contexts,
        ),
        targets: [],
        score: false,
        referenceUsefulness: true,
        reason: "prepared-raw-usefulness",
    }));
    const usefulnessReviews = await reviewUsefulness(
        tasks,
        options,
        review,
        adjudicateNegative,
    );
    const usefulness = usefulnessReviews.effective;
    const choices = new Map(selected);
    const reviewed = groups.map((group) => ({
        ...group,
        task: { ...group.task, targets: [...group.task.targets] },
    }));
    const checks: Array<{
        indices: number[];
        definition: TopicConcept;
        packet: TopicDecisionPacket;
    }> = [];
    for (const indices of components(groups, selected)) {
        const editable = indices.flatMap((index) => groups[index].memberIds);
        if (
            indices.every((index) =>
                choices
                    .get(groups[index].task.candidate.key)
                    ?.startsWith("defer_"),
            )
        ) {
            if (editable.every((id) => usefulness.get(id) === "incidental"))
                continue;
            for (const index of indices)
                choices.set(
                    groups[index].task.candidate.key,
                    "uncertain_needs_synthesis",
                );
            continue;
        }
        const definition = definitionFor(
            groups,
            indices,
            selected,
            window.current.concepts,
        );
        if (!definition) {
            if (
                !editable.every(
                    (id) => usefulness.get(id) === "useful_reference",
                )
            )
                for (const index of indices)
                    choices.set(
                        groups[index].task.candidate.key,
                        "uncertain_needs_synthesis",
                    );
            continue;
        }
        if (
            !editable.every((id) => usefulness.get(id) === "useful_reference")
        ) {
            for (const index of indices)
                choices.set(
                    groups[index].task.candidate.key,
                    "uncertain_needs_synthesis",
                );
            continue;
        }
        const members = raw
            .filter((node) => editable.includes(node.id))
            .map((node, index) =>
                groundTopicCandidate(
                    snapshot,
                    node,
                    node.citations,
                    `m${index}`,
                    contexts,
                ),
            );
        const packet = buildTopicReferenceValidationPacket(
            definition,
            members,
            options,
        );
        if (
            packet.tokens > 16384 ||
            Object.keys(packet.request.questions).length > 64
        ) {
            console.warn(
                "Prepared fixed-root validation exceeds complete-context capacity; resolving original raws",
            );
            for (const index of indices)
                choices.set(
                    groups[index].task.candidate.key,
                    "uncertain_needs_synthesis",
                );
            continue;
        }
        checks.push({ indices, definition, packet });
    }
    const verdicts = checks.length
        ? await review(
              checks.map((check) => check.packet),
              "prepared-fixed-root-validation",
          )
        : [];
    assertReviewAnswers(
        checks.map((check) => check.packet),
        verdicts,
    );
    const certifications = checks.map((check, ordinal) => {
        const verdict = verdicts[ordinal];
        const certified = fixedRootCertified(check.packet, verdict);
        for (const index of check.indices) {
            const group = reviewed[index];
            if (!certified) {
                choices.set(
                    group.task.candidate.key,
                    "uncertain_needs_synthesis",
                );
            } else if (group.concept?.id === check.definition.id) {
                choices.set(group.task.candidate.key, "standalone_new");
            } else {
                const key = `certified${ordinal}`;
                group.task.targets.push(
                    groundTopicConcept(
                        snapshot,
                        check.definition,
                        key,
                        contexts,
                    ),
                );
                choices.set(group.task.candidate.key, key);
            }
        }
        return {
            definitionId: check.definition.id,
            candidateKeys: check.indices.map(
                (index) => groups[index].task.candidate.key,
            ),
            rawMembers: check.packet.tasks.map(
                (task) => task.candidate.node.id,
            ),
            certified,
            answers: verdict,
            oldAnchorEvidence:
                "Read-only health deferred; complete fixed definition and editable original raw evidence checked",
        };
    });
    return {
        groups: reviewed,
        choices,
        usefulRawIds: new Set(
            [...usefulness]
                .filter(([, value]) => value === "useful_reference")
                .map(([id]) => id),
        ),
        usefulness: Object.fromEntries(usefulness),
        usefulnessReviews: {
            primary: Object.fromEntries(usefulnessReviews.primary),
            adjudication: Object.fromEntries(usefulnessReviews.adjudication),
        },
        certifications,
    };
}

export async function reconcileGeneratedPreparedTopics(
    snapshot: TopicSnapshot,
    window: PreparedTopicWindow,
    priors: TopicConcept[],
    generated: TopicCuration,
    options: TopicDecisionOptions,
    review: PreparedTopicReview,
) {
    const editable = new Set(
        window.prepared.flatMap((part) => [
            ...part.concepts.flatMap((concept) => concept.memberIds),
            ...part.deferred.map((entry) => entry.nodeId),
        ]),
    );
    const priorIds = new Set(priors.map((prior) => prior.id));
    const groups = prepareTopicDecisionGroups(
        snapshot,
        {
            current: { concepts: priors, deferred: [] },
            prepared: [generated],
        },
        priors,
    ).filter((group) => group.concept);
    for (const group of groups) {
        group.task.targets = group.task.targets.filter(
            (target) => target.concept && priorIds.has(target.concept.id),
        );
        group.task.equivalenceOnly = true;
        group.task.nomination = {
            availableConcepts: priors.length,
            nominatedConcepts: group.task.targets.length,
        };
    }
    const packets = packTopicDecisions(
        groups.map((group) => group.task),
        options.model.model,
        16384,
        options.model.checkRequest,
        "factored-best-fit",
    );
    const answers = packets.length
        ? await review(packets, "prepared-generated-equivalence")
        : [];
    assertReviewAnswers(packets, answers);
    const choices = groups.map((group) => {
        const values = packets.flatMap((packet, index) =>
            packet.tasks.some(
                (task) => task.candidate.key === group.task.candidate.key,
            )
                ? [answers[index][`disposition_${group.task.candidate.key}`]]
                : [],
        );
        const plan = planTopicDecisionChoice(group.task, values);
        return {
            candidateId: group.concept!.id,
            choice:
                typeof plan === "string" ? plan : "uncertain_needs_synthesis",
            conflictingTargetBatches: typeof plan !== "string",
            nomination: group.task.nomination,
        };
    });
    const contexts = indexTopicDecisionEvidence(snapshot);
    const proposals = priors.flatMap((definition) => {
        const selected = groups.filter((group, index) =>
            group.task.targets.some(
                (target) =>
                    target.key === choices[index].choice &&
                    target.concept?.id === definition.id,
            ),
        );
        if (!selected.length) return [];
        const ids = new Set([
            ...definition.memberIds.filter((id) => editable.has(id)),
            ...selected.flatMap((group) => group.memberIds),
        ]);
        const members = snapshot.nodes
            .filter((node) => ids.has(node.id))
            .map((node, index) =>
                groundTopicCandidate(
                    snapshot,
                    node,
                    node.citations,
                    `r${index}`,
                    contexts,
                ),
            );
        const packet = buildTopicReferenceValidationPacket(
            definition,
            members,
            options,
        );
        return [{ definition, selected, packet }];
    });
    const checks = proposals.filter(
        ({ packet }) =>
            packet.tokens <= 16384 &&
            Object.keys(packet.request.questions).length <= 64,
    );
    const verdicts = checks.length
        ? await review(
              checks.map((check) => check.packet),
              "prepared-fixed-root-validation",
          )
        : [];
    assertReviewAnswers(
        checks.map((check) => check.packet),
        verdicts,
    );
    const installed = new Map(
        priors.map((prior) => [prior.id, structuredClone(prior)]),
    );
    const attached = new Set<string>();
    const certifications = proposals.map((proposal) => {
        const ordinal = checks.indexOf(proposal);
        const certified =
            ordinal >= 0 &&
            fixedRootCertified(proposal.packet, verdicts[ordinal]);
        if (certified)
            for (const group of proposal.selected) {
                mergePreparedTopicMembers(
                    snapshot,
                    installed.get(proposal.definition.id)!,
                    group.memberIds,
                    group.concept!.salience,
                );
                attached.add(group.concept!.id);
            }
        return {
            definitionId: proposal.definition.id,
            candidateIds: proposal.selected.map((group) => group.concept!.id),
            certified,
            capacityExceeded: ordinal < 0,
            ...(ordinal >= 0 ? { answers: verdicts[ordinal] } : {}),
        };
    });
    return {
        curation: {
            concepts: [
                ...installed.values(),
                ...generated.concepts.filter(
                    (concept) => !attached.has(concept.id),
                ),
            ],
            deferred: generated.deferred,
        },
        review: {
            choices,
            certifications,
            retainedAdmittedIds: generated.concepts
                .filter((concept) => !attached.has(concept.id))
                .map((concept) => concept.id),
            retentionDoesNotCertifyGlobalNovelty: true,
        },
    };
}
