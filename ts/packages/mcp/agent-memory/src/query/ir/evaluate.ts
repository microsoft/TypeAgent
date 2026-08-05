// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CandidateFieldValue,
    FilterExpression,
    QueryCandidate,
    QueryEvaluation,
    QueryExpression,
    QueryScalar,
} from "./types.js";

type ExpressionEvaluation = Omit<QueryEvaluation, "candidateId">;

export function evaluateQueryExpression(
    expression: QueryExpression,
    candidate: QueryCandidate,
): QueryEvaluation {
    return {
        candidateId: candidate.candidateId,
        ...evaluate(expression, candidate),
    };
}

export function rankQueryCandidates(
    expression: QueryExpression,
    candidates: readonly QueryCandidate[],
): QueryEvaluation[] {
    return candidates
        .map((candidate) => evaluateQueryExpression(expression, candidate))
        .filter((evaluation) => evaluation.matches)
        .sort(
            (left, right) =>
                right.hitCount - left.hitCount ||
                right.quality - left.quality ||
                left.candidateId.localeCompare(right.candidateId),
        );
}

function evaluate(
    expression: QueryExpression,
    candidate: QueryCandidate,
): ExpressionEvaluation {
    switch (expression.type) {
        case "match": {
            const evidence = candidate.clauseEvidence[expression.clauseId];
            const quality =
                typeof evidence === "number"
                    ? Math.max(0, evidence)
                    : Math.max(0, ...(evidence ?? []));
            return {
                matches:
                    evidence !== undefined &&
                    (typeof evidence === "number" || evidence.length > 0),
                hitCount: 1,
                quality,
            };
        }
        case "filter":
            return {
                matches: evaluateFilter(
                    expression,
                    candidate.fields[expression.field],
                ),
                hitCount: 0,
                quality: 0,
            };
        case "not": {
            const child = evaluate(expression.child, candidate);
            return { matches: !child.matches, hitCount: 0, quality: 0 };
        }
        case "and": {
            const children = expression.children.map((child) =>
                evaluate(child, candidate),
            );
            return {
                matches: children.every((child) => child.matches),
                hitCount: children.reduce(
                    (total, child) => total + child.hitCount,
                    0,
                ),
                quality: children.reduce(
                    (total, child) => total + child.quality,
                    0,
                ),
            };
        }
        case "or": {
            const matching = expression.children
                .map((child) => evaluate(child, candidate))
                .filter((child) => child.matches);
            return {
                matches: matching.length > 0,
                hitCount: Math.min(
                    1,
                    Math.max(0, ...matching.map((child) => child.hitCount)),
                ),
                quality: Math.max(0, ...matching.map((child) => child.quality)),
            };
        }
        case "softAnd": {
            const children = expression.children.map((child) =>
                evaluate(child, candidate),
            );
            const membershipFilters = children.filter(
                (child) => child.hitCount === 0,
            );
            const matching = children.filter(
                (child) => child.hitCount > 0 && child.matches,
            );
            const hitCount = matching.reduce(
                (total, child) => total + child.hitCount,
                0,
            );
            return {
                matches:
                    membershipFilters.every((child) => child.matches) &&
                    hitCount >= (expression.minimumShouldMatch ?? 1),
                hitCount,
                quality: matching.reduce(
                    (total, child) => total + child.quality,
                    0,
                ),
            };
        }
    }
}

function evaluateFilter(
    filter: FilterExpression,
    candidateValue: CandidateFieldValue,
): boolean {
    switch (filter.operator) {
        case "exists":
            return candidateValue !== undefined;
        case "equals":
            return Array.isArray(candidateValue)
                ? candidateValue.includes(filter.value as QueryScalar)
                : candidateValue === filter.value;
        case "in": {
            const expected = filter.value as readonly QueryScalar[];
            if (
                candidateValue !== undefined &&
                typeof candidateValue === "object"
            ) {
                return candidateValue.some((value) => expected.includes(value));
            }
            return (
                candidateValue !== undefined &&
                expected.includes(candidateValue)
            );
        }
        case "prefix":
            return (
                typeof candidateValue === "string" &&
                candidateValue.startsWith(filter.value as string)
            );
    }
}
