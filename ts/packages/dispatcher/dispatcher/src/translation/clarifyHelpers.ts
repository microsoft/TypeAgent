// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AgentMatchCandidate,
    ClarifyMultipleAgentMatches,
} from "../context/dispatcher/schema/clarifyActionSchema.js";

export function buildClarifyMultipleAgentMatches(
    request: string,
    candidates: AgentMatchCandidate[],
    neighborhoodIds?: string[],
): ClarifyMultipleAgentMatches {
    // Callers may pass richer candidate objects (e.g. CollisionCandidate with
    // matchedCount / nonOptionalCount / priorityRank heuristics). The
    // ClarifyMultipleAgentMatches schema only allows schemaName, actionName,
    // and an optional score, so strip everything else or action validation
    // rejects the extra fields ("schema does not have field matchedCount").
    const sanitized: AgentMatchCandidate[] = candidates.map((c) => {
        const candidate: AgentMatchCandidate = {
            schemaName: c.schemaName,
            actionName: c.actionName,
        };
        if (c.score !== undefined) {
            candidate.score = c.score;
        }
        return candidate;
    });
    const list = sanitized
        .map(
            (c, i) =>
                `${i + 1}. ${c.schemaName}.${c.actionName}` +
                (c.score !== undefined ? ` (score ${c.score.toFixed(3)})` : ""),
        )
        .join("\n");
    // When a registry neighborhood flagged this ambiguity, stamp its id(s) on
    // the card so the displayed clarify can be traced back to the source
    // cluster (e.g. while triaging which neighborhoods drive clarifies).
    const trace =
        neighborhoodIds !== undefined && neighborhoodIds.length > 0
            ? `\n(known-ambiguous neighborhood: ${neighborhoodIds.join(", ")})`
            : "";
    return {
        actionName: "clarifyMultipleAgentMatches",
        parameters: {
            request,
            candidates: sanitized,
            clarifyingQuestion:
                `Multiple agents could handle this request. Which one did you mean?\n` +
                list +
                trace,
        },
    };
}
