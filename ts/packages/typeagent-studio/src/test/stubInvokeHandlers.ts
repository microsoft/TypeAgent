// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioServiceInvokeFunctions } from "@typeagent/core/runtime";
import type { SandboxStatus } from "@typeagent/core/sandbox";

const RUNNING = { id: "studio-default", agents: [], state: "running" } as
    unknown as SandboxStatus;

/**
 * Full {@link StudioServiceInvokeFunctions} with harmless defaults, so test
 * stub servers only override the handful of methods a test exercises (keeps the
 * stubs complete as the protocol grows without per-test churn).
 */
export function stubInvokeHandlers(
    overrides: Partial<StudioServiceInvokeFunctions> = {},
): StudioServiceInvokeFunctions {
    return {
        getStudioInfo: async () => ({
            repoRootInfo: { repoRoot: "/repo/ts", agentsDirFound: true },
            agentLocations: [],
        }),
        listCollisions: async () => [],
        scanGrammarCollisions: async () => ({
            scanned: [],
            skipped: [],
            collisionCount: 0,
        }),
        clearCollisions: async () => 0,
        queryRecentEvents: async () => [],
        listCorpusAgents: async () => [],
        replayCorpus: async () => ({
            runId: "r",
            summary: {} as never,
            rows: [],
        }),
        subscribeEvents: async () => {},
        unsubscribeEvents: async () => {},
        listSandboxes: async () => [],
        listAvailableAgents: async () => [],
        startSandbox: async () => RUNNING,
        stopSandbox: async () => {},
        restartSandbox: async () => {},
        loadSandboxAgent: async () => RUNNING,
        unloadSandboxAgent: async () => RUNNING,
        refreshSandboxAgent: async () => 0,
        restoreSandboxes: async () => {},
        ...overrides,
    };
}
