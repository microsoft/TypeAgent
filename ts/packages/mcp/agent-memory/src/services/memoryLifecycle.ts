// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    DomainError,
    SystemClock,
    UuidV7IdGenerator,
    asId,
    createMemoryRevision,
    scopesEqual,
    type AccessScope,
    type Clock,
    type IdGenerator,
    type MemoryKind,
    type MemoryProvenance,
    type MemoryRelation,
    type MemoryRelationType,
    type MemoryState,
    type MemoryUsage,
    type MemoryView,
} from "../domain/index.js";
import type {
    MemoryFeedbackOutcome,
    MemoryRepository,
} from "../repository/index.js";

export type StoreMemoryRelation = {
    type: MemoryRelationType;
    targetMemoryId: string;
};

export type StoreMemoryRequest = {
    content: string;
    kind: MemoryKind;
    scope: AccessScope;
    provenance: MemoryProvenance;
    structuredContent?: unknown;
    tags?: readonly string[];
    confidence?: number;
    importance?: number;
    validFrom?: string;
    validUntil?: string;
    relations?: readonly StoreMemoryRelation[];
    idempotencyKey?: string;
};

export type StoreMemoryResult = {
    memory: MemoryView;
    indexState: "ready";
    duplicateCandidates: readonly never[];
};

export type ReviseMemoryRequest = {
    memoryId: string;
    scope: AccessScope;
    expectedRevision: number;
    content?: string;
    structuredContent?: unknown;
    kind?: MemoryKind;
    tags?: readonly string[];
    confidence?: number;
    importance?: number;
    validFrom?: string | null;
    validUntil?: string | null;
    provenance: MemoryProvenance;
    reason: string;
    idempotencyKey?: string;
};

export type ReviseMemoryResult = {
    memory: MemoryView;
    indexState: "ready";
};

export type ChangeMemoryVisibilityRequest = {
    memoryIds: readonly string[];
    scope: AccessScope;
    action?: "forget" | "restore";
    reason: string;
    actorId: string;
    expectedRevisions?: Readonly<Record<string, number>>;
    idempotencyKey?: string;
};

export type ChangeMemoryVisibilityResult = {
    memories: readonly MemoryView[];
    indexState: "ready";
};

export type MemoryFeedbackRequest = {
    retrievalId: string;
    outcomes: readonly MemoryFeedbackOutcome[];
};

export type MemoryFeedbackResult = {
    retrievalId: string;
    usage: readonly MemoryUsage[];
};

export type MemoryLifecycleServiceOptions = {
    allowedScope?: string;
    clock?: Clock;
    idGenerator?: IdGenerator;
};

export class MemoryLifecycleService {
    readonly #allowedScope: string | undefined;
    readonly #clock: Clock;
    readonly #ids: IdGenerator;

    public constructor(
        private readonly repository: MemoryRepository,
        options: MemoryLifecycleServiceOptions = {},
    ) {
        this.#allowedScope = options.allowedScope;
        this.#clock = options.clock ?? new SystemClock();
        this.#ids = options.idGenerator ?? new UuidV7IdGenerator(this.#clock);
    }

