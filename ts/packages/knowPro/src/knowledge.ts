// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { async, asyncArray, collections, getTopK } from "typeagent";
import { unionArrays } from "./collections.js";
import {
    MessageOrdinal,
    ScoredKnowledge,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    Topic,
} from "./interfaces.js";
import { Scored } from "./common.js";
import { error, Result } from "typechat";
import { BatchTask, runInBatches } from "./taskQueue.js";
import { ChatModel } from "aiclient";
import { createKnowledgeModel } from "./conversationIndex.js";

/**
 * Contains a mix of public methods exposed via index.ts and internal only
 * May need to refactor
 */

//----------------
// PUBLIC FUNCTIONS
// Exposed directly via index.ts
//---------------

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

export function extractKnowledgeFromText(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    text: string,
    maxRetries: number,
): Promise<Result<kpLib.KnowledgeResponse>> {
    return async.callWithRetry(() =>
        knowledgeExtractor.extractWithRetry(text, maxRetries),
    );
}

export function extractKnowledgeFromTextBatch(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    textBatch: string[],
    concurrency: number = 2,
    maxRetries: number = 3,
): Promise<Result<kpLib.KnowledgeResponse>[]> {
    return asyncArray.mapAsync(textBatch, concurrency, (text) =>
        extractKnowledgeFromText(knowledgeExtractor, text, maxRetries),
    );
}

export function mergeConcreteEntities(
    entities: kpLib.ConcreteEntity[],
): kpLib.ConcreteEntity[] {
    let mergedEntities = concreteToMergedEntities(entities);

    const mergedConcreteEntities: kpLib.ConcreteEntity[] = [];
    for (const mergedEntity of mergedEntities.values()) {
        mergedConcreteEntities.push(mergedToConcreteEntity(mergedEntity));
    }
    return mergedConcreteEntities;
}

export function mergeTopics(topics: string[]): string[] {
    let mergedTopics = new Set<string>();
    for (let topic of topics) {
        mergedTopics.add(topic);
    }
    return [...mergedTopics.values()];
}

//-----------------------
// INTERNAL FUNCTIONS
//-----------------------

export async function extractKnowledgeForTextBatchQ(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    textBatch: string[],
    concurrency: number = 2,
    maxRetries: number = 3,
): Promise<Result<kpLib.KnowledgeResponse>[]> {
    const taskBatch: BatchTask<string, kpLib.KnowledgeResponse>[] =
        textBatch.map((text) => {
            return {
                task: text,
            };
        });
    await runInBatches<string, kpLib.KnowledgeResponse>(
        taskBatch,
        (text: string) =>
            extractKnowledgeFromText(knowledgeExtractor, text, maxRetries),
        concurrency,
    );
    const results: Result<kpLib.KnowledgeResponse>[] = [];
    for (const task of taskBatch) {
        results.push(task.result ? task.result : error("No result"));
    }
    return results;
}

export function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export function mergeSemanticRefTopics(
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

export function mergeSemanticRefEntities(
    semanticRefs: SemanticRef[],
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    return getTopKMergedConcreteEntities(
        getScoredEntities(semanticRefs, semanticRefMatches),
        topK,
    );
}

type MergedEntity = {
    name: string;
    type: string[];
    facets?: MergedFacets | undefined;
    /**
     * Message ordinals from which the entity was collected
     */
    messageOrdinals?: Set<MessageOrdinal> | undefined;
};

type MergedFacets = collections.MultiMap<string, string>;

function getTopKMergedConcreteEntities(
    scoredEntities: IterableIterator<Scored<SemanticRef>>,
    topK?: number,
): ScoredKnowledge[] {
    let mergedEntities = mergeScoredConcreteEntities(scoredEntities, false);

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

export function mergeScoredConcreteEntities(
    scoredEntities: IterableIterator<Scored<SemanticRef>>,
    mergeOrdinals: boolean,
): Map<string, Scored<MergedEntity>> {
    let mergedEntities = new Map<string, Scored<MergedEntity>>();
    for (let scoredEntity of scoredEntities) {
        const mergedEntity = concreteToMergedEntity(
            scoredEntity.item.knowledge as kpLib.ConcreteEntity,
        );
        let existing = mergedEntities.get(mergedEntity.name);
        if (existing) {
            if (unionEntities(existing.item, mergedEntity)) {
                if (existing.score < scoredEntity.score) {
                    existing.score = scoredEntity.score;
                }
            } else {
                existing = undefined;
            }
        } else {
            existing = {
                item: mergedEntity,
                score: scoredEntity.score,
            };
            mergedEntities.set(mergedEntity.name, existing);
        }
        if (existing && mergeOrdinals) {
            mergeMessageOrdinals(existing.item, scoredEntity.item);
        }
    }
    return mergedEntities;
}

function mergeMessageOrdinals(mergedEntity: MergedEntity, sr: SemanticRef) {
    mergedEntity.messageOrdinals ??= new Set<MessageOrdinal>();
    mergedEntity.messageOrdinals.add(sr.range.start.messageOrdinal);
}

export function concreteToMergedEntities(
    entities: kpLib.ConcreteEntity[],
): Map<string, MergedEntity> {
    let mergedEntities = new Map<string, MergedEntity>();
    for (let entity of entities) {
        const mergedEntity = concreteToMergedEntity(entity);
        const existing = mergedEntities.get(mergedEntity.name);
        if (existing) {
            unionEntities(existing, mergedEntity);
        } else {
            mergedEntities.set(mergedEntity.name, mergedEntity);
        }
    }
    return mergedEntities;
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
): IterableIterator<Scored<SemanticRef>> {
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs[semanticRefMatch.semanticRefOrdinal];
        if (semanticRef.knowledgeType === "entity") {
            yield {
                score: semanticRefMatch.score,
                item: semanticRef,
            };
        }
    }
}
