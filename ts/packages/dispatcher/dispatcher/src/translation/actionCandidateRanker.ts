// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionSchemaTypeDefinition } from "@typeagent/action-schema";

export type ActionCandidateFilter = (
    schemaName: string,
    actionName: string,
) => boolean;

export type ActionCandidateResult = Readonly<{
    schemaName: string;
    actionName: string;
    score: number;
    definition: ActionSchemaTypeDefinition;
}>;

/**
 * Ranks action definitions without depending on a caller or transport.
 * Undefined means ranking is unavailable; an empty array is a successful
 * search with no candidates.
 */
export interface ActionCandidateRanker {
    rankActionCandidates(
        request: string,
        maxCandidates: number,
        filter: ActionCandidateFilter,
    ): Promise<ActionCandidateResult[] | undefined>;
}

export function compareActionCandidateIdentity(
    left: Pick<ActionCandidateResult, "schemaName" | "actionName">,
    right: Pick<ActionCandidateResult, "schemaName" | "actionName">,
): number {
    if (left.schemaName !== right.schemaName) {
        return left.schemaName < right.schemaName ? -1 : 1;
    }
    if (left.actionName !== right.actionName) {
        return left.actionName < right.actionName ? -1 : 1;
    }
    return 0;
}
