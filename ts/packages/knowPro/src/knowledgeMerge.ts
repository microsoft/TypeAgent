// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Functions to merge/combine more granular knowledge
 */

import { conversation as kpLib } from "knowledge-processor";
import { collections } from "typeagent";
import { unionArrays } from "./collections.js";
import { Scored } from "./common.js";
import {
    ISemanticRefCollection,
    MessageOrdinal,
    ScoredKnowledge,
    ScoredSemanticRefOrdinal,
    SemanticRef,
    Topic,
} from "./interfaces.js";
import {
    facetValueToString,
    getScoredSemanticRefsFromOrdinals,
    getTopKnowledge,
} from "./knowledgeLib.js";

export function getDistinctSemanticRefTopics(
    semanticRefs: ISemanticRefCollection,
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    topK?: number,
): ScoredKnowledge[] {
    const scoredTopics = getScoredSemanticRefsFromOrdinals(
        semanticRefs,
        semanticRefMatches,
        "topic",
    );
    let mergedTopics = mergeScoredTopics(scoredTopics, false);
    const mergedKnowledge = getTopKnowledge<MergedTopic>(
        mergedTopics.values(),
        "topic",
        (t) => t.topic,
        topK,
    );
    return mergedKnowledge;
}

export function getDistinctSemanticRefEntities(
    semanticRefs: ISemanticRefCollection,
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

export interface MergedKnowledge {
    /**
     * Message ordinals from which the entity was collected
     */
    sourceMessageOrdinals?: Set<MessageOrdinal> | undefined;
}

export interface MergedTopic extends MergedKnowledge {
    topic: Topic;
}

export interface MergedEntity extends MergedKnowledge {
    name: string;
    type: string[];
    facets?: MergedFacets | undefined;
}

type MergedFacets = collections.MultiMap<string, string>;

export function mergeScoredTopics(
    scoredTopics: Iterable<Scored<SemanticRef>>,
    mergeOrdinals: boolean,
): Map<string, Scored<MergedTopic>> {
    let mergedTopics = new Map<string, Scored<MergedTopic>>();
    for (let scoredTopic of scoredTopics) {
        const topic = scoredTopic.item.knowledge as Topic;
        let existing = mergedTopics.get(topic.text);
        if (existing) {
            if (existing.score < scoredTopic.score) {
                existing.score = scoredTopic.score;
            }
        } else {
            existing = {
                item: { topic },
                score: scoredTopic.score,
            };
            mergedTopics.set(topic.text, existing);
        }
        if (mergeOrdinals) {
            mergeMessageOrdinals(existing.item, scoredTopic.item);
        }
    }
    return mergedTopics;
}

export function mergeScoredConcreteEntities(
    scoredEntities: Iterable<Scored<SemanticRef>>,
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

function mergeMessageOrdinals(mergedEntity: MergedKnowledge, sr: SemanticRef) {
    mergedEntity.sourceMessageOrdinals ??= new Set<MessageOrdinal>();
    mergedEntity.sourceMessageOrdinals.add(sr.range.start.messageOrdinal);
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

export function mergedToConcreteEntity(
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
function unionEntities(to: MergedEntity, other: MergedEntity): boolean {
    if (to.name !== other.name) {
        return false;
    }
    to.type = unionArrays(to.type, other.type)!;
    to.facets = unionFacets(to.facets, other.facets);
    return true;
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
