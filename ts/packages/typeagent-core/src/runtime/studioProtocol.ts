// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent, CollisionDetectedEvent } from "../events/index.js";
import type { CollisionFilter } from "../collisions/index.js";
import type { SandboxStatus } from "../sandbox/index.js";
import type { CorpusEntry, ExternalSourceSpec } from "../corpus/index.js";
import type { FeedbackRecordInput } from "../feedback/index.js";
import type { RepoRootResolution } from "./repoRootResolver.js";
import type {
    AgentLocation,
    AvailableAgent,
    StudioReplayRequest,
    StudioReplayResult,
    StudioCollisionScanRequest,
    StudioCollisionScanResult,
} from "./studioRuntimeCore.js";

/**
 * Wire types for the Studio service channel — the typed protocol the standalone,
 * per-workspace Studio service serves over its WebSocket and the
 * `typeagent-studio` extension (and the `studio` agent proxy, and any other rich
 * client) consumes.
 *
 * These are **pure data / function-map types** with no transport dependency:
 * `@typeagent/core` must not depend on `agent-rpc`. The server and client
 * modules pair these with `createRpc` from `agent-rpc` separately.
 *
 * Repo scoping: the Studio runtime is per-workspace (one per resolved repo
 * root), so **every request carries `repoRoot`** and the event subscription is
 * per-connection — a client for one repo must never receive another repo's
 * events.
 */

/** Result of the service-level `getStudioInfo` (composes two runtime reads). */
export interface StudioInfo {
    repoRootInfo: RepoRootResolution;
    agentLocations: AgentLocation[];
}

/**
 * Client → server requests (request/response). The leading `repoRoot` selects
 * the target workspace runtime; omit to use the service's default
 * (`TYPEAGENT_STUDIO_REPO_ROOT` / cwd).
 */
export type StudioServiceInvokeFunctions = {
    /** Repo root + the agent search locations Studio scans. */
    getStudioInfo(repoRoot?: string): Promise<StudioInfo>;
    /** Known cross-schema grammar collisions (newest first). */
    listCollisions(
        repoRoot?: string,
        filter?: CollisionFilter,
    ): Promise<CollisionDetectedEvent[]>;
    /**
     * Scan agents' compiled grammars for cross-schema collisions (read-only
     * analysis — reads compiled grammars, reports into the collision store; no
     * agent/sandbox mutation).
     */
    scanGrammarCollisions(
        repoRoot?: string,
        request?: StudioCollisionScanRequest,
    ): Promise<StudioCollisionScanResult>;
    /** Remove stored collisions matching the filter (all when omitted). */
    clearCollisions(
        repoRoot?: string,
        filter?: CollisionFilter,
    ): Promise<number>;
    /** Most recent structured Studio events, oldest-to-newest. */
    queryRecentEvents(
        repoRoot?: string,
        limit?: number,
    ): Promise<StudioEvent[]>;
    /** Corpus agents available for replay in this workspace. */
    listCorpusAgents(repoRoot?: string): Promise<string[]>;
    /**
     * Federated corpus entries for an agent (in-repo, captures, external,
     * feedback) — what the Corpus tree expands.
     */
    listCorpusEntries(
        repoRoot: string | undefined,
        agent: string,
    ): Promise<CorpusEntry[]>;
    /**
     * Ensure an agent's in-repo corpus file exists so it can be populated;
     * returns its path and whether it was newly created.
     */
    seedInRepoCorpus(
        repoRoot: string | undefined,
        agent: string,
    ): Promise<{ path: string; created: boolean }>;
    /**
     * Register an external JSONL corpus source for an agent. Throws if a source
     * with the same name already exists for the agent.
     */
    addExternalCorpusSource(
        repoRoot: string | undefined,
        spec: ExternalSourceSpec,
    ): Promise<void>;
    /**
     * Record a thumbs-up/down feedback row (emits `feedback.recorded`; surfaces
     * in the agent's federated corpus when an utterance is supplied).
     */
    recordFeedback(
        repoRoot: string | undefined,
        input: FeedbackRecordInput,
    ): Promise<void>;
    /**
     * Replay an agent's corpus comparing two versions (read-only analysis — the
     * Impact Report contract). `request.agent` is required; the rows array is
     * bounded for transport while `summary` retains the full totals.
     */
    replayCorpus(
        repoRoot: string | undefined,
        request: StudioReplayRequest,
    ): Promise<StudioReplayResult>;
    /**
     * Start pushing live `studioEvent` calls to *this* connection for the given
     * repo. Idempotent per connection: a second call replaces the connection's
     * single subscription (it never stacks duplicate listeners). The
     * subscription is released when the connection closes or via
     * {@link unsubscribeEvents}.
     */
    subscribeEvents(repoRoot?: string): Promise<void>;
    /**
     * Cancel this connection's live event subscription, if any. Idempotent — a
     * no-op when not subscribed.
     */
    unsubscribeEvents(): Promise<void>;

    // --- Sandbox lifecycle (mutating; the channel is capability-token gated and
    // the extension client represents a human action, so no per-call approval —
    // the AI/MCP action surface is where the dryRun/approval boundary lives). ---

    /** Sandboxes currently running in the agent runtime. */
    listSandboxes(repoRoot?: string): Promise<SandboxStatus[]>;
    /** Agents available to load (name + manifest emoji), discovered from disk. */
    listAvailableAgents(repoRoot?: string): Promise<AvailableAgent[]>;
    startSandbox(
        repoRoot: string | undefined,
        options?: { id?: string; agents?: string[] },
    ): Promise<SandboxStatus>;
    stopSandbox(repoRoot: string | undefined, id: string): Promise<void>;
    restartSandbox(repoRoot: string | undefined, id: string): Promise<void>;
    loadSandboxAgent(
        repoRoot: string | undefined,
        id: string,
        agentRef: string,
    ): Promise<SandboxStatus>;
    unloadSandboxAgent(
        repoRoot: string | undefined,
        id: string,
        agentName: string,
    ): Promise<SandboxStatus>;
    /** Re-load a named agent everywhere it's loaded; returns sandboxes touched. */
    refreshSandboxAgent(
        repoRoot: string | undefined,
        agentName: string,
    ): Promise<number>;
    /** Re-create sandboxes from the agent runtime's persisted snapshot. */
    restoreSandboxes(repoRoot?: string): Promise<void>;
};

/** Server → client pushes. */
export type StudioClientCallFunctions = {
    /** A live structured Studio event (reuses the core event union). */
    studioEvent(event: StudioEvent): void;
};
