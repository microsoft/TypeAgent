// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DomainError } from "../../domain/index.js";
import type {
    MemoryRepository,
    SearchDocument,
    SearchPosting,
    StructuralPostingSource,
} from "../../repository/index.js";
import {
    evaluateQueryExpression,
    hashQuery,
    normalizeQuery,
    type MatchExpression,
    type NormalizedQueryIrV1,
    type QueryCandidate,
    type QueryEntityKind,
    type QueryExpression,
    type QueryIrV1,
    type QueryOrder,
    type RetrievalChannel,
} from "../ir/index.js";
import type {
    EvaluatedQueryRecord,
    QueryEvaluatorResult,
    QueryMatchEvidence,
} from "./types.js";

const maximumCandidateCount = 2_000;

type MutableEvidence = {
    channels: Set<RetrievalChannel>;
    qualities: number[];
    references: Set<string>;
};

type CandidateState = {
    document: SearchDocument;
    candidate: QueryCandidate;
    evidence: Map<string, MutableEvidence>;
    eventReferences: readonly string[];
};

export function evaluateMemoryQuery(
    repository: MemoryRepository,
    input: QueryIrV1,
): QueryEvaluatorResult {
    const query = normalizeQuery(input);
    if (repository.getScope(query.scopeId) === undefined) {
        throw new DomainError("NOT_FOUND", "Memory scope was not found", {
            scopeId: query.scopeId,
        });
    }
    const indexVersion = repository.getSearchIndexVersion();
    if (
        query.continuation !== undefined &&
        query.continuation.indexVersion !== indexVersion
    ) {
        throw new DomainError(
            "REVISION_CONFLICT",
            "Query continuation uses a different search index version",
            {
                continuationIndexVersion: query.continuation.indexVersion,
                indexVersion,
            },
        );
    }

    const structuralIds = resolveStructuralIds(repository, query);
    const positiveMatches = collectPositiveMatches(query.expression);
    const lexicalPostings = collectMatchPostings(
        repository,
        query,
        positiveMatches,
    );
    const lexicalIds = new Set(
        [...lexicalPostings.values()].flatMap((postings) =>
            postings.map((posting) => posting.entityId),
        ),
    );
    const changedPostings =
        query.temporal?.type === "changedDuring"
            ? repository.listChangedEntityPostings(
                  query.scopeId,
                  query.targetKinds,
                  query.temporal.start,
                  query.temporal.end,
              )
            : [];
    const changedByEntity = new Map(
        changedPostings.map((posting) => [posting.entityId, posting]),
    );
    const hasStructuralSource =
        query.topic !== undefined || query.source !== undefined;
    const documents = repository
        .listSearchDocuments(query.scopeId, query.targetKinds)
        .filter((document) =>
            hasStructuralSource
                ? structuralIds.has(document.entityId)
                : lexicalIds.has(document.entityId),
        )
        .slice(0, maximumCandidateCount);
    const candidates = documents.flatMap((document) => {
        if (
            query.temporal?.type === "changedDuring" &&
            !changedByEntity.has(document.entityId)
        ) {
            return [];
        }
        const projectionInstant =
            query.temporal?.type === "asOf"
                ? query.temporal.instant
                : query.temporal?.type === "changedDuring" &&
                    query.temporal.projection === "endState"
                  ? previousInstant(query.temporal.end)
                  : undefined;
        const projected =
            projectionInstant === undefined
                ? {
                      document,
                      fields: repository.getSearchDocumentFields(document),
                  }
                : repository.projectSearchDocumentAt(
                      document,
                      projectionInstant,
                  );
        return projected === undefined
            ? []
            : [
                  createCandidateState(
                      projected.document,
                      projected.fields,
                      positiveMatches,
                      lexicalPostings,
                      changedByEntity.get(document.entityId)?.eventReferences ??
                          [],
                  ),
              ];
    });
    const matching = candidates
        .filter((candidate) => matchesTemporal(query, candidate.candidate))
        .map((candidate) => ({
            candidate,
            evaluation: evaluateQueryExpression(
                query.expression,
                candidate.candidate,
            ),
        }))
        .filter(({ evaluation }) => evaluation.matches)
        .map(({ candidate, evaluation }) =>
            toEvaluatedRecord(
                candidate,
                evaluation.hitCount,
                evaluation.quality,
            ),
        )
        .sort(createRecordComparator(query.orderBy));

    if (repository.getSearchIndexVersion() !== indexVersion) {
        throw new DomainError(
            "REVISION_CONFLICT",
            "Search index changed during query evaluation",
            { indexVersion },
        );
    }
    return {
        queryHash: hashQuery(query),
        indexVersion,
        records: matching.slice(0, query.maxResults),
        candidateCount: candidates.length,
        truncated: matching.length > query.maxResults,
    };
}

