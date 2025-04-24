// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Knowledge functions
 */

import { getTopK } from "typeagent";
import { Scored, getScoredSemanticRefsFromOrdinals } from "./common.js";
import {
    SemanticRef,
    ScoredSemanticRefOrdinal,
    ScoredKnowledge,
    Topic,
    KnowledgeType,
    Knowledge,
} from "./interfaces.js";
import {
    mergeScoredConcreteEntities,
    MergedEntity,
    mergedToConcreteEntity,
} from "./knowledgeMerge.js";

export function getDistinctSemanticRefTopics(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    let mergedTopics = new Map<string, Scored<Topic>>();
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs[semanticRefMatch.semanticRefOrdinal];
        if (semanticRef.knowledgeType !== "topic") {
            continue;
        }
        const topic = semanticRef.knowledge as Topic;
        const existing = mergedTopics.get(topic.text);
        if (existing) {
            if (existing.score < semanticRefMatch.score) {
                existing.score = semanticRefMatch.score;
            }
        } else {
            mergedTopics.set(topic.text, {
                item: topic,
                score: semanticRefMatch.score,
            });
        }
    }
    const mergedKnowledge = getTopKnowledge<Topic>(
        mergedTopics.values(),
        "topic",
        (t) => t,
        topK,
    );
    return mergedKnowledge;
}

export function getDistinctSemanticRefEntities(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    const scoredEntities = getScoredSemanticRefsFromOrdinals(
        semanticRefs,
        semanticRefMatches,
        "entity",
    );
    let mergedEntities = mergeScoredConcreteEntities(scoredEntities, false);
    const mergedKnowledge: ScoredKnowledge[] = getTopKnowledge<MergedEntity>(
        mergedEntities.values(),
        "entity",
        (m) => mergedToConcreteEntity(m),
        topK,
    );
    return mergedKnowledge;
}
function getTopKnowledge<T>(
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
