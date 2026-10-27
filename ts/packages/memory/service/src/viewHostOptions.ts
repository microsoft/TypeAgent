// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseViewDraftCapability } from "./viewBuildValidation.js";
import type { FileMemoryServiceOptions } from "./fileMemoryService.js";
import {
    validateTopicCurationSettings,
    type TopicCurationSettings,
} from "./topicCuration.js";

function curationSettings(
    environment: Readonly<Record<string, string | undefined>>,
): TopicCurationSettings | undefined {
    function numeric(name: string): number | undefined {
        const raw = environment[name];
        if (raw === undefined) return undefined;
        if (!raw.trim() || !Number.isFinite(Number(raw)))
            throw new Error(`Invalid ${name}`);
        return Number(raw);
    }
    const inputTokenTarget = numeric("TYPEAGENT_MEMORY_TOPIC_INPUT_TOKENS");
    const concurrency = numeric("TYPEAGENT_MEMORY_TOPIC_CONCURRENCY");
    const priorContextFraction = numeric(
        "TYPEAGENT_MEMORY_TOPIC_PRIOR_FRACTION",
    );
    if (
        inputTokenTarget === undefined &&
        concurrency === undefined &&
        priorContextFraction === undefined
    )
        return undefined;
    if (concurrency !== undefined && concurrency !== 1 && concurrency !== 2)
        throw new Error("Invalid TYPEAGENT_MEMORY_TOPIC_CONCURRENCY");
    const settings: TopicCurationSettings = {
        ...(inputTokenTarget !== undefined ? { inputTokenTarget } : {}),
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(priorContextFraction !== undefined ? { priorContextFraction } : {}),
    };
    validateTopicCurationSettings(settings);
    return settings;
}

export function getConfiguredMemoryViewOptions(
    environment: Readonly<Record<string, string | undefined>> = process.env,
): Pick<
    FileMemoryServiceOptions,
    "viewDrafts" | "informationalViews" | "topicCuration"
> {
    const topicCuration = curationSettings(environment);
    return {
        viewDrafts: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_VIEW_DRAFTS,
        ),
        informationalViews: parseViewDraftCapability(
            environment.TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS,
            "TYPEAGENT_MEMORY_INFORMATIONAL_VIEWS",
        ),
        ...(topicCuration ? { topicCuration } : {}),
    };
}