function resolveStructuralIds(
    repository: MemoryRepository,
    query: NormalizedQueryIrV1,
): Set<string> {
    let allowed: Set<string> | undefined;
    if (query.topic !== undefined) {
        const topicIds = repository.resolveTopicIds(
            query.scopeId,
            query.topic.rootPath,
            query.topic.traversal,
        );
        allowed = new Set(
            query.targetKinds.flatMap((kind) =>
                repository.listTopicEntityIds(
                    query.scopeId,
                    topicIds,
                    kind,
                    query.topic?.roles,
                ),
            ),
        );
    }
    if (query.source !== undefined) {
        const source: StructuralPostingSource = {
            type: query.source.type,
            value:
                query.source.type === "term"
                    ? query.source.term
                    : query.source.type === "artifact"
                      ? query.source.artifactId
                      : query.source.turnId,
        };
        const sourceIds = new Set(
            query.targetKinds.flatMap((kind) =>
                repository.listSourceEntityIds(query.scopeId, source, kind),
            ),
        );
        allowed =
            allowed === undefined
                ? sourceIds
                : new Set([...allowed].filter((id) => sourceIds.has(id)));
    }
    return allowed ?? new Set<string>();
}

function collectPositiveMatches(
    expression: QueryExpression,
    negated = false,
): MatchExpression[] {
    switch (expression.type) {
        case "match":
            return negated ? [] : [expression];
        case "filter":
            return [];
        case "not":
            return collectPositiveMatches(expression.child, !negated);
        default:
            return expression.children.flatMap((child) =>
                collectPositiveMatches(child, negated),
            );
    }
}

function collectMatchPostings(
    repository: MemoryRepository,
    query: NormalizedQueryIrV1,
    matches: readonly MatchExpression[],
): Map<string, SearchPosting[]> {
    const postings = new Map<string, SearchPosting[]>();
    for (const match of matches) {
        const clausePostings: SearchPosting[] = [];
        if (
            match.channels === undefined ||
            match.channels.includes("lexical")
        ) {
            clausePostings.push(
                ...repository.searchDocuments(
                    query.scopeId,
                    match.text,
                    query.targetKinds,
                    maximumCandidateCount,
                ),
            );
        }
        if (match.channels === undefined || match.channels.includes("term")) {
            const termIds = new Set(
                query.targetKinds.flatMap((kind) =>
                    repository.listSourceEntityIds(
                        query.scopeId,
                        { type: "term", value: match.text },
                        kind,
                    ),
                ),
            );
            const byEntityId = new Map(
                repository
                    .listSearchDocuments(query.scopeId, query.targetKinds)
                    .map((document) => [document.entityId, document]),
            );
            for (const entityId of termIds) {
                const document = byEntityId.get(entityId);
                if (document !== undefined) {
                    clausePostings.push({
                        ...document,
                        quality: 1,
                        channel: "term",
                    });
                }
            }
        }
        postings.set(match.clauseId, clausePostings);
    }
    return postings;
}

