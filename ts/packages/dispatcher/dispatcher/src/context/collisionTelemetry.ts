// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import registerDebug from "debug";
import type { CollisionStrategy } from "./session.js";

export type { CollisionStrategy } from "./session.js";

const debugCollision = registerDebug("typeagent:dispatcher:collision");

/** Filename appended within a session directory for collision events. */
export const COLLISION_EVENTS_FILE = "collision-events.jsonl";

/**
 * Minimal Logger shape we depend on — matches `Logger.logEvent` from
 * `packages/telemetry/src/logger/logger.ts` without importing the type
 * (avoids a cross-package import cycle and keeps the host stub trivial
 * for tests).
 */
export type CollisionLogger = {
    logEvent(eventName: string, entry: Record<string, unknown>): void;
};

export type CollisionEventKind =
    | "static"
    | "grammarMatch"
    | "llmSelect"
    | "fuzzy";

/**
 * One candidate participating in a collision.
 *
 * The optional heuristic counters mirror cache `MatchResult` fields so
 * downstream telemetry analysis can reconstruct alternative rankings
 * (e.g. counterfactual `score-rank` outcomes) without re-running the
 * matcher.  Populated by the runtime detection points (grammarMatch /
 * llmSelect); left undefined for static and fuzzy where the concept
 * doesn't apply.
 */
export type CollisionCandidate = {
    schemaName: string;
    actionName: string;
    /** Optional generic score (used by llmSelect: cosine similarity etc.). */
    score?: number;
    /** From cache MatchResult — token-level matched count. */
    matchedCount?: number;
    /** From cache MatchResult — non-optional matched count. */
    nonOptionalCount?: number;
    /** From cache MatchResult — wildcard char span. */
    wildcardCharCount?: number;
    /**
     * Optional positional rank under the agent priority order
     * (`collision.priorityOrder`); 0 = highest priority.
     */
    priorityRank?: number;
};

export type CollisionEvent = {
    kind: CollisionEventKind;
    timestamp: number;
    request?: string | undefined;
    /**
     * Correlation key tying this event to other events from the same
     * user request (e.g. a `grammarMatch` collision followed by a
     * `user-clarify` follow-up event).  Auto-filled from the host's
     * `currentRequestId` when not explicitly set.
     */
    requestId?: string | undefined;
    candidates: CollisionCandidate[];
    chosen?: CollisionCandidate | undefined;
    /**
     * What `first-match` would have picked.  Lets downstream queries
     * answer "did the experiment strategy pick differently?" without
     * replaying the request.  Populated by runtime detection points;
     * undefined for static (where there's no runtime ranking).
     */
    firstMatchCandidate?: CollisionCandidate | undefined;
    strategy: CollisionStrategy | "warn" | "error" | "downgraded";
    /**
     * For `kind="grammarMatch"`: which classifier flagged this collision
     * (`distinctActions` vs `tiedHeuristics`).  Helps decide whether to
     * default to one classifier over the other based on real traffic.
     */
    classifier?: "distinctActions" | "tiedHeuristics" | undefined;
    elapsedMs?: number | undefined;
    note?: string | undefined;
    /**
     * Tester-set tag for grouping events into an experiment window.  Auto-
     * filled from `collision.telemetry.experimentId` when the tester has
     * set one; useful in Cosmos queries to slice events by `E1.2`,
     * `E2.1`, etc.  Empty string treated as undefined.
     */
    experimentId?: string | undefined;
    /**
     * Dispatcher session identifier (basename of the session directory).
     * Lets per-tester analysis filter on this single field instead of
     * joining other tables.  Auto-filled from the host's session.
     */
    sessionId?: string | undefined;
};

const RING_BUFFER_SIZE = 50;

/**
 * Minimal context shape required by the telemetry sink. Decoupled from
 * CommandHandlerContext so tests can pass a stub.
 */
