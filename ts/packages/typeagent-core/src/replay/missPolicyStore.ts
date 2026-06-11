// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ReplayMissPolicy } from "./types.js";

const DEFAULT_MISS_POLICY: ReplayMissPolicy = "needs-explanation";

export interface ReplayPolicyStore {
    get(workspaceId: string): ReplayMissPolicy;
    set(workspaceId: string, policy: ReplayMissPolicy): void;
}

/**
 * F0.8 lightweight per-workspace miss-policy store.
 *
 * Persistence to VS Code memento/configuration lives in the extension layer;
 * this typeagent-core store is intentionally in-memory and deterministic.
 */
export class InMemoryReplayPolicyStore implements ReplayPolicyStore {
    private readonly byWorkspace = new Map<string, ReplayMissPolicy>();

    get(workspaceId: string): ReplayMissPolicy {
        return this.byWorkspace.get(workspaceId) ?? DEFAULT_MISS_POLICY;
    }

    set(workspaceId: string, policy: ReplayMissPolicy): void {
        this.byWorkspace.set(workspaceId, policy);
    }
}

export function isReplayMissPolicy(value: string): value is ReplayMissPolicy {
    return (
        value === "needs-explanation" ||
        value === "live-llm" ||
        value === "strict-cache"
    );
}

export function normalizeReplayMissPolicy(
    value: string | undefined,
): ReplayMissPolicy {
    if (!value) {
        return DEFAULT_MISS_POLICY;
    }
    return isReplayMissPolicy(value) ? value : DEFAULT_MISS_POLICY;
}