    public store(request: StoreMemoryRequest): StoreMemoryResult {
        this.requireScope(request.scope);
        const result = this.idempotent(
            "store",
            request.scope.scopeId,
            request.idempotencyKey,
            request,
            () => {
                const createdAt = this.#clock.now().toISOString();
                const memoryId = this.#ids.generate("Memory");
                const revision = createMemoryRevision({
                    memoryId,
                    scopeId: request.scope.scopeId,
                    revision: 1,
                    kind: request.kind,
                    content: request.content,
                    ...(request.structuredContent === undefined
                        ? {}
                        : { structuredContent: request.structuredContent }),
                    tags: request.tags ?? [],
                    provenance: request.provenance,
                    ...(request.confidence === undefined
                        ? {}
                        : { confidence: request.confidence }),
                    importance: request.importance ?? 0.5,
                    ...(request.validFrom === undefined
                        ? {}
                        : { validFrom: request.validFrom }),
                    ...(request.validUntil === undefined
                        ? {}
                        : { validUntil: request.validUntil }),
                    createdAt,
                });
                const relations = (request.relations ?? []).map(
                    (relation): MemoryRelation => ({
                        sourceMemoryId: memoryId,
                        relationType: relation.type,
                        targetMemoryId: asId(relation.targetMemoryId, "Memory"),
                        createdAt,
                    }),
                );
                let memory = this.repository.createMemory(revision, relations);
                const superseded = relations.filter(
                    (relation) => relation.relationType === "supersedes",
                );
                if (superseded.length > 0) {
                    this.repository.changeMemoryStates(
                        request.scope.scopeId,
                        superseded.map((relation) => {
                            const target = this.requireMemory(
                                request.scope.scopeId,
                                relation.targetMemoryId,
                            );
                            return {
                                memoryId: relation.targetMemoryId,
                                expectedRevision: target.head.currentRevision,
                                supersededBy: memoryId,
                                event: {
                                    eventId: this.#ids.generate("StateEvent"),
                                    memoryId: relation.targetMemoryId,
                                    fromState: target.head.state,
                                    toState: "superseded" as const,
                                    actorId: request.provenance.actorId,
                                    reason: `Superseded by ${memoryId}`,
                                    createdAt,
                                },
                            };
                        }),
                    );
                    memory = this.requireMemory(
                        request.scope.scopeId,
                        memoryId,
                    );
                }
                return {
                    memory,
                    indexState: "ready" as const,
                    duplicateCandidates: [],
                };
            },
        );
        this.repository.rebuildSearchDocuments();
        return result;
    }

    public revise(request: ReviseMemoryRequest): ReviseMemoryResult {
        this.requireScope(request.scope);
        const result = this.idempotent(
            "revise",
            request.scope.scopeId,
            request.idempotencyKey,
            request,
            () => {
                const current = this.requireMemory(
                    request.scope.scopeId,
                    request.memoryId,
                );
                const previous = current.revision;
                const structuredContent =
                    request.structuredContent === undefined
                        ? previous.structuredContent
                        : request.structuredContent;
                const confidence = request.confidence ?? previous.confidence;
                const revision = createMemoryRevision({
                    memoryId: previous.memoryId,
                    scopeId: previous.scopeId,
                    revision: request.expectedRevision + 1,
                    content: request.content ?? previous.content,
                    ...(structuredContent === undefined
                        ? {}
                        : { structuredContent }),
                    kind: request.kind ?? previous.kind,
                    tags: request.tags ?? previous.tags,
                    ...(confidence === undefined ? {} : { confidence }),
                    importance: request.importance ?? previous.importance,
                    ...nullableUpdate("validFrom", request.validFrom, previous),
                    ...nullableUpdate(
                        "validUntil",
                        request.validUntil,
                        previous,
                    ),
                    provenance: request.provenance,
                    reason: request.reason,
                    createdAt: this.#clock.now().toISOString(),
                });
                return {
                    memory: this.repository.reviseMemory(
                        revision,
                        request.expectedRevision,
                    ),
                    indexState: "ready" as const,
                };
            },
        );
        this.repository.rebuildSearchDocuments();
        return result;
    }

