// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CollisionDetectedEvent } from "@typeagent/core/events";
import type { StudioCollisionScanResult } from "@typeagent/core/runtime";
import { StudioServiceClient } from "./studioServiceClient.js";

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
 * Channel-backed {@link CollisionsSource}: the Option-B path where the
 * Collisions view reads from the `studio` agent's runtime over the service
 * channel. Live `collision.detected` and `sandbox.agent.loaded/unloaded` pushes
 * arrive on the single per-connection event subscription and are fanned out to
 * the right local listeners. Owns its {@link StudioServiceClient}; {@link
 * dispose} closes the socket.
 */
export class StudioServiceCollisionsSource implements CollisionsSource {
    private constructor(
        private readonly client: StudioServiceClient,
        private readonly collisionListeners: Set<() => void>,
        private readonly agentLoadListeners: Set<() => void>,
    ) {}

    static async connect(options: {
        repoRoot?: string;
        agentServerUrl?: string;
        endpoint?: string;
        onClosed?: () => void;
    }): Promise<StudioServiceCollisionsSource | undefined> {
        const collisionListeners = new Set<() => void>();
        const agentLoadListeners = new Set<() => void>();
        const client = await StudioServiceClient.connect({
            repoRoot: options.repoRoot,
            agentServerUrl: options.agentServerUrl,
            endpoint: options.endpoint,
            onEvent: (event) => {
                if (event.type === "collision.detected") {
                    for (const l of collisionListeners) l();
                } else if (
                    event.type === "sandbox.agent.loaded" ||
                    event.type === "sandbox.agent.unloaded"
                ) {
                    for (const l of agentLoadListeners) l();
                }
            },
            onClose: options.onClosed,
        });
        if (client === undefined) {
            return undefined;
        }
        await client.subscribeEvents();
        return new StudioServiceCollisionsSource(
            client,
            collisionListeners,
            agentLoadListeners,
        );
    }

    listCollisions(): Promise<CollisionDetectedEvent[]> {
        return this.client.listCollisions();
    }

    scanGrammarCollisions(): Promise<StudioCollisionScanResult> {
        return this.client.scanGrammarCollisions();
    }

    clearCollisions(): Promise<number> {
        return this.client.clearCollisions();
    }

    onCollisionDetected(listener: () => void): { dispose(): void } {
        this.collisionListeners.add(listener);
        return { dispose: () => this.collisionListeners.delete(listener) };
    }

    onAgentLoadChanged(listener: () => void): { dispose(): void } {
        this.agentLoadListeners.add(listener);
        return { dispose: () => this.agentLoadListeners.delete(listener) };
    }

    dispose(): void {
        this.collisionListeners.clear();
        this.agentLoadListeners.clear();
        this.client.close();
    }
}