export type CollisionTelemetryHost = {
    collisionEvents: CollisionEvent[];
    /**
     * Optional — when present the emit fills `requestId` automatically.
     * Typed as `unknown` so the host can pass whatever shape the
     * dispatcher uses (string | number | object) without coupling this
     * module to the RequestId type; the emit stringifies it.
     */
    currentRequestId?: unknown;
    /**
     * Optional — when present and `collision.telemetry.emit` is true,
     * each emitted event is forwarded as `logEvent("collision", event)`.
     * Reaches the existing dispatcher sinks (debug log + Cosmos when
     * `@config log db on`).
     */
    logger?: CollisionLogger | undefined;
    session: {
        /**
         * Optional — when present the emit fills `sessionId` automatically
         * with `path.basename(sessionDirPath)`.
         */
        sessionDirPath?: string | undefined;
        getConfig(): {
            collision: {
                telemetry: {
                    emit: boolean;
                    debugLog: boolean;
                    experimentId?: string | undefined;
                };
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
    // Auto-fill the cross-cutting fields (requestId, experimentId,
    // sessionId) so each call site only has to populate the stuff that's
    // detection-point-specific.  Explicit values on the `event` win.
    const sessionDir = host.session.sessionDirPath;
    const sessionId =
        event.sessionId ??
        (sessionDir
            ? sessionDir.split(/[\\/]/).filter(Boolean).pop()
            : undefined);
    const experimentIdRaw = cfg.experimentId?.trim();
    const experimentId =
        event.experimentId ?? (experimentIdRaw ? experimentIdRaw : undefined);
    const requestId =
        event.requestId ?? stringifyRequestId(host.currentRequestId);

    const stamped: CollisionEvent = {
        ...event,
        timestamp: event.timestamp ?? Date.now(),
        requestId,
        experimentId,
        sessionId,
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
        // Forward to the dispatcher logger when present.  The DB sink
        // self-gates on `dblogging`, so events only reach Cosmos when the
        // tester has run `@config log db on`; the debug sink always
        // captures locally.  Wrapped so a sink misbehaving never disrupts
        // the colliding request.
        if (host.logger) {
            try {
                host.logger.logEvent(
                    "collision",
                    stamped as unknown as Record<string, unknown>,
                );
            } catch (err) {
                debugCollision(
                    `logger.logEvent threw — collision event captured locally only: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
        // Append to the per-session JSONL so events survive shell exit
        // even when the Cosmos sink is off (e.g. a tester without DB
        // credentials).  The ring buffer alone caps at RING_BUFFER_SIZE
        // and is in-memory only.
        if (sessionDir) {
            appendCollisionToFile(sessionDir, stamped);
        }
    }
}

/**
 * Append one collision event as a JSONL line to
 * `<sessionDir>/collision-events.jsonl`.  Sync I/O — the volume is low
 * (one call per detected collision) and matches the synchronous emit
 * call shape.  All errors are swallowed and logged via the debug
 * channel so a filesystem hiccup never crashes the colliding request.
 */
function appendCollisionToFile(
    sessionDir: string,
    event: CollisionEvent,
): void {
    try {
        const filePath = path.join(sessionDir, COLLISION_EVENTS_FILE);
        fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
        debugCollision(
            `appendCollisionToFile failed — event captured in memory only: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

/**
 * Stringify whatever shape the host uses for request IDs.  The dispatcher's
 * `RequestId` is `{ connectionId?, requestId }`; older callers pass a plain
 * string.  Treat any other shape as `undefined` rather than guessing.
 */
function stringifyRequestId(id: unknown): string | undefined {
    if (id === undefined || id === null) return undefined;
    if (typeof id === "string") return id || undefined;
    if (typeof id === "number") return String(id);
    if (typeof id === "object") {
        const obj = id as { requestId?: unknown };
        if (typeof obj.requestId === "string" && obj.requestId) {
            return obj.requestId;
        }
    }
    return undefined;
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
