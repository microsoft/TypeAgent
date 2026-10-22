// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseTemporalValue,
    validateTemporalValue,
    type TemporalQueryContext,
} from "@typeagent/knowpro";

export function normalizeQueryTemporalContext(context?: TemporalQueryContext) {
    if (!context) return undefined;
    if (context.availabilityPolicy === "as-of")
        throw new Error(
            "Strict as-of temporal availability is not supported; use an explicitly scoped corpus",
        );
    const referenceTime =
        context.referenceTime === undefined
            ? undefined
            : typeof context.referenceTime === "string"
              ? parseTemporalValue(context.referenceTime)
              : validateTemporalValue(context.referenceTime);
    return {
        ...(referenceTime ? { referenceTime } : {}),
        availabilityPolicy: context.availabilityPolicy ?? "supplied-history",
    };
}

export const temporalQuestionInstructions =
    "Resolve query-relative dates against referenceTime, never import time. Floating dates have no assumed timezone. Supplied history remains eligible, including same-day sessions after question time. Event time is not a message-time constraint. Latest means the latest supported applicable state, not the latest uploaded source; retain explicit corrections and unresolved conflicts.";

export function temporalQuestion(
    query: string,
    context?: TemporalQueryContext,
): string {
    const normalized = normalizeQueryTemporalContext(context);
    return normalized
        ? `Question temporal metadata (not source evidence): ${JSON.stringify(normalized)}\n${temporalQuestionInstructions}\n\n${query}`
        : query;
}
