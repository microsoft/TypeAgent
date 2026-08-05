// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    asId,
    invalidArgument,
    normalizeTopicPath,
    requireAbsoluteTimestamp,
    requireSequence,
    requireText,
} from "../../domain/index.js";
import {
    queryIrVersion,
    type FilterExpression,
    type NormalizedQueryIrV1,
    type QueryContinuation,
    type QueryExpression,
    type QueryIrV1,
    type QueryScalar,
    type StructuralSource,
    type TemporalSelector,
} from "./types.js";

const maximumExpressionDepth = 16;
const maximumExpressionNodes = 256;
const maximumTokenBudget = 32_768;
const maximumResults = 1_000;
const hashPattern = /^[0-9a-f]{64}$/;
const entityKinds = new Set([
    "topic",
    "turn",
    "action",
    "term",
    "artifact",
    "artifactChange",
    "goal",
    "designNote",
    "output",
    "property",
]);
const includeFields = new Set([
    "topics",
    "terms",
    "actions",
    "artifacts",
    "goals",
    "designNotes",
    "outputs",
    "properties",
    "provenance",
    "lineage",
]);
const retrievalChannels = new Set([
    "lexical",
    "topic",
    "term",
    "artifact",
    "facet",
]);
const orderFields = new Set([
    "hitCount",
    "quality",
    "occurredAt",
    "recordedAt",
    "entityId",
]);

export function normalizeQuery(query: QueryIrV1): NormalizedQueryIrV1 {
    if (query === null || typeof query !== "object") {
        return invalidArgument("Query must be an object");
    }
    if (query.version !== queryIrVersion) {
        return invalidArgument("Unsupported query IR version", {
            version: query.version,
        });
    }
    const scopeId = asId(query.scopeId, "Scope");
    requireAllowedValues(query.targetKinds, entityKinds, "targetKinds");
    const targetKinds = sortedUnique(query.targetKinds);
    if (targetKinds.length === 0) {
        return invalidArgument("Query must target at least one entity kind");
    }

    const counter = { nodes: 0 };
    const expression = normalizeExpression(query.expression, 1, counter);
    if (
        !hasPositiveMatch(expression) &&
        query.source === undefined &&
        query.topic === undefined &&
        query.temporal === undefined
    ) {
        return invalidArgument(
            "Query requires a positive match, topic, or temporal candidate source",
        );
    }
    requireUniqueClauseIds(expression);
    requireBoundedInteger(
        query.tokenBudget,
        1,
        maximumTokenBudget,
        "tokenBudget",
    );
    requireBoundedInteger(query.maxResults, 1, maximumResults, "maxResults");
    if (!new Set(["cards", "snippets", "full"]).has(query.detail)) {
        return invalidArgument("Invalid query detail level", {
            detail: query.detail,
        });
    }
    validateTimezone(query.timezone);
    if (query.include !== undefined) {
        requireAllowedValues(query.include, includeFields, "include");
    }

    const normalizedWithoutContinuation: QueryIrV1 = {
        version: queryIrVersion,
        scopeId,
        targetKinds,
        expression,
        ...(query.source === undefined
            ? {}
            : { source: normalizeStructuralSource(query.source) }),
        ...(query.topic === undefined
            ? {}
            : {
                  topic: {
                      rootPath: normalizeTopicPath(query.topic.rootPath),
                      traversal: normalizeTopicTraversal(query.topic.traversal),
                      ...(query.topic.roles === undefined
                          ? {}
                          : { roles: normalizeTopicRoles(query.topic.roles) }),
                  },
              }),
        ...(query.temporal === undefined
            ? {}
            : { temporal: normalizeTemporal(query.temporal) }),
        ...(query.include === undefined
            ? {}
            : { include: sortedUnique(query.include) }),
        ...(query.projection === undefined
            ? {}
            : {
                  projection: sortedUnique(
                      query.projection.map((field) =>
                          requireText(field, "projection field"),
                      ),
                  ),
              }),
        orderBy: normalizeOrdering(query.orderBy),
        detail: query.detail,
        tokenBudget: query.tokenBudget,
        maxResults: query.maxResults,
        timezone: {
            timeZone: query.timezone.timeZone,
            utcOffsetMinutes: query.timezone.utcOffsetMinutes,
            resolvedAt: query.timezone.resolvedAt,
        },
    };
    const queryHash = hashNormalizedQuery(normalizedWithoutContinuation);
    const continuation = normalizeContinuation(query.continuation, queryHash);
    return Object.freeze({
        ...normalizedWithoutContinuation,
        ...(continuation === undefined ? {} : { continuation }),
    });
}

