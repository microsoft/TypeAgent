// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared prompt helpers for lever propose calls. Centralizes:
//   1. Member-list formatting — present (schemaName, actionName) as two
//      explicit fields so the LLM can't confuse a dotted schema name
//      (e.g. `code.code-debug.removeBreakpoint`) for a parent of itself.
//   2. Response validation — confirm the LLM's `targetSchema`/
//      `targetAction` pair references an actual member. Hypotheses that
//      target non-members are dropped (with a brief log) rather than
//      crashing the lever's apply step downstream.

import registerDebug from "debug";

import type { NeighborhoodMember } from "../../types.js";

const debug = registerDebug("typeagent:collision:optimize:prompt");

/**
 * Render the neighborhood's members as a structured block the LLM can't
 * misparse. Each member gets its (schemaName, actionName) pair as
 * explicit fields. Followed by a list of allowed targetSchema values.
 */
export function formatMembersBlock(members: NeighborhoodMember[]): string {
    const lines: string[] = [];
    for (let i = 0; i < members.length; i++) {
        const m = members[i]!;
        lines.push(
            `Member ${i + 1}: schemaName="${m.schemaName}" actionName="${m.actionName}"`,
        );
    }
    lines.push("");
    lines.push(
        `In your response, targetSchema MUST be one of: ${members
            .map((m) => `"${m.schemaName}"`)
            .join(", ")}.`,
    );
    lines.push(
        `targetAction MUST be the EXACT actionName of the member you chose (do NOT prefix with the schemaName, do NOT modify casing).`,
    );
    return lines.join("\n");
}

/**
 * Validate the LLM's (targetSchema, targetAction) pair against the
 * neighborhood's members. Returns true if the pair matches a member.
 * Logs and returns false otherwise so the caller can drop the
 * hypothesis without crashing.
 */
export function isValidMemberReference(
    members: NeighborhoodMember[],
    targetSchema: unknown,
    targetAction: unknown,
): boolean {
    if (typeof targetSchema !== "string" || typeof targetAction !== "string") {
        debug(
            `rejecting: non-string targetSchema/targetAction (got ${typeof targetSchema}/${typeof targetAction})`,
        );
        return false;
    }
    const match = members.some(
        (m) => m.schemaName === targetSchema && m.actionName === targetAction,
    );
    if (!match) {
        debug(
            `rejecting: (${targetSchema}, ${targetAction}) is not a member of [${members
                .map((m) => `(${m.schemaName}, ${m.actionName})`)
                .join(", ")}]`,
        );
    }
    return match;
}
