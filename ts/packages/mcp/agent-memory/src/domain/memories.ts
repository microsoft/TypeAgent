// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { invalidArgument } from "./errors.js";
import type { MemoryId, ScopeId, StateEventId } from "./ids.js";
import {
    createProvenance,
    requireAbsoluteTimestamp,
    requireRevision,
    requireText,
    type MemoryProvenance,
    type Revision,
} from "./metadata.js";

export type MemoryKind =
    | "fact"
    | "preference"
    | "instruction"
    | "procedure"
    | "episode"
    | "observation"
    | "summary";

export type MemoryState = "active" | "superseded" | "archived" | "forgotten";

export type MemoryRelationType =
    | "supports"
    | "contradicts"
    | "supersedes"
    | "derived_from"
    | "related_to";

export type MemoryRevision = {
    memoryId: MemoryId;
    scopeId: ScopeId;
    revision: Revision;
    kind: MemoryKind;
    content: string;
    structuredContent?: unknown;
    tags: readonly string[];
    provenance: MemoryProvenance;
    confidence?: number;
    importance: number;
    validFrom?: string;
    validUntil?: string;
    reason?: string;
    createdAt: string;
};

export type MemoryHead = {
    memoryId: MemoryId;
    scopeId: ScopeId;
    currentRevision: Revision;
    state: MemoryState;
    supersededBy?: MemoryId;
    stateChangedAt: string;
    stateReason?: string;
};

export type MemoryRelation = {
    sourceMemoryId: MemoryId;
    relationType: MemoryRelationType;
    targetMemoryId: MemoryId;
    createdAt: string;
};

export type MemoryStateEvent = {
    eventId: StateEventId;
    memoryId: MemoryId;
    fromState: MemoryState;
    toState: MemoryState;
    actorId: string;
    reason: string;
    createdAt: string;
};

export type MemoryUsage = {
    memoryId: MemoryId;
    retrievalCount: number;
    usefulCount: number;
    unhelpfulCount: number;
    lastRetrievedAt?: string;
    lastUsefulAt?: string;
};

export type MemoryView = {
    revision: MemoryRevision;
    head: MemoryHead;
    relations: readonly MemoryRelation[];
    usage: MemoryUsage;
};

export function createMemoryRevision(revision: MemoryRevision): MemoryRevision {
    const content = requireText(revision.content, "memory.content");
    const tags = [...new Set(revision.tags.map(normalizeTag))].sort();
    const confidence = requireUnitInterval(
        revision.confidence,
        "memory.confidence",
    );
    const importance = requireUnitInterval(
        revision.importance,
        "memory.importance",
    )!;
    const validFrom = optionalTimestamp(revision.validFrom, "memory.validFrom");
    const validUntil = optionalTimestamp(
        revision.validUntil,
        "memory.validUntil",
    );
    if (
        validFrom !== undefined &&
        validUntil !== undefined &&
        validFrom >= validUntil
    ) {
        return invalidArgument("memory.validUntil must follow validFrom");
    }
    if (revision.structuredContent !== undefined) {
        requireJsonValue(revision.structuredContent);
    }
    return Object.freeze({
        ...revision,
        revision: requireRevision(revision.revision),
        content,
        tags: Object.freeze(tags),
        provenance: createProvenance(revision.provenance),
        importance,
        createdAt: requireAbsoluteTimestamp(
            revision.createdAt,
            "memory.createdAt",
        ),
        ...(revision.structuredContent === undefined
            ? {}
            : { structuredContent: revision.structuredContent }),
        ...(confidence === undefined ? {} : { confidence }),
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil }),
        ...(revision.reason === undefined
            ? {}
            : { reason: requireText(revision.reason, "memory.reason") }),
    });
}

export function canTransitionMemoryState(
    from: MemoryState,
    to: MemoryState,
): boolean {
    return (
        (from === "active" &&
            (to === "superseded" || to === "archived" || to === "forgotten")) ||
        (from === "superseded" && to === "archived") ||
        ((from === "archived" || from === "forgotten") && to === "active")
    );
}

function normalizeTag(value: string): string {
    return requireText(value, "memory.tag").toLocaleLowerCase("en-US");
}

function requireUnitInterval(
    value: number | undefined,
    name: string,
): number | undefined {
    if (
        value !== undefined &&
        (!Number.isFinite(value) || value < 0 || value > 1)
    ) {
        return invalidArgument(`${name} must be between 0 and 1`);
    }
    return value;
}

function optionalTimestamp(
    value: string | undefined,
    name: string,
): string | undefined {
    return value === undefined
        ? undefined
        : requireAbsoluteTimestamp(value, name);
}

function requireJsonValue(value: unknown): void {
    try {
        if (JSON.stringify(value) === undefined) {
            invalidArgument(
                "memory.structuredContent must be JSON serializable",
            );
        }
    } catch {
        invalidArgument("memory.structuredContent must be JSON serializable");
    }
}
