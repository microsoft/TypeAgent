// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentMatchCandidate,
    ClarifyMultipleAgentMatches,
} from "../context/dispatcher/schema/clarifyActionSchema.js";

export function buildClarifyMultipleAgentMatches(
    request: string,
    candidates: AgentMatchCandidate[],
): ClarifyMultipleAgentMatches {
    const list = candidates
        .map(
            (c, i) =>
                `${i + 1}. ${c.schemaName}.${c.actionName}` +
                (c.score !== undefined ? ` (score ${c.score.toFixed(3)})` : ""),
        )
        .join("\n");
    return {
        actionName: "clarifyMultipleAgentMatches",
        parameters: {
            request,
            candidates,
            clarifyingQuestion:
                `Multiple agents could handle this request. Which one did you mean?\n` +
                list,
        },
    };
}
