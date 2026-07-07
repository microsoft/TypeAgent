// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Leaf helpers over a cache `MatchResult` with no dependency on the dispatcher
// command-context. Kept separate so both the collision matcher
// (`matchCollision.ts`) and the contextSelector orchestrator
// (`matchContextSelector.ts`) can share them without importing each other or
// pulling the command-context module into their dependency cycle.

import { MatchResult } from "agent-cache";

// The primary (schema, action) of a MatchResult — its first action, with
// empty-string fallbacks when the match has no action.
export function getPrimary(match: MatchResult): {
    schemaName: string;
    actionName: string;
} {
    const first = match.match.actions[0]?.action;
    return {
        schemaName: first?.schemaName ?? "",
        actionName: first?.actionName ?? "",
    };
}
