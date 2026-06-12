// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { StudioEvent, CollisionDetectedEvent } from "../events/index.js";
import type { CollisionFilter } from "../collisions/index.js";
import type { RepoRootResolution } from "./repoRootResolver.js";
import type { AgentLocation } from "./studioRuntimeCore.js";

/**
 * Wire types for the Studio service channel — the typed protocol the `studio`
 * agent serves over its own WebSocket and the `typeagent-studio` extension (and
 * any other rich client) consumes.
 *
 * These are **pure data / function-map types** with no transport dependency:
 * `@typeagent/core` must not depend on `agent-rpc`. The server and client
 * modules pair these with `createRpc` from `agent-rpc` separately.
 *
 * Repo scoping: the Studio runtime is per-workspace (one per resolved repo
 * root), so **every request carries `repoRoot`** and the event subscription is
 * per-connection — a client for one repo must never receive another repo's
 * events. The port alone cannot disambiguate repos (`discoverPort` is
 * last-writer-wins on `(agent, role)`).
 */

/** Result of the service-level `getStudioInfo` (composes two runtime reads). */
export interface StudioInfo {
    repoRootInfo: RepoRootResolution;
    agentLocations: AgentLocation[];
}

/**
 * Client → server requests (request/response). The leading `repoRoot` selects
 * the target workspace runtime; omit to use the agent's default
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
    /** Most recent structured Studio events, oldest-to-newest. */
    queryRecentEvents(
        repoRoot?: string,
        limit?: number,
    ): Promise<StudioEvent[]>;
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
};

/** Server → client pushes. */
export type StudioClientCallFunctions = {
    /** A live structured Studio event (reuses the core event union). */
    studioEvent(event: StudioEvent): void;
};