    public changeVisibility(
        request: ChangeMemoryVisibilityRequest,
    ): ChangeMemoryVisibilityResult {
        this.requireScope(request.scope);
        if (
            request.memoryIds.length < 1 ||
            request.memoryIds.length > 100 ||
            new Set(request.memoryIds).size !== request.memoryIds.length
        ) {
            throw new DomainError(
                "INVALID_ARGUMENT",
                "memoryIds must contain between 1 and 100 unique IDs",
            );
        }
        const result = this.idempotent(
            "visibility",
            request.scope.scopeId,
            request.idempotencyKey,
            request,
            () => {
                const createdAt = this.#clock.now().toISOString();
                const targetState: MemoryState =
                    (request.action ?? "forget") === "forget"
                        ? "forgotten"
                        : "active";
                const changes = request.memoryIds.map((memoryId) => {
                    const memory = this.requireMemory(
                        request.scope.scopeId,
                        memoryId,
                    );
                    return {
                        memoryId,
                        ...(request.expectedRevisions?.[memoryId] === undefined
                            ? {}
                            : {
                                  expectedRevision:
                                      request.expectedRevisions[memoryId],
                              }),
                        event: {
                            eventId: this.#ids.generate("StateEvent"),
                            memoryId: asId(memoryId, "Memory"),
                            fromState: memory.head.state,
                            toState: targetState,
                            actorId: request.actorId,
                            reason: request.reason,
                            createdAt,
                        },
                    };
                });
                return {
                    memories: this.repository.changeMemoryStates(
                        request.scope.scopeId,
                        changes,
                    ),
                    indexState: "ready" as const,
                };
            },
        );
        this.repository.rebuildSearchDocuments();
        return result;
    }

    public feedback(request: MemoryFeedbackRequest): MemoryFeedbackResult {
        if (
            request.outcomes.length < 1 ||
            request.outcomes.length > 100 ||
            new Set(request.outcomes.map((outcome) => outcome.memoryId))
                .size !== request.outcomes.length
        ) {
            throw new DomainError(
                "INVALID_ARGUMENT",
                "outcomes must contain between 1 and 100 unique memory IDs",
            );
        }
        return {
            retrievalId: request.retrievalId,
            usage: this.repository.recordMemoryFeedback(
                request.retrievalId,
                request.outcomes,
                this.#clock.now().toISOString(),
            ),
        };
    }

    private requireScope(scope: AccessScope): void {
        const stored = this.repository.getScope(scope.scopeId);
        if (
            (this.#allowedScope !== undefined &&
                scope.scopeId !== this.#allowedScope) ||
            stored === undefined ||
            !scopesEqual(stored, scope)
        ) {
            throw new DomainError("NOT_FOUND", "Memory scope was not found");
        }
    }

    private requireMemory(scopeId: string, memoryId: string): MemoryView {
        const memory = this.repository.getMemory(scopeId, memoryId);
        if (memory === undefined) {
            throw new DomainError("NOT_FOUND", "Memory was not found");
        }
        return memory;
    }

    private idempotent<T>(
        operation: string,
        scopeId: string,
        key: string | undefined,
        request: unknown,
        execute: () => T,
    ): T {
        if (key === undefined) {
            return this.repository.runInTransaction(execute);
        }
        const requestHash = createHash("sha256")
            .update(JSON.stringify({ operation, request }))
            .digest("hex");
        return this.repository.runInTransaction(() => {
            const existing = this.repository.getIdempotencyRecord(scopeId, key);
            if (existing !== undefined) {
                if (existing.requestHash !== requestHash) {
                    throw new DomainError(
                        "IDEMPOTENCY_CONFLICT",
                        "Idempotency key was reused with different input",
                    );
                }
                return JSON.parse(existing.resultJson) as T;
            }
            const result = execute();
            this.repository.saveIdempotencyRecord({
                scopeId,
                key,
                requestHash,
                resultJson: JSON.stringify(result),
                createdAt: this.#clock.now().toISOString(),
            });
            return result;
        });
    }
}

function nullableUpdate<T extends "validFrom" | "validUntil">(
    name: T,
    value: string | null | undefined,
    previous: MemoryView["revision"],
): Partial<Pick<MemoryView["revision"], T>> {
    if (value === null) {
        return {};
    }
    const selected = value ?? previous[name];
    return selected === undefined
        ? {}
        : ({ [name]: selected } as Pick<MemoryView["revision"], T>);
}
