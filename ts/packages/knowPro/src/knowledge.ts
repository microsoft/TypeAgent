// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Knowledge processing functions INTERNAL to the library.
 * These should not be exposed via index.ts
 */

import { conversation as kpLib } from "knowledge-processor";
import { async, asyncArray, collections, getTopK } from "typeagent";
import { unionArrays } from "./collections.js";
import {
    ScoredKnowledge,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    Topic,
} from "./interfaces.js";
import { Scored } from "./common.js";
import { ChatModel } from "aiclient";
import { createKnowledgeModel } from "./conversationIndex.js";
import { Result, success } from "typechat";

/**
 * Create a knowledge extractor using the given Chat Model
 * @param chatModel
 * @returns
 */
export function createKnowledgeExtractor(
    chatModel?: ChatModel,
): kpLib.KnowledgeExtractor {
    chatModel ??= createKnowledgeModel();
    const extractor = kpLib.createKnowledgeExtractor(chatModel, {
        maxContextLength: 4096,
        /**
         * This should *ALWAYS* be false.
         * Merging is handled during indexing:
         */
        mergeActionKnowledge: false,
    });
    return extractor;
}

export async function extractKnowledgeBatch(
    extractor: kpLib.KnowledgeExtractor,
    textBatch: string[],
    maxRetries: number,
): Promise<Result<kpLib.KnowledgeResponse[]>> {
    const results = await asyncArray.mapAsync(
        textBatch,
        textBatch.length,
        (text) =>
            async.callWithRetry(() =>
                extractor.extractWithRetry(text, maxRetries),
            ),
    );
    let responses: kpLib.KnowledgeResponse[] = [];
    for (const result of results) {
        if (result.success) {
            responses.push(result.data);
        } else {
            return result;
        }
    }
    return success(responses);
}

export function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export function mergeTopics(
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
    let topKTopics =
        topK !== undefined && topK > 0
            ? getTopK(mergedTopics.values(), topK)
            : mergedTopics.values();

    const mergedKnowledge: ScoredKnowledge[] = [];
    for (const scoredTopic of topKTopics) {
        mergedKnowledge.push({
            knowledgeType: "topic",
            knowledge: scoredTopic.item,
            score: scoredTopic.score,
        });
    }
    return mergedKnowledge;
}

export function mergedEntities(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    return mergeScoredEntities(
        getScoredEntities(semanticRefs, semanticRefMatches),
        topK,
    );
}

type MergedEntity = {
    name: string;
    type: string[];
    facets?: MergedFacets | undefined;
};

type MergedFacets = collections.MultiMap<string, string>;

function mergeScoredEntities(
    scoredEntities: IterableIterator<Scored<kpLib.ConcreteEntity>>,
    topK?: number,
): ScoredKnowledge[] {
    let mergedEntities = new Map<string, Scored<MergedEntity>>();
    for (let scoredEntity of scoredEntities) {
        const mergedEntity = concreteToMergedEntity(scoredEntity.item);
        const existing = mergedEntities.get(mergedEntity.name);
        if (existing) {
            if (unionEntities(existing.item, mergedEntity)) {
                if (existing.score < scoredEntity.score) {
                    existing.score = scoredEntity.score;
                }
            }
        } else {
            mergedEntities.set(mergedEntity.name, {
                item: mergedEntity,
                score: scoredEntity.score,
            });
        }
    }

    let topKEntities =
        topK !== undefined && topK > 0
            ? getTopK(mergedEntities.values(), topK)
            : mergedEntities.values();

    const mergedKnowledge: ScoredKnowledge[] = [];
    for (const scoredEntity of topKEntities) {
        mergedKnowledge.push({
            knowledgeType: "entity",
            knowledge: mergedToConcreteEntity(scoredEntity.item),
            score: scoredEntity.score,
        });
    }
    return mergedKnowledge;
}

/**
 * In place union
 */
function unionEntities(to: MergedEntity, other: MergedEntity): boolean {
    if (to.name !== other.name) {
        return false;
    }
    to.type = unionArrays(to.type, other.type)!;
    to.facets = unionFacets(to.facets, other.facets);
    return true;
}

function concreteToMergedEntity(entity: kpLib.ConcreteEntity): MergedEntity {
    let type = [...entity.type];
    collections.lowerAndSort(type);
    return {
        name: entity.name.toLowerCase(),
        type: type,
        facets: entity.facets ? facetsToMergedFacets(entity.facets) : undefined,
    };
}

function mergedToConcreteEntity(
    mergedEntity: MergedEntity,
): kpLib.ConcreteEntity {
    const entity: kpLib.ConcreteEntity = {
        name: mergedEntity.name,
        type: mergedEntity.type,
    };
    if (mergedEntity.facets && mergedEntity.facets.size > 0) {
        entity.facets = mergedFacetsToFacets(mergedEntity.facets);
    }
    return entity;
}

function facetsToMergedFacets(facets: kpLib.Facet[]): MergedFacets {
    const mergedFacets: MergedFacets = new collections.MultiMap<
        string,
        string
    >();
    for (const facet of facets) {
        const name = facet.name.toLowerCase();
        const value = facetValueToString(facet).toLowerCase();
        mergedFacets.addUnique(name, value);
    }
    return mergedFacets;
}

function mergedFacetsToFacets(mergedFacets: MergedFacets): kpLib.Facet[] {
    const facets: kpLib.Facet[] = [];
    for (const facetName of mergedFacets.keys()) {
        const facetValues = mergedFacets.get(facetName);
        if (facetValues && facetValues.length > 0) {
            const facet: kpLib.Facet = {
                name: facetName,
                value: facetValues.join("; "),
            };
            facets.push(facet);
        }
    }
    return facets;
}

/**
 * In place union
 */
function unionFacets(
    to: MergedFacets | undefined,
    other: MergedFacets | undefined,
): MergedFacets | undefined {
    if (to === undefined) {
        return other;
    }
    if (other === undefined) {
        return to;
    }
    for (const facetName of other.keys()) {
        const facetValues = other.get(facetName);
        if (facetValues) {
            for (let i = 0; i < facetValues.length; ++i) {
                to.addUnique(facetName, facetValues[i]);
            }
        }
    }
    return to;
}

function* getScoredEntities(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
): IterableIterator<Scored<kpLib.ConcreteEntity>> {
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs[semanticRefMatch.semanticRefOrdinal];
        if (semanticRef.knowledgeType === "entity") {
            yield {
                score: semanticRefMatch.score,
                item: semanticRef.knowledge as kpLib.ConcreteEntity,
            };
        }
    }
}
