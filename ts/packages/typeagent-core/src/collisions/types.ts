// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { EventEmitterLike } from "../events/eventStream.js";
import type {
    CollisionDetectedEvent,
    CollisionDetectionPoint,
    CollisionKind,
    CollisionParticipant,
} from "../events/types.js";

export interface CollisionStoreEntry {
    event: CollisionDetectedEvent;
    source: "studio" | "dispatcher" | "grammar-tools";
}

export interface CollisionFilter {
    sandboxId?: string;
    detectionPoint?: CollisionDetectionPoint;
    kind?: CollisionKind;
    agent?: string;
    since?: number;
    until?: number;
}

export interface CollisionService {
    report(event: CollisionDetectedEvent): CollisionDetectedEvent;
    list(filter?: CollisionFilter): CollisionDetectedEvent[];
    clear(filter?: CollisionFilter): number;
    /** Map + store a dispatcher collision record. */
    fromDispatcher(
        event: DispatcherCollisionEventLike,
        opts?: DispatcherCollisionMapOptions,
    ): CollisionDetectedEvent;
    /** Map + store a grammar-tools collision record. */
    fromGrammarTools(
        collision: GrammarToolCollisionLike,
        opts?: GrammarCollisionMapOptions,
    ): CollisionDetectedEvent;
}

/** Minimal shape derived from dispatcher collision telemetry in main. */
export interface DispatcherCollisionCandidateLike {
    schemaName: string;
    actionName: string;
}

export interface DispatcherCollisionEventLike {
    kind: "static" | "grammarMatch" | "llmSelect" | "fuzzy";
    timestamp?: number;
    requestId?: string;
    experimentId?: string;
    candidates: DispatcherCollisionCandidateLike[];
    chosen?: DispatcherCollisionCandidateLike;
    classifier?: "distinctActions" | "tiedHeuristics";
}

/** Minimal shape from grammarTools collision scanner result record. */
export interface GrammarToolCollisionLike {
    schemaA: string;
    schemaB: string;
    witnessText: string;
    rulePatternA?: string;
    rulePatternB?: string;
}

export interface CollisionServiceOptions {
    emitter?: EventEmitterLike;
    now?: () => number;
    defaultSandboxId?: string;
}

export interface DispatcherCollisionMapOptions {
    sandboxId?: string;
    detectionPoint?: CollisionDetectionPoint;
}

export interface GrammarCollisionMapOptions {
    sandboxId?: string;
    detectionPoint?: CollisionDetectionPoint;
    ts?: number;
    experimentId?: string;
}

export function makeParticipant(
    agent: string,
    actionType: string,
    file = "<unknown>",
    range: [number, number] = [1, 1],
): CollisionParticipant {
    return {
        agent,
        actionType,
        file,
        range,
    };
}
