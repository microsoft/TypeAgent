// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { viewHash } from "./viewMerge.js";

export type TopicGenerativeDecisionStage = "decomposed" | "output-contract";

export interface TopicCurationSettings {
    inputTokenTarget?: number;
    priorContextFraction?: number;
    priorDeltas?: boolean;
    compactIds?: boolean;
    generativeDecisionStage?:
        | TopicGenerativeDecisionStage
        | "original"
        | undefined;
}

export function validateTopicCurationSettings(
    options: TopicCurationSettings,
): void {
    if (
        "concurrency" in options ||
        "frozenPreparation" in options ||
        (options.generativeDecisionStage !== undefined &&
            !["original", "decomposed", "output-contract"].includes(
                options.generativeDecisionStage,
            )) ||
        (options.inputTokenTarget !== undefined &&
            (!Number.isSafeInteger(options.inputTokenTarget) ||
                options.inputTokenTarget < 1)) ||
        [options.priorDeltas, options.compactIds].some(
            (value) => value !== undefined && typeof value !== "boolean",
        ) ||
        (options.priorContextFraction !== undefined &&
            (!Number.isFinite(options.priorContextFraction) ||
                options.priorContextFraction < 0 ||
                options.priorContextFraction > 0.5 ||
                options.inputTokenTarget === undefined))
    )
        throw new Error("Invalid topic curation settings");
}

export function resolveTopicCurationSettings(
    settings: TopicCurationSettings = {},
): TopicCurationSettings {
    validateTopicCurationSettings(settings);
    return {
        ...settings,
        priorDeltas: settings.priorDeltas ?? true,
        compactIds: settings.compactIds ?? true,
        generativeDecisionStage:
            settings.generativeDecisionStage ?? "output-contract",
    };
}

export function topicCurationPolicy(
    curated: boolean,
    settings?: TopicCurationSettings,
): string {
    if (!curated) return "raw-v1";
    const resolved = resolveTopicCurationSettings(settings);
    const recipe = `curated-lazy-v10:${viewHash([
        resolved.inputTokenTarget ?? null,
        resolved.priorContextFraction ?? 0,
        resolved.priorDeltas,
        resolved.compactIds,
        "frozen-two-packet-windows",
    ]).slice(0, 16)}`;
    return resolved.generativeDecisionStage !== "original"
        ? `${recipe}:generative-partition-v1:${resolved.generativeDecisionStage}`
        : recipe;
}
