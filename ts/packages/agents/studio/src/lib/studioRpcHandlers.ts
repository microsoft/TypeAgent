// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    StudioRuntime,
    StudioServiceInvokeFunctions,
} from "@typeagent/core/runtime";
import type { StudioEvent } from "@typeagent/core/events";

/**
 * Per-connection dependencies for the Studio service invoke handlers. Kept as a
 * tiny interface (rather than wiring `createRpc`/`ws` directly) so the handlers
 * are pure and unit-testable with an in-memory channel and a stub runtime.
 */
export interface StudioServiceConnection {
    /** Resolve the per-workspace runtime for a request's `repoRoot`. */
    getRuntime(repoRoot?: string): StudioRuntime;
    /** Push a live event to *this* connection's client (server→client). */
    pushEvent(event: StudioEvent): void;
    /** Register a disposable released when the connection closes. */
    addDisposable(disposable: { dispose(): void }): void;
}

/**
 * Build the typed invoke handlers the Studio service exposes over the channel.
 * Each handler is repo-scoped via its leading `repoRoot` argument.
 */
export function createStudioInvokeHandlers(
    conn: StudioServiceConnection,
): StudioServiceInvokeFunctions {
    return {
        async getStudioInfo(repoRoot) {
            const runtime = conn.getRuntime(repoRoot);
            return {
                repoRootInfo: runtime.getRepoRootInfo(),
                agentLocations: await runtime.getAgentLocations(),
            };
        },
        async listCollisions(repoRoot, filter) {
            return conn.getRuntime(repoRoot).listCollisions(filter);
        },
        async queryRecentEvents(repoRoot, limit) {
            return conn.getRuntime(repoRoot).queryRecentEvents(limit);
        },
        async subscribeEvents(repoRoot) {
            // Subscribe this connection to the repo's event stream; the
            // disposable is released when the socket closes so we don't leak
            // listeners or cross repos.
            const disposable = conn
                .getRuntime(repoRoot)
                .onAnyEvent((event: StudioEvent) => conn.pushEvent(event));
            conn.addDisposable(disposable);
        },
    };
}
