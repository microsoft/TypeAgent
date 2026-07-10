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
    /**
     * Install this connection's single live event subscription, disposing any
     * prior one. Pass `undefined` to cancel. The server owns exactly one such
     * subscription per connection (so `subscribeEvents` is idempotent and
     * `unsubscribeEvents` is a clean cancellation).
     */
    setEventSubscription(disposable: { dispose(): void } | undefined): void;
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
            // JSON coerces a trailing `undefined` arg to `null` on the wire;
            // map it back so runtime default-parameter values apply.
            return conn
                .getRuntime(repoRoot)
                .listCollisions(filter ?? undefined);
        },
        async scanGrammarCollisions(repoRoot, request) {
            return conn
                .getRuntime(repoRoot)
                .scanGrammarCollisions(request ?? undefined);
        },
        async clearCollisions(repoRoot, filter) {
            return conn
                .getRuntime(repoRoot)
                .clearCollisions(filter ?? undefined);
        },
        async queryRecentEvents(repoRoot, limit) {
            return conn
                .getRuntime(repoRoot)
                .queryRecentEvents(limit ?? undefined);
        },
        async listCorpusAgents(repoRoot) {
            return conn.getRuntime(repoRoot).listCorpusAgents();
        },
        async canValidateWildcards(repoRoot, agent) {
            return conn.getRuntime(repoRoot).canValidateWildcards(agent);
        },
        async listCorpusEntries(repoRoot, agent) {
            return conn.getRuntime(repoRoot).listCorpusEntries(agent);
        },
        async seedInRepoCorpus(repoRoot, agent) {
            return conn.getRuntime(repoRoot).seedInRepoCorpus(agent);
        },
        async importCorpusFromLogs(repoRoot, request) {
            return conn.getRuntime(repoRoot).importCorpusFromLogs(request);
        },
        async addExternalCorpusSource(repoRoot, spec) {
            return conn.getRuntime(repoRoot).addExternalCorpusSource(spec);
        },
        async recordFeedback(repoRoot, input) {
            return conn.getRuntime(repoRoot).recordFeedback(input);
        },
        async replayCorpus(repoRoot, request) {
            const result = await conn
                .getRuntime(repoRoot)
                .replayCorpus(request);
            // Bound the rows crossing the wire; `summary` keeps the full totals
            // so the client can show "first N of M".
            const MAX_ROWS = 1000;
            return result.rows.length > MAX_ROWS
                ? { ...result, rows: result.rows.slice(0, MAX_ROWS) }
                : result;
        },
        async subscribeEvents(repoRoot) {
            // Subscribe this connection to the repo's event stream. Installing
            // replaces any prior subscription (idempotent — never stacks
            // duplicate listeners) and the server releases it on socket close.
            const disposable = conn
                .getRuntime(repoRoot)
                .onAnyEvent((event: StudioEvent) => conn.pushEvent(event));
            conn.setEventSubscription(disposable);
        },
        async unsubscribeEvents() {
            conn.setEventSubscription(undefined);
        },
        async listSandboxes(repoRoot) {
            return conn.getRuntime(repoRoot).listSandboxes();
        },
        async listAvailableAgents(repoRoot) {
            return conn.getRuntime(repoRoot).listAvailableAgents();
        },
        async startSandbox(repoRoot, options) {
            return conn.getRuntime(repoRoot).startSandbox(options ?? undefined);
        },
        async stopSandbox(repoRoot, id) {
            return conn.getRuntime(repoRoot).stopSandbox(id);
        },
        async restartSandbox(repoRoot, id) {
            return conn.getRuntime(repoRoot).restartSandbox(id);
        },
        async loadSandboxAgent(repoRoot, id, agentRef) {
            return conn.getRuntime(repoRoot).loadSandboxAgent(id, agentRef);
        },
        async unloadSandboxAgent(repoRoot, id, agentName) {
            return conn.getRuntime(repoRoot).unloadSandboxAgent(id, agentName);
        },
        async refreshSandboxAgent(repoRoot, agentName) {
            return conn.getRuntime(repoRoot).refreshSandboxAgent(agentName);
        },
        async restoreSandboxes(repoRoot) {
            return conn.getRuntime(repoRoot).restoreSandboxes();
        },
    };
}