export function serializeQuery(query: QueryIrV1): string {
    return canonicalJson(normalizeQuery(query));
}

export function hashQuery(query: QueryIrV1): string {
    const normalized = normalizeQuery(query);
    const { continuation: _continuation, ...baseQuery } = normalized;
    return hashNormalizedQuery(baseQuery);
}

function normalizeExpression(
    expression: QueryExpression,
    depth: number,
    counter: { nodes: number },
): QueryExpression {
    if (expression === null || typeof expression !== "object") {
        return invalidArgument("Query expression must be an object");
    }
    counter.nodes++;
    if (depth > maximumExpressionDepth) {
        return invalidArgument("Query expression is too deeply nested", {
            maximumExpressionDepth,
        });
    }
    if (counter.nodes > maximumExpressionNodes) {
        return invalidArgument("Query expression contains too many nodes", {
            maximumExpressionNodes,
        });
    }

    switch (expression.type) {
        case "match":
            requireAllowedValues(
                expression.channels ?? ["lexical"],
                retrievalChannels,
                "match channels",
            );
            return {
                type: "match",
                clauseId: requireText(expression.clauseId, "clauseId"),
                text: normalizeMatchText(expression.text),
                channels: sortedUnique(expression.channels ?? ["lexical"]),
            };
        case "filter":
            return normalizeFilter(expression);
        case "not":
            return {
                type: "not",
                child: normalizeExpression(
                    expression.child,
                    depth + 1,
                    counter,
                ),
            };
        case "and":
        case "or":
        case "softAnd": {
            if (!Array.isArray(expression.children)) {
                return invalidArgument(
                    `${expression.type} children must be an array`,
                );
            }
            if (expression.children.length < 2) {
                return invalidArgument(
                    `${expression.type} requires at least two children`,
                );
            }
            const normalizedChildren = expression.children.map((child) =>
                normalizeExpression(child, depth + 1, counter),
            );
            const flattenedChildren =
                expression.type === "and" || expression.type === "or"
                    ? normalizedChildren.flatMap((child) =>
                          child.type === expression.type
                              ? child.children
                              : [child],
                      )
                    : normalizedChildren;
            const children = deduplicateAndSort(flattenedChildren);
            if (children.length < 2) {
                return invalidArgument(
                    `${expression.type} requires two distinct children`,
                );
            }
            if (expression.type === "softAnd") {
                const minimumShouldMatch = expression.minimumShouldMatch ?? 1;
                requireBoundedInteger(
                    minimumShouldMatch,
                    1,
                    children.reduce(
                        (total, child) => total + maximumHitCount(child),
                        0,
                    ),
                    "minimumShouldMatch",
                );
                return {
                    type: "softAnd",
                    children,
                    minimumShouldMatch,
                };
            }
            return { type: expression.type, children };
        }
        default:
            return invalidArgument("Invalid query expression type");
    }
}

function normalizeFilter(expression: FilterExpression): FilterExpression {
    const field = requireText(expression.field, "filter field");
    if (
        !new Set(["equals", "in", "exists", "prefix"]).has(expression.operator)
    ) {
        return invalidArgument("Invalid filter operator", {
            operator: expression.operator,
        });
    }
    if (expression.operator === "exists") {
        if (expression.value !== undefined) {
            return invalidArgument("exists filters must not specify a value", {
                field,
            });
        }
        return { type: "filter", field, operator: "exists" };
    }
    if (expression.value === undefined) {
        return invalidArgument("Filter requires a value", { field });
    }
    if (expression.operator === "in") {
        if (!Array.isArray(expression.value) || expression.value.length === 0) {
            return invalidArgument(
                "in filters require a non-empty value array",
                {
                    field,
                },
            );
        }
        return {
            type: "filter",
            field,
            operator: "in",
            value: sortedUnique(expression.value),
        };
    }
    if (Array.isArray(expression.value)) {
        return invalidArgument(
            `${expression.operator} filters require a scalar value`,
            { field },
        );
    }
    if (
        expression.operator === "prefix" &&
        typeof expression.value !== "string"
    ) {
        return invalidArgument("prefix filters require a string value", {
            field,
        });
    }
    return { ...expression, field };
}

