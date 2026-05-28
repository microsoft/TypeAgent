// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    EVENT_SCHEMA_VERSION,
    type CollisionDetectedEvent,
    type CollisionDetectionPoint,
    type CollisionKind,
} from "../events/types.js";
import type {
    CollisionFilter,
    CollisionService,
    CollisionServiceOptions,
    DispatcherCollisionEventLike,
    DispatcherCollisionMapOptions,
    GrammarCollisionMapOptions,
    GrammarToolCollisionLike,
} from "./types.js";
import { makeParticipant } from "./types.js";

export class InProcessCollisionService implements CollisionService {
    private readonly events: CollisionDetectedEvent[] = [];
    private readonly emitter;
    private readonly now: () => number;
    private readonly defaultSandboxId: string;

    constructor(opts: CollisionServiceOptions = {}) {
        this.emitter = opts.emitter;
        this.now = opts.now ?? Date.now;
        this.defaultSandboxId = opts.defaultSandboxId ?? "studio";
    }

    report(event: CollisionDetectedEvent): CollisionDetectedEvent {
        this.events.push(event);
        this.emitter?.emit(event);
        return event;
    }

    list(filter: CollisionFilter = {}): CollisionDetectedEvent[] {
        return this.events.filter((e) => matchesFilter(e, filter));
    }

    clear(filter: CollisionFilter = {}): number {
        if (Object.keys(filter).length === 0) {
            const n = this.events.length;
            this.events.length = 0;
            return n;
        }
        const before = this.events.length;
        const keep = this.events.filter((e) => !matchesFilter(e, filter));
        this.events.length = 0;
        this.events.push(...keep);
        return before - keep.length;
    }

    fromDispatcher(
        event: DispatcherCollisionEventLike,
        opts: DispatcherCollisionMapOptions = {},
    ): CollisionDetectedEvent {
        const detectionPoint =
            opts.detectionPoint ?? mapDispatcherDetectionPoint(event.kind);
        const kind = mapDispatcherKind(event.kind, event.classifier);
        const participants = event.candidates.map((c) =>
            makeParticipant(c.schemaName, `${c.schemaName}.${c.actionName}`),
        );

        const mapped: CollisionDetectedEvent = {
            schemaVersion: EVENT_SCHEMA_VERSION,
            type: "collision.detected",
            ts: event.timestamp ?? this.now(),
            sandboxId: opts.sandboxId ?? this.defaultSandboxId,
            kind,
            detectionPoint,
            participants,
            ...(event.requestId !== undefined
                ? { requestId: event.requestId }
                : {}),
            ...(event.experimentId !== undefined
                ? { experimentId: event.experimentId }
                : {}),
        };
        return this.report(mapped);
    }

    fromGrammarTools(
        collision: GrammarToolCollisionLike,
        opts: GrammarCollisionMapOptions = {},
    ): CollisionDetectedEvent {
        const mapped: CollisionDetectedEvent = {
            schemaVersion: EVENT_SCHEMA_VERSION,
            type: "collision.detected",
            ts: opts.ts ?? this.now(),
            sandboxId: opts.sandboxId ?? this.defaultSandboxId,
            kind: "overlap",
            detectionPoint: opts.detectionPoint ?? "grammar-edit",
            participants: [
                makeParticipant(
                    collision.schemaA,
                    collision.schemaA,
                    collision.rulePatternA ?? "<grammar>",
                ),
                makeParticipant(
                    collision.schemaB,
                    collision.schemaB,
                    collision.rulePatternB ?? "<grammar>",
                ),
            ],
            exemplarUtterances: [collision.witnessText],
            ...(opts.experimentId !== undefined
                ? { experimentId: opts.experimentId }
                : {}),
        };
        return this.report(mapped);
    }
}

function mapDispatcherKind(
    kind: DispatcherCollisionEventLike["kind"],
    classifier?: DispatcherCollisionEventLike["classifier"],
): CollisionKind {
    switch (kind) {
        case "static":
            return "overlap";
        case "fuzzy":
            return "shadow";
        case "grammarMatch":
            return classifier === "tiedHeuristics" ? "ambiguity" : "overlap";
        case "llmSelect":
            return "ambiguity";
        default:
            return "ambiguity";
    }
}

function mapDispatcherDetectionPoint(
    kind: DispatcherCollisionEventLike["kind"],
): CollisionDetectionPoint {
    switch (kind) {
        case "static":
            return "load";
        case "grammarMatch":
            return "grammar-edit";
        case "llmSelect":
        case "fuzzy":
            return "replay";
        default:
            return "replay";
    }
}

function matchesFilter(
    event: CollisionDetectedEvent,
    filter: CollisionFilter,
): boolean {
    if (filter.sandboxId && event.sandboxId !== filter.sandboxId) {
        return false;
    }
    if (filter.detectionPoint && event.detectionPoint !== filter.detectionPoint) {
        return false;
    }
    if (filter.kind && event.kind !== filter.kind) {
        return false;
    }
    if (filter.agent) {
        const has = event.participants.some((p) => p.agent === filter.agent);
        if (!has) {
            return false;
        }
    }
    if (filter.since !== undefined && event.ts < filter.since) {
        return false;
    }
    if (filter.until !== undefined && event.ts > filter.until) {
        return false;
    }
    return true;
}
