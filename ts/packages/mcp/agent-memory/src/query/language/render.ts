// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    normalizeQuery,
    type FilterExpression,
    type NormalizedQueryIrV1,
    type QueryExpression,
    type QueryIrV1,
    type QueryScalar,
} from "../ir/index.js";

export function renderQueryLanguage(query: QueryIrV1): string {
    const normalized = normalizeQuery(query);
    const controls: string[] = [];
    if (!isPathSentinel(normalized.expression)) {
        controls.push(`where ${renderExpression(normalized.expression)}`);
    }
    if (normalized.temporal !== undefined) {
        switch (normalized.temporal.type) {
            case "during":
                controls.push(
                    `during ${quote(`[${normalized.temporal.start},${normalized.temporal.end})`)}`,
                );
                break;
            case "asOf":
                controls.push(`asof ${quote(normalized.temporal.instant)}`);
                break;
            case "changedDuring":
                controls.push(
                    `changed ${quote(`[${normalized.temporal.start},${normalized.temporal.end})`)} ${normalized.temporal.projection}`,
                );
                break;
        }
    }
    controls.push(`detail ${normalized.detail}`);
    controls.push(
        `order ${normalized
            .orderBy!.map((order) => `${order.field}:${order.direction}`)
            .join(",")}`,
    );
    controls.push(`limit ${normalized.maxResults}`);
    controls.push(`tokens ${normalized.tokenBudget}`);
    return `${renderPath(normalized)} ${controls.join(" ")}`;
}

function renderPath(query: NormalizedQueryIrV1): string {
    if (query.topic !== undefined) {
        const rootSegments = query.topic.rootPath.slice(1).split("/");
        const kind = query.targetKinds[0]!;
        const root = rootSegments
            .map((segment, index) =>
                encodeSegment(
                    segment,
                    kind === "topic" &&
                        query.topic!.traversal === "exact" &&
                        index === rootSegments.length - 1 &&
                        reservedTopicSuffixes.has(segment),
                ),
            )
            .join("/");
        const wildcard =
            query.topic.traversal === "children"
                ? "/*"
                : query.topic.traversal === "descendants"
                  ? "/**"
                  : "";
        if (kind === "property") {
            const propertyName = findPropertyName(query.expression);
            if (propertyName === undefined) {
                throw new Error(
                    "Property query cannot be rendered without a propertyName filter",
                );
            }
            return `/topics/${root}${wildcard}/properties/${encodeSegment(propertyName)}`;
        }
        return `/topics/${root}${wildcard}${topicSuffixes[kind] ?? ""}`;
    }
    switch (query.source?.type) {
        case "term":
            return `/terms/${encodeSegment(query.source.term)}/${
                query.targetKinds[0] === "topic" ? "topics" : "turns"
            }`;
        case "artifact":
            return `/artifacts/${encodeSegment(query.source.artifactId)}/turns`;
        case "turn":
            return `/turns/${encodeSegment(query.source.turnId)}`;
        default:
            throw new Error("Query cannot be rendered without a path source");
    }
}

const topicSuffixes: Readonly<Partial<Record<string, string>>> = {
    topic: "",
    turn: "/turns",
    term: "/terms",
    action: "/actions",
    artifact: "/artifacts",
    goal: "/goals",
    output: "/outputs",
    designNote: "/design-notes",
};

const reservedTopicSuffixes = new Set([
    "turns",
    "terms",
    "actions",
    "artifacts",
    "goals",
    "outputs",
    "design-notes",
    "properties",
]);

function renderExpression(expression: QueryExpression): string {
    switch (expression.type) {
        case "match":
            return quote(expression.text);
        case "filter":
            return renderFilter(expression);
        case "not":
            return `!${renderGrouped(expression.child)}`;
        case "and":
            return expression.children.map(renderGrouped).join(" & ");
        case "or":
            return expression.children.map(renderGrouped).join(" | ");
        case "softAnd":
            return expression.children.map(renderGrouped).join(" + ");
    }
}

function renderGrouped(expression: QueryExpression): string {
    return expression.type === "match" || expression.type === "filter"
        ? renderExpression(expression)
        : `(${renderExpression(expression)})`;
}

function renderFilter(filter: FilterExpression): string {
    if (
        filter.operator !== "equals" ||
        filter.value === undefined ||
        typeof filter.value === "object"
    ) {
        throw new Error(
            `Filter operator '${filter.operator}' is not representable in query language v1`,
        );
    }
    return `${filter.field}=${renderScalar(filter.value)}`;
}

function renderScalar(value: QueryScalar): string {
    return typeof value === "string" ? quote(value) : String(value);
}

function findPropertyName(expression: QueryExpression): string | undefined {
    if (
        expression.type === "filter" &&
        expression.field === "propertyName" &&
        expression.operator === "equals" &&
        typeof expression.value === "string"
    ) {
        return expression.value;
    }
    if (
        expression.type === "and" ||
        expression.type === "or" ||
        expression.type === "softAnd"
    ) {
        for (const child of expression.children) {
            const value = findPropertyName(child);
            if (value !== undefined) {
                return value;
            }
        }
    }
    return undefined;
}

function isPathSentinel(expression: QueryExpression): boolean {
    return (
        expression.type === "filter" &&
        expression.field === "entityId" &&
        expression.operator === "exists"
    );
}

function quote(value: string): string {
    return JSON.stringify(value);
}

function encodeSegment(value: string, forceLiteral = false): string {
    if (forceLiteral) {
        return quote(value);
    }
    return encodeURIComponent(value).replace(/\*/g, "%2A");
}
