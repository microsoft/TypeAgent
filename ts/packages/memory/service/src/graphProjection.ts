// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CorpusIndex } from "./types.js";

export async function readGraphProjection(
    index: CorpusIndex,
    sourceIds: ReadonlySet<string>,
    kind: "entities" | "topics",
    excludedNamesBySource?: ReadonlyMap<string, ReadonlySet<string>>,
) {
    if (!index.readKnowledgeGraph)
        throw new GraphProjectionUnavailable(
            "This index does not support bounded graph projections.",
        );
    return index.readKnowledgeGraph(sourceIds, kind, excludedNamesBySource);
}

export const graphProjectionLimits = {
    semanticReferences: 50000,
    nodes: 10000,
    edges: 20000,
} as const;

export class GraphProjectionUnavailable extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "GraphProjectionUnavailable";
    }
}

export function admitGraphReference(
    kind: "entities" | "topics" | undefined,
    examined: number,
    knowledgeType: string,
    nodes: number,
    edges: number,
): boolean {
    if (!kind) return true;
    if (examined > graphProjectionLimits.semanticReferences)
        throw new GraphProjectionUnavailable(
            "Graph projection exceeds the bounded semantic-reference scan budget; use a smaller corpus.",
        );
    if (nodes > graphProjectionLimits.nodes)
        throw new GraphProjectionUnavailable(
            "Graph projection exceeds the bounded node aggregation budget.",
        );
    if (edges > graphProjectionLimits.edges)
        throw new GraphProjectionUnavailable(
            "Graph projection exceeds the bounded edge aggregation budget.",
        );
    return kind === "topics"
        ? knowledgeType === "topic"
        : knowledgeType !== "topic";
}

export function excludedGraphKnowledge(
    knowledge: unknown,
    names: ReadonlySet<string> | undefined,
): boolean {
    if (!names?.size || !knowledge || typeof knowledge !== "object")
        return false;
    for (const key of [
        "name",
        "text",
        "subjectEntityName",
        "objectEntityName",
    ]) {
        if (key in knowledge) {
            const value = (knowledge as Record<string, unknown>)[key];
            if (
                typeof value === "string" &&
                names.has(value.trim().toLowerCase())
            )
                return true;
        }
    }
    return false;
}
