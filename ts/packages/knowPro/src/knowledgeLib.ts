// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Knowledge functions
 */

import { getTopK } from "typeagent";
import { Scored } from "./common.js";
import {
    SemanticRef,
    ScoredSemanticRefOrdinal,
    ScoredKnowledge,
    KnowledgeType,
    Knowledge,
} from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";

export function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export function getTopKnowledge<T>(
    values: IterableIterator<Scored<T>>,
    type: KnowledgeType,
    toKnowledge: (item: T) => Knowledge,
    topK?: number,
) {
    let topKValues =
        topK !== undefined && topK > 0 ? getTopK(values, topK) : values;

    const mergedKnowledge: ScoredKnowledge[] = [];
    for (const scoredValue of topKValues) {
        mergedKnowledge.push({
            knowledgeType: type,
            knowledge: toKnowledge(scoredValue.item),
            score: scoredValue.score,
        });
    }
    return mergedKnowledge;
}

export function* getScoredSemanticRefsFromOrdinals(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    knowledgeType: KnowledgeType,
): IterableIterator<Scored<SemanticRef>> {
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs[semanticRefMatch.semanticRefOrdinal];
        if (semanticRef.knowledgeType === knowledgeType) {
            yield {
                score: semanticRefMatch.score,
                item: semanticRef,
            };
        }
    }
}
