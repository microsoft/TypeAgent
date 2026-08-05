// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    DomainError,
    SystemClock,
    UuidV7IdGenerator,
    type Clock,
    type IdGenerator,
} from "../domain/index.js";
import {
    type WorkingMemoryPacket,
    type WorkingMemoryPacketAssembler,
} from "../packet/index.js";
import {
    evaluateMemoryQuery,
    normalizeQuery,
    parseQueryLanguage,
    type QueryIrV1,
    type TemporalSelector,
} from "../query/index.js";
import type { MemoryRepository } from "../repository/index.js";

export type MemoryQueryRequest = {
    scopeId: string;
    query?: string;
    ir?: QueryIrV1;
    timeZone?: string;
    now?: string;
    continuation?: string;
    repeatTopicBrief?: boolean;
};

export type MemoryQueryResult = {
    retrievalId: string;
    packet: WorkingMemoryPacket;
    resolvedTemporal?: TemporalSelector;
};

export type MemoryQueryServiceOptions = {
    allowedScope?: string;
    clock?: Clock;
    idGenerator?: IdGenerator;
};

export class MemoryQueryService {
    readonly #allowedScope: string | undefined;
    readonly #clock: Clock;
    readonly #ids: IdGenerator;

    public constructor(
        private readonly repository: MemoryRepository,
        private readonly packetAssembler: WorkingMemoryPacketAssembler,
        options: MemoryQueryServiceOptions = {},
    ) {
        this.#allowedScope = options.allowedScope;
        this.#clock = options.clock ?? new SystemClock();
        this.#ids = options.idGenerator ?? new UuidV7IdGenerator(this.#clock);
    }

    public query(request: MemoryQueryRequest): MemoryQueryResult {
        this.requireAllowedScope(request.scopeId);
        if ((request.query === undefined) === (request.ir === undefined)) {
            throw new DomainError(
                "INVALID_ARGUMENT",
                "Provide exactly one path query or structured query IR",
            );
        }
        const query =
            request.query === undefined
                ? normalizeQuery(request.ir!)
                : parseQueryLanguage(request.query, {
                      scopeId: request.scopeId,
                      timeZone: request.timeZone ?? "UTC",
                      now: parseNow(request.now, this.#clock),
                  });
        if (query.scopeId !== request.scopeId) {
            throw new DomainError(
                "SCOPE_MISMATCH",
                "Query IR does not match the requested scope",
            );
        }
        const evaluation = evaluateMemoryQuery(this.repository, query);
        const packet = this.packetAssembler.assemble({
            query,
            evaluation,
            ...(request.continuation === undefined
                ? {}
                : { continuation: request.continuation }),
            ...(request.repeatTopicBrief === undefined
                ? {}
                : { repeatTopicBrief: request.repeatTopicBrief }),
        });
        const retrievalId = this.#ids.generate("Retrieval");
        const cited = new Set(
            packet.references
                .filter((reference) => reference.entityKind !== "summary")
                .map(
                    (reference) =>
                        `${reference.entityKind}:${reference.entityId}:${reference.revision}`,
                ),
        );
        this.repository.recordRetrieval(
            retrievalId,
            query.scopeId,
            JSON.stringify(query),
            evaluation.records
                .filter((record) =>
                    cited.has(
                        `${record.entityKind}:${record.entityId}:${record.revision}`,
                    ),
                )
                .map((record) => ({
                    entityId: record.entityId,
                    entityKind: record.entityKind,
                    revision: record.revision,
                    score: record.quality,
                    channels: [
                        ...new Set(
                            record.evidence.flatMap(
                                (evidence) => evidence.channels,
                            ),
                        ),
                    ].sort(),
                })),
            this.#clock.now().toISOString(),
        );
        return {
            retrievalId,
            packet,
            ...(query.temporal === undefined
                ? {}
                : { resolvedTemporal: query.temporal }),
        };
    }

    private requireAllowedScope(scopeId: string): void {
        if (
            this.#allowedScope !== undefined &&
            scopeId !== this.#allowedScope
        ) {
            throw new DomainError("NOT_FOUND", "Memory scope was not found");
        }
    }
}

function parseNow(value: string | undefined, clock: Clock): Date {
    if (value === undefined) {
        return clock.now();
    }
    const now = new Date(value);
    if (Number.isNaN(now.valueOf())) {
        throw new DomainError("INVALID_ARGUMENT", "Invalid query clock");
    }
    return now;
}