function normalizeStructuralSource(source: StructuralSource): StructuralSource {
    switch (source.type) {
        case "term":
            return {
                type: "term",
                term: requireText(source.term, "source.term")
                    .replace(/\s+/g, " ")
                    .toLowerCase(),
            };
        case "artifact":
            return {
                type: "artifact",
                artifactId: asId(source.artifactId, "Artifact"),
            };
        case "turn":
            return {
                type: "turn",
                turnId: asId(source.turnId, "Turn"),
            };
        default:
            return invalidArgument("Invalid structural source type");
    }
}

function normalizeTemporal(selector: TemporalSelector): TemporalSelector {
    switch (selector.type) {
        case "asOf":
            return {
                type: "asOf",
                instant: requireAbsoluteTimestamp(selector.instant, "asOf"),
            };
        case "during":
        case "changedDuring": {
            const start = requireAbsoluteTimestamp(selector.start, "start");
            const end = requireAbsoluteTimestamp(selector.end, "end");
            if (Date.parse(start) >= Date.parse(end)) {
                return invalidArgument(
                    "Temporal interval start must be before end",
                    { start, end },
                );
            }
            return selector.type === "during"
                ? { type: "during", start, end }
                : {
                      type: "changedDuring",
                      start,
                      end,
                      projection: normalizeChangedProjection(
                          selector.projection,
                      ),
                  };
        }
        default:
            return invalidArgument("Invalid temporal selector type");
    }
}

function normalizeOrdering(
    orderBy: QueryIrV1["orderBy"],
): NonNullable<QueryIrV1["orderBy"]> {
    const normalized = [
        ...(orderBy ?? [
            { field: "hitCount", direction: "desc" },
            { field: "quality", direction: "desc" },
        ]),
    ];
    for (const order of normalized) {
        if (!orderFields.has(order.field)) {
            return invalidArgument("Invalid ordering field", {
                field: order.field,
            });
        }
        if (order.direction !== "asc" && order.direction !== "desc") {
            return invalidArgument("Invalid ordering direction", {
                direction: order.direction,
            });
        }
    }
    if (
        new Set(normalized.map((order) => order.field)).size !==
        normalized.length
    ) {
        return invalidArgument("Ordering fields must be unique");
    }
    if (!normalized.some((order) => order.field === "entityId")) {
        normalized.push({ field: "entityId", direction: "asc" });
    }
    return normalized;
}

function validateTimezone(timezone: QueryIrV1["timezone"]): void {
    if (timezone === undefined || timezone === null) {
        invalidArgument("Query requires resolved timezone metadata");
    }
    requireText(timezone.timeZone, "timezone.timeZone");
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone.timeZone });
    } catch {
        invalidArgument("timezone.timeZone must be an IANA time zone", {
            timeZone: timezone.timeZone,
        });
    }
    if (
        !Number.isInteger(timezone.utcOffsetMinutes) ||
        timezone.utcOffsetMinutes < -840 ||
        timezone.utcOffsetMinutes > 840
    ) {
        invalidArgument("timezone.utcOffsetMinutes is out of range", {
            utcOffsetMinutes: timezone.utcOffsetMinutes,
        });
    }
    requireAbsoluteTimestamp(timezone.resolvedAt, "timezone.resolvedAt");
}

function normalizeChangedProjection(
    projection: "matchingEvents" | "endState",
): "matchingEvents" | "endState" {
    if (projection !== "matchingEvents" && projection !== "endState") {
        return invalidArgument("Invalid changedDuring projection", {
            projection,
        });
    }
    return projection;
}

