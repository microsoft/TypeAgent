// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CollisionDetectedEvent } from "@typeagent/core/events";
import type { StudioCollisionScanResult } from "@typeagent/core/runtime";
import type { StudioServiceConnection } from "./studioServiceConnection.js";

/**
 * The collisions surface the Collisions tree + its scan/auto-scan flow need.
 * Both the in-process `StudioRuntime` (structurally) and the channel-backed
 * {@link StudioServiceCollisionsSource} conform, so the tree can swap between
 * them (the Event Log cutover pattern).
 *
 * Every method here is read-only analysis or diagnostic-store management
 * (scanning compiled grammars, listing/clearing the collision store) — no
 * agent/sandbox mutation — so it needs no approval guardrails.
 */
export interface CollisionsSource {
    listCollisions(): Promise<CollisionDetectedEvent[]>;
    scanGrammarCollisions(): Promise<StudioCollisionScanResult>;
    clearCollisions(): Promise<number>;
    /** Fires when a collision is detected (re-read the store). */
    onCollisionDetected(listener: () => void): { dispose(): void };
    /** Fires when the loaded agent set changes (debounced auto-scan). */
    onAgentLoadChanged(listener: () => void): { dispose(): void };
}

/**
 * Channel-backed {@link CollisionsSource}: the Collisions view reads from the
 * `studio` agent's runtime over the shared service connection. Live
 * `collision.detected` and `sandbox.agent.loaded/unloaded` pushes arrive on the
 * shared connection's event fanout and are filtered to the right local
 * listeners. A thin adapter — the {@link StudioServiceConnection} owns the
 * socket and subscription.
 */
export class StudioServiceCollisionsSource implements CollisionsSource {
    constructor(private readonly connection: StudioServiceConnection) {}

    async listCollisions(): Promise<CollisionDetectedEvent[]> {
        return (await this.connection.getClient()?.listCollisions()) ?? [];
    }

    async scanGrammarCollisions(): Promise<StudioCollisionScanResult> {
        const client = this.connection.getClient();
        if (client === undefined) {
            throw new Error("Studio service is not connected.");
        }
        return client.scanGrammarCollisions();
    }

    async clearCollisions(): Promise<number> {
        return (await this.connection.getClient()?.clearCollisions()) ?? 0;
    }

    onCollisionDetected(listener: () => void): { dispose(): void } {
        return this.connection.onEvent((event) => {
            if (event.type === "collision.detected") {
                listener();
            }
        });
    }

    onAgentLoadChanged(listener: () => void): { dispose(): void } {
        return this.connection.onEvent((event) => {
            if (
                event.type === "sandbox.agent.loaded" ||
                event.type === "sandbox.agent.unloaded"
            ) {
                listener();
            }
        });
    }
}
