// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import type { CollisionStrategy } from "./session.js";

export type { CollisionStrategy } from "./session.js";

const debugCollision = registerDebug("typeagent:dispatcher:collision");

export type CollisionEventKind =
    | "static"
    | "grammarMatch"
    | "llmSelect"
    | "fuzzy";

export type CollisionCandidate = {
    schemaName: string;
    actionName: string;
    score?: number;
};

export type CollisionEvent = {
    kind: CollisionEventKind;
    timestamp: number;
    request?: string | undefined;
    candidates: CollisionCandidate[];
    chosen?: CollisionCandidate | undefined;
    strategy: CollisionStrategy | "warn" | "error" | "downgraded";
    elapsedMs?: number | undefined;
    note?: string | undefined;
};

const RING_BUFFER_SIZE = 50;

/**
 * Minimal context shape required by the telemetry sink. Decoupled from
 * CommandHandlerContext so tests can pass a stub.
 */
export type CollisionTelemetryHost = {
    collisionEvents: CollisionEvent[];
    session: {
        getConfig(): {
            collision: {
                telemetry: { emit: boolean; debugLog: boolean };
            };
        };
    };
};

export function createCollisionRingBuffer(): CollisionEvent[] {
    return [];
}

export function emitCollisionEvent(
    event: Omit<CollisionEvent, "timestamp"> & { timestamp?: number },
    host: CollisionTelemetryHost,
): void {
    const cfg = host.session.getConfig().collision.telemetry;
    if (!cfg.emit && !cfg.debugLog) {
        return;
    }
    const stamped: CollisionEvent = {
        ...event,
        timestamp: event.timestamp ?? Date.now(),
    };
    if (cfg.debugLog) {
        const candidateSummary = stamped.candidates
            .map(
                (c) =>
                    `${c.schemaName}.${c.actionName}` +
                    (c.score !== undefined ? `@${c.score.toFixed(3)}` : ""),
            )
            .join(", ");
        const chosen = stamped.chosen
            ? `${stamped.chosen.schemaName}.${stamped.chosen.actionName}`
            : "<none>";
        debugCollision(
            `[${stamped.kind}] strategy=${stamped.strategy} candidates=[${candidateSummary}] chose=${chosen}` +
                (stamped.note ? ` note=${stamped.note}` : "") +
                (stamped.elapsedMs !== undefined
                    ? ` (${stamped.elapsedMs.toFixed(1)}ms)`
                    : ""),
        );
    }
    if (cfg.emit) {
        host.collisionEvents.push(stamped);
        if (host.collisionEvents.length > RING_BUFFER_SIZE) {
            host.collisionEvents.splice(
                0,
                host.collisionEvents.length - RING_BUFFER_SIZE,
            );
        }
    }
}

export function getRecentCollisionEvents(
    host: CollisionTelemetryHost,
    limit?: number,
): CollisionEvent[] {
    const buf = host.collisionEvents;
    if (limit === undefined || limit >= buf.length) {
        return buf.slice();
    }
    return buf.slice(buf.length - limit);
}