function normalizeContinuation(
    continuation: QueryContinuation | undefined,
    queryHash: string,
): QueryContinuation | undefined {
    if (continuation === undefined) {
        return undefined;
    }
    if (!hashPattern.test(continuation.queryHash)) {
        return invalidArgument("Continuation contains an invalid query hash");
    }
    if (continuation.queryHash !== queryHash) {
        return invalidArgument(
            "Continuation does not match the normalized query",
        );
    }
    requireSequence(continuation.indexVersion, "continuation.indexVersion");
    requireText(continuation.lastEntityId, "continuation.lastEntityId");
    return {
        queryHash,
        indexVersion: continuation.indexVersion,
        lastEntityId: continuation.lastEntityId,
        sortValues: [...continuation.sortValues],
    };
}

function hasPositiveMatch(
    expression: QueryExpression,
    negated = false,
): boolean {
    switch (expression.type) {
        case "match":
            return !negated;
        case "filter":
            return false;
        case "not":
            return hasPositiveMatch(expression.child, !negated);
        default:
            return expression.children.some((child) =>
                hasPositiveMatch(child, negated),
            );
    }
}

function maximumHitCount(expression: QueryExpression): number {
    switch (expression.type) {
        case "match":
            return 1;
        case "filter":
        case "not":
            return 0;
        case "or":
            return Math.min(
                1,
                Math.max(...expression.children.map(maximumHitCount)),
            );
        case "and":
        case "softAnd":
            return expression.children.reduce(
                (total, child) => total + maximumHitCount(child),
                0,
            );
    }
}

function requireUniqueClauseIds(expression: QueryExpression): void {
    const clauseIds: string[] = [];
    collectClauseIds(expression, clauseIds);
    if (new Set(clauseIds).size !== clauseIds.length) {
        invalidArgument("Logical clause IDs must be unique", { clauseIds });
    }
}

function collectClauseIds(
    expression: QueryExpression,
    clauseIds: string[],
): void {
    switch (expression.type) {
        case "match":
            clauseIds.push(expression.clauseId);
            break;
        case "filter":
            break;
        case "not":
            collectClauseIds(expression.child, clauseIds);
            break;
        default:
            for (const child of expression.children) {
                collectClauseIds(child, clauseIds);
            }
    }
}

function normalizeTopicTraversal(
    traversal: "exact" | "children" | "descendants",
): "exact" | "children" | "descendants" {
    if (!new Set(["exact", "children", "descendants"]).has(traversal)) {
        return invalidArgument("Invalid topic traversal", { traversal });
    }
    return traversal;
}

function normalizeTopicRoles(
    roles: readonly ("primary" | "secondary")[],
): ("primary" | "secondary")[] {
    requireAllowedValues(
        roles,
        new Set(["primary", "secondary"]),
        "topic roles",
    );
    return sortedUnique(roles);
}

function normalizeMatchText(value: string): string {
    return requireText(value, "match text").replace(/\s+/g, " ").toLowerCase();
}

function deduplicateAndSort(
    expressions: readonly QueryExpression[],
): QueryExpression[] {
    return [
        ...new Map(
            expressions.map((expression) => [
                canonicalJson(expression),
                expression,
            ]),
        ).entries(),
    ]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, expression]) => expression);
}

function sortedUnique<T extends QueryScalar>(values: readonly T[]): T[] {
    return [...new Set(values)].sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
    );
}

function requireAllowedValues(
    values: readonly string[],
    allowed: ReadonlySet<string>,
    name: string,
): void {
    if (!Array.isArray(values) || values.some((value) => !allowed.has(value))) {
        invalidArgument(`${name} contains an unsupported value`, { values });
    }
}

function requireBoundedInteger(
    value: number,
    minimum: number,
    maximum: number,
    name: string,
): void {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        invalidArgument(`${name} must be between ${minimum} and ${maximum}`, {
            name,
            value,
            minimum,
            maximum,
        });
    }
}

function hashNormalizedQuery(query: Omit<QueryIrV1, "continuation">): string {
    return createHash("sha256").update(canonicalJson(query)).digest("hex");
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
                ([key, entry]) =>
                    `${JSON.stringify(key)}:${canonicalJson(entry)}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
