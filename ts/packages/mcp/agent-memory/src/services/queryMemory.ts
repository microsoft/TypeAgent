// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainError, SystemClock, type Clock } from "../domain/index.js";
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
    packet: WorkingMemoryPacket;
    resolvedTemporal?: TemporalSelector;
};

export type MemoryQueryServiceOptions = {
    allowedScope?: string;
    clock?: Clock;
};

export class MemoryQueryService {
    readonly #allowedScope: string | undefined;
    readonly #clock: Clock;

    public constructor(
        private readonly repository: MemoryRepository,
        private readonly packetAssembler: WorkingMemoryPacketAssembler,
        options: MemoryQueryServiceOptions = {},
    ) {
        this.#allowedScope = options.allowedScope;
        this.#clock = options.clock ?? new SystemClock();
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
        return {
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