function createCandidateState(
    document: SearchDocument,
    fields: QueryCandidate["fields"],
    matches: readonly MatchExpression[],
    postings: ReadonlyMap<string, readonly SearchPosting[]>,
    eventReferences: readonly string[],
): CandidateState {
    const evidence = new Map<string, MutableEvidence>();
    const clauseEvidence: Record<string, readonly number[] | undefined> = {};
    for (const match of matches) {
        const matching = (postings.get(match.clauseId) ?? []).filter(
            (posting) => posting.entityId === document.entityId,
        );
        if (matching.length === 0) {
            continue;
        }
        const channels = new Set<RetrievalChannel>();
        const qualities: number[] = [];
        const references = new Set<string>();
        for (const posting of matching) {
            channels.add(posting.channel);
            qualities.push(posting.quality);
            references.add(posting.documentId);
        }
        evidence.set(match.clauseId, { channels, qualities, references });
        clauseEvidence[match.clauseId] = qualities;
    }
    return {
        document,
        candidate: {
            candidateId: document.entityId,
            clauseEvidence,
            fields,
        },
        evidence,
        eventReferences,
    };
}

function matchesTemporal(
    query: NormalizedQueryIrV1,
    candidate: QueryCandidate,
): boolean {
    if (candidate.fields.entityKind === "memory") {
        const validAt =
            query.temporal?.type === "asOf"
                ? query.temporal.instant
                : query.timezone.resolvedAt;
        const validFrom = candidate.fields.validFrom;
        const validUntil = candidate.fields.validUntil;
        if (
            (typeof validFrom === "string" && validFrom > validAt) ||
            (typeof validUntil === "string" && validUntil <= validAt)
        ) {
            return false;
        }
    }
    if (query.temporal === undefined) {
        return true;
    }
    const occurredAt = candidate.fields.occurredAt;
    const recordedAt = candidate.fields.recordedAt;
    switch (query.temporal.type) {
        case "during":
            return isWithin(
                occurredAt,
                query.temporal.start,
                query.temporal.end,
            );
        case "asOf":
            return (
                typeof recordedAt === "string" &&
                recordedAt <= query.temporal.instant
            );
        case "changedDuring":
            return isWithin(
                recordedAt,
                query.temporal.start,
                query.temporal.end,
            );
    }
}

function isWithin(value: unknown, start: string, end: string): boolean {
    return typeof value === "string" && value >= start && value < end;
}

function toEvaluatedRecord(
    state: CandidateState,
    hitCount: number,
    quality: number,
): EvaluatedQueryRecord {
    const evidence: QueryMatchEvidence[] = [...state.evidence.entries()]
        .map(([clauseId, item]) => ({
            clauseId,
            channels: [...item.channels].sort(),
            quality: Math.max(...item.qualities),
            references: [...item.references].sort(),
        }))
        .sort((left, right) => left.clauseId.localeCompare(right.clauseId));
    return {
        entityId: state.document.entityId,
        entityKind: state.document.entityKind as QueryEntityKind,
        revision: state.document.revision,
        title: state.document.title,
        content: state.document.content,
        occurredAt: state.document.occurredAt,
        recordedAt: state.candidate.fields.recordedAt as string,
        hitCount,
        quality,
        fields: state.candidate.fields,
        evidence,
        eventReferences: state.eventReferences,
    };
}

function previousInstant(instant: string): string {
    return new Date(Date.parse(instant) - 1).toISOString();
}

function createRecordComparator(
    orderBy: readonly QueryOrder[] | undefined,
): (left: EvaluatedQueryRecord, right: EvaluatedQueryRecord) => number {
    return (left, right) => {
        for (const order of orderBy ?? []) {
            const comparison = compareOrderField(order.field, left, right);
            if (comparison !== 0) {
                return order.direction === "asc" ? comparison : -comparison;
            }
        }
        return left.entityId.localeCompare(right.entityId);
    };
}

function compareOrderField(
    field: QueryOrder["field"],
    left: EvaluatedQueryRecord,
    right: EvaluatedQueryRecord,
): number {
    switch (field) {
        case "hitCount":
            return left.hitCount - right.hitCount;
        case "quality":
            return left.quality - right.quality;
        case "occurredAt":
            return left.occurredAt.localeCompare(right.occurredAt);
        case "recordedAt":
            return left.recordedAt.localeCompare(right.recordedAt);
        case "entityId":
            return left.entityId.localeCompare(right.entityId);
    }
}
