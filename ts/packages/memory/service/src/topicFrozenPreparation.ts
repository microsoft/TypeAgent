// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { recordSearchTiming, timeSearchStage } from "@typeagent/knowpro";
import type {
    TopicCurationCandidate,
    TopicCurationCompletion,
    TopicCurationOptions,
    curateTopics,
} from "./topicCuration.js";
import type { TopicCuration, TopicNode, TopicSnapshot } from "./topicTypes.js";
import type { ViewCitation } from "./viewTypes.js";
import type { OrderedTopicPacket } from "./topicCurationScheduler.js";
import { viewHash } from "./viewMerge.js";

async function parallel<T>(
    work: Array<(signal: AbortSignal) => Promise<T>>,
    signal: AbortSignal,
): Promise<T[]> {
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const pending = work.map((execute) =>
        Promise.resolve().then(() => {
            combined.throwIfAborted();
            return execute(combined);
        }),
    );
    try {
        return await Promise.all(pending);
    } catch (error) {
        controller.abort(error);
        await Promise.allSettled(pending);
        throw error;
    }
}

export async function runFrozenTopicWindows<P extends OrderedTopicPacket>(
    count: number,
    signal: AbortSignal,
    prepare: (start: number, ordinal: number) => P,
    combine: (packets: P[]) => P,
    decide: (
        packet: P,
        signal: AbortSignal,
        work: () => Promise<TopicCuration>,
    ) => Promise<TopicCuration>,
    work: (packets: P[], signal: AbortSignal) => Promise<TopicCuration>,
    commit: (
        packet: P,
        value: TopicCuration,
        ordinal: number,
    ) => Promise<void | boolean>,
): Promise<void> {
    let position = 0;
    let ordinal = 1;
    while (position < count) {
        signal.throwIfAborted();
        const packets = [prepare(position, ordinal * 2 - 1)];
        if (packets[0].end < count)
            packets.push(prepare(packets[0].end, ordinal * 2));
        const window = combine(packets);
        const value = await decide(window, signal, () =>
            timeSearchStage("topic.curation.frozen.prepare", () =>
                work(packets, signal),
            ),
        );
        signal.throwIfAborted();
        await timeSearchStage(
            "topic.curation.commit",
            () => commit(window, value, ordinal),
            { ordinal, frozen: true },
        );
        position = window.end;
        ordinal++;
    }
}

export async function reconcileFrozenTopics(
    snapshot: TopicSnapshot,
    batches: TopicCurationCandidate[][],
    current: TopicCuration,
    evidenceFor: (node: TopicNode) => ViewCitation[],
    complete: TopicCurationCompletion,
    signal: AbortSignal,
    options: TopicCurationOptions,
    curate: typeof curateTopics,
    validate: (curation: TopicCuration) => void,
): Promise<TopicCuration> {
    const inner: TopicCurationOptions = {
        ...options,
        frozenPreparation: false,
        concurrency: 1,
    };
    delete inner.replayPackets;
    delete inner.onPacket;
    const prepared = await parallel(
        batches.map(
            (candidates) => (preparationSignal: AbortSignal) =>
                curate(
                    snapshot,
                    evidenceFor,
                    (rules, payload, schema, call) =>
                        complete(
                            rules,
                            payload,
                            schema,
                            call ? { ...call, phase: "preparation" } : call,
                        ),
                    preparationSignal,
                    true,
                    undefined,
                    undefined,
                    { ...inner, candidates },
                ),
        ),
        signal,
    );
    signal.throwIfAborted();
    const raw = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const candidates: TopicCurationCandidate[] = prepared.flatMap((result) => [
        ...result.concepts.map((concept) => ({
            ...concept,
            id: `proposal:${viewHash(concept.memberIds)}`,
        })),
        ...result.deferred.map(({ nodeId }) => {
            const node = raw.get(nodeId);
            if (!node)
                throw new Error("Frozen topic preparation lost raw membership");
            return node;
        }),
    ]);
    recordSearchTiming("topic.curation.frozen.frontier", 0, {
        rawNodes: batches.reduce((sum, batch) => sum + batch.length, 0),
        candidates: candidates.length,
        priorConcepts: current.concepts.length,
    });
    const reconciled = await timeSearchStage(
        "topic.curation.frozen.reconcile",
        () =>
            curate(
                snapshot,
                evidenceFor,
                (rules, payload, schema, call) =>
                    complete(
                        rules,
                        payload,
                        schema,
                        call ? { ...call, phase: "reconciliation" } : call,
                    ),
                signal,
                true,
                undefined,
                current,
                { ...inner, candidates },
            ),
    );
    validate(reconciled);
    const retainedDeferrals = new Set(
        current.deferred.map(({ nodeId }) => nodeId),
    );
    return {
        concepts: reconciled.concepts,
        deferred: reconciled.deferred.filter(
            ({ nodeId }) => !retainedDeferrals.has(nodeId),
        ),
    };
}
