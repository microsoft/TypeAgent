// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainError, type MemoryView } from "../domain/index.js";
import {
    ConservativeTokenEstimator,
    renderPacketRecord,
    type PacketReference,
    type TokenEstimator,
} from "../packet/index.js";
import type { EvaluatedQueryRecord, QueryEntityKind } from "../query/index.js";
import type {
    MemoryRepository,
    ProjectedSearchDocument,
    SearchDocument,
} from "../repository/index.js";

const maximumMemoryIds = 100;
const maximumTokenBudget = 32_768;

export type MemoryGetRequest = {
    scopeId: string;
    memoryIds: readonly string[];
    revision?: number;
    tokenBudget: number;
    detail?: "cards" | "snippets" | "full";
};

export type MemoryGetItem =
    | {
          memoryId: string;
          status: "found";
          reference: PacketReference;
      }
    | { memoryId: string; status: "notFound" }
    | { memoryId: string; status: "omitted" };

export type MemoryGetResult = {
    text: string;
    items: readonly MemoryGetItem[];
    references: readonly PacketReference[];
    estimatedTokens: number;
    requestedTokenBudget: number;
    truncated: boolean;
};

export type MemoryGetServiceOptions = {
    allowedScope?: string;
    tokenEstimator?: TokenEstimator;
};

export class MemoryGetService {
    readonly #allowedScope: string | undefined;
    readonly #estimator: TokenEstimator;

    public constructor(
        private readonly repository: MemoryRepository,
        options: MemoryGetServiceOptions = {},
    ) {
        this.#allowedScope = options.allowedScope;
        this.#estimator =
            options.tokenEstimator ?? new ConservativeTokenEstimator();
    }

    public get(request: MemoryGetRequest): MemoryGetResult {
        validateRequest(request);
        if (
            (this.#allowedScope !== undefined &&
                request.scopeId !== this.#allowedScope) ||
            this.repository.getScope(request.scopeId) === undefined
        ) {
            throw new DomainError("NOT_FOUND", "Memory scope was not found");
        }
        const documents = new Map(
            this.repository
                .listSearchDocuments(request.scopeId)
                .map((document) => [document.entityId, document]),
        );
        const blocks: string[] = [];
        const items: MemoryGetItem[] = [];
        const references: PacketReference[] = [];
        let estimatedTokens = 0;
        let truncated = false;
        for (const memoryId of request.memoryIds) {
            const durableMemory = this.repository.getMemory(
                request.scopeId,
                memoryId,
                request.revision,
            );
            const document = documents.get(memoryId);
            const projection =
                durableMemory !== undefined || document === undefined
                    ? undefined
                    : projectDocument(
                          this.repository,
                          document,
                          request.revision,
                      );
            const record =
                durableMemory === undefined
                    ? projection === undefined
                        ? undefined
                        : toEvaluatedRecord(projection)
                    : toDurableMemoryRecord(durableMemory);
            if (record === undefined) {
                items.push({ memoryId, status: "notFound" });
                continue;
            }
            const citation = `[m${references.length + 1}]`;
            const block = renderPacketRecord(
                record,
                request.detail ?? "full",
                citation,
            );
            const separator = blocks.length === 0 ? "" : "\n\n";
            const tokens = this.#estimator.estimate(`${separator}${block}`);
            if (estimatedTokens + tokens > request.tokenBudget) {
                items.push({ memoryId, status: "omitted" });
                truncated = true;
                continue;
            }
            const reference: PacketReference = {
                citation,
                entityId: memoryId,
                entityKind: record.entityKind,
                revision: record.revision,
            };
            blocks.push(block);
            references.push(reference);
            items.push({ memoryId, status: "found", reference });
            estimatedTokens += tokens;
        }
        return {
            text: blocks.join("\n\n"),
            items,
            references,
            estimatedTokens,
            requestedTokenBudget: request.tokenBudget,
            truncated,
        };
    }
}

function toDurableMemoryRecord(memory: MemoryView): EvaluatedQueryRecord {
    const revision = memory.revision;
    return {
        entityId: revision.memoryId,
        entityKind: "memory",
        revision: revision.revision,
        title: revision.kind,
        content: revision.content,
        occurredAt: revision.provenance.observedAt ?? revision.createdAt,
        recordedAt: revision.createdAt,
        hitCount: 0,
        quality: 0,
        fields: {
            state: memory.head.state,
            kind: revision.kind,
            tags: revision.tags,
            importance: revision.importance,
            confidence: revision.confidence,
            validFrom: revision.validFrom,
            validUntil: revision.validUntil,
        },
        evidence: [],
        eventReferences: [],
    };
}

function validateRequest(request: MemoryGetRequest): void {
    if (
        request.memoryIds.length < 1 ||
        request.memoryIds.length > maximumMemoryIds
    ) {
        throw new DomainError(
            "INVALID_ARGUMENT",
            `memoryIds must contain between 1 and ${maximumMemoryIds} IDs`,
        );
    }
    if (
        !Number.isSafeInteger(request.tokenBudget) ||
        request.tokenBudget < 1 ||
        request.tokenBudget > maximumTokenBudget
    ) {
        throw new DomainError(
            "INVALID_ARGUMENT",
            `tokenBudget must be between 1 and ${maximumTokenBudget}`,
        );
    }
    if (
        request.revision !== undefined &&
        (request.memoryIds.length !== 1 ||
            !Number.isSafeInteger(request.revision) ||
            request.revision < 1)
    ) {
        throw new DomainError(
            "INVALID_ARGUMENT",
            "revision requires exactly one memory ID and must be positive",
        );
    }
}

function projectDocument(
    repository: MemoryRepository,
    document: SearchDocument,
    revision: number | undefined,
): ProjectedSearchDocument | undefined {
    return revision === undefined
        ? {
              document,
              fields: repository.getSearchDocumentFields(document),
          }
        : repository.projectSearchDocumentRevision(document, revision);
}

function toEvaluatedRecord(
    projection: ProjectedSearchDocument,
): EvaluatedQueryRecord {
    const { document, fields } = projection;
    const recordedAt = fields.recordedAt;
    return {
        entityId: document.entityId,
        entityKind: document.entityKind as QueryEntityKind,
        revision: document.revision,
        title: document.title,
        content: document.content,
        occurredAt: document.occurredAt,
        recordedAt:
            typeof recordedAt === "string" ? recordedAt : document.occurredAt,
        hitCount: 0,
        quality: 0,
        fields,
        evidence: [],
        eventReferences: [],
    };
}
