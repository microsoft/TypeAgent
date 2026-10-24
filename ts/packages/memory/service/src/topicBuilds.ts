// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewSynthesisAdapter,
} from "./viewTypes.js";
import type { TopicSnapshot } from "./topicTypes.js";
import { validateTopicSnapshot } from "./topicSnapshot.js";
import type { TopicGenerator } from "./topicGeneration.js";

export interface TopicBuildOwner {
    materializeTopicIncidence?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        snapshot: TopicSnapshot,
        signal: AbortSignal,
    ): Promise<void>;
    materializeTopics?(
        job: ViewBuildJob,
        result: ViewBuildTargetResult,
        snapshot: TopicSnapshot,
        signal: AbortSignal,
    ): Promise<void>;
}

export async function generateTopicTarget(
    adapter: ViewSynthesisAdapter,
    input: ViewBuildSnapshot,
    signal: AbortSignal,
    fallback?: TopicGenerator,
): Promise<TopicSnapshot> {
    const generate = adapter.generateTopics?.bind(adapter) ?? fallback;
    if (!generate)
        throw new Error(
            "Topic generation is not supported by this synthesis adapter",
        );
    signal.throwIfAborted();
    const snapshot = await generate(input, signal);
    signal.throwIfAborted();
    validateTopicBuildOutput(input, snapshot);
    return snapshot;
}

export function validateTopicBuildOutput(
    input: ViewBuildSnapshot,
    snapshot: TopicSnapshot,
): void {
    validateTopicSnapshot(snapshot);
    if (
        snapshot.corpusId !== input.corpusId ||
        snapshot.inputFingerprint !== input.fingerprint ||
        JSON.stringify(snapshot.occurrences) !==
            JSON.stringify(input.topicInput?.occurrences) ||
        JSON.stringify(snapshot.influenceSources) !==
            JSON.stringify(input.influenceSources ?? []) ||
        JSON.stringify(snapshot.influenceEvents ?? []) !==
            JSON.stringify(input.influenceEvents ?? [])
    )
        throw new Error(
            "Topic output changed complete captured incidence or influence",
        );
    for (const node of snapshot.nodes) {
        const authored = input.topicInput?.authoredLabels?.find(
            (entry) => entry.id === node.id,
        );
        if (authored) {
            if (
                node.authorship !== "human" ||
                node.label !== authored.label ||
                JSON.stringify(node.aliases) !==
                    JSON.stringify(authored.aliases)
            )
                throw new Error(
                    "Topic generation changed protected human labels",
                );
        } else if (node.authorship !== "generated") {
            throw new Error(
                "Agent-generated topic labels cannot become human-protected edits",
            );
        }
    }
}
