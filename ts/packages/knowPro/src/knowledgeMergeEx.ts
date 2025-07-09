// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Functions to merge/combine more granular knowledge
 *
 * A newer version of knowledgeMerge.ts, where the entity merge doesn't force the data to become lower case.
 */

import { conversation as kpLib } from "knowledge-processor";
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
    type: Map<string, string>;
    facets?: MergedFacets | undefined;
}

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

export type EntityMergeOptions = {
    /* Case sensitive when merging for entity names, types and facets. */
    caseSensitive?: boolean; // default to false
};

export function mergeScoredConcreteEntities(
    scoredEntities: Iterable<Scored<SemanticRef>>,
    mergeOrdinals: boolean,
    options?: EntityMergeOptions,
): Map<string, Scored<MergedEntity>> {
    let mergedEntities = new Map<string, Scored<MergedEntity>>();
    for (let scoredEntity of scoredEntities) {
        const concreteEntity = scoredEntity.item
            .knowledge as kpLib.ConcreteEntity;

        const caseSensitive = options?.caseSensitive === true;
        const nameKey = caseSensitive
            ? concreteEntity.name
            : concreteEntity.name.toLowerCase();
        let existing = mergedEntities.get(nameKey);
        if (existing) {
            if (unionEntities(existing.item, concreteEntity, options)) {
                if (existing.score < scoredEntity.score) {
                    existing.score = scoredEntity.score;
                }
            } else {
                existing = undefined;
            }
        } else {
            existing = {
                item: concreteToMergedEntity(concreteEntity, options),
                score: scoredEntity.score,
            };
            mergedEntities.set(nameKey, existing);
        }
        if (existing && mergeOrdinals) {
            mergeMessageOrdinals(existing.item, scoredEntity.item);
        }
    }
    return mergedEntities;
}

export function mergeConcreteEntities(
    entities: kpLib.ConcreteEntity[],
    options?: EntityMergeOptions,
): kpLib.ConcreteEntity[] {
    let mergedEntities = concreteToMergedEntities(entities, options);

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

function concreteToMergedEntities(
    entities: kpLib.ConcreteEntity[],
    options?: EntityMergeOptions,
): Map<string, MergedEntity> {
    const mergedEntities = new Map<string, MergedEntity>();
    const caseSensitive = options?.caseSensitive === true;
    for (const entity of entities) {
        const nameKey = caseSensitive ? entity.name : entity.name.toLowerCase();
        const existing = mergedEntities.get(nameKey);
        if (existing) {
            unionEntities(existing, entity, options);
        } else {
            mergedEntities.set(
                nameKey,
                concreteToMergedEntity(entity, options),
            );
        }
    }
    return mergedEntities;
}

function concreteToMergedEntity(
    entity: kpLib.ConcreteEntity,
    options?: EntityMergeOptions,
): MergedEntity {
    const caseSensitive = options?.caseSensitive === true;
    const name = entity.name;
    const type = new Map<string, string>(
        caseSensitive
            ? entity.type.map((t) => [t, t])
            : entity.type.map((t) => [t.toLowerCase(), t]),
    );
    return {
        name,
        type,
        facets: entity.facets
            ? facetsToMergedFacets(entity.facets, options)
            : undefined,
    };
}

export function mergedToConcreteEntity(
    mergedEntity: MergedEntity,
): kpLib.ConcreteEntity {
    const entity: kpLib.ConcreteEntity = {
        name: mergedEntity.name,
        type: [...mergedEntity.type.values()].sort(), // sort just for stability
    };
    if (mergedEntity.facets && mergedEntity.facets.size > 0) {
        entity.facets = mergedFacetsToFacets(mergedEntity.facets);
    }
    return entity;
}

type MergedFacets = Map<string, { name: string; values: Map<string, string> }>;

function facetsToMergedFacets(
    facets: kpLib.Facet[],
    options?: EntityMergeOptions,
): MergedFacets {
    const mergedFacets: MergedFacets = new Map();
    addMergeFacets(mergedFacets, facets, options);
    return mergedFacets;
}

function addMergeFacets(
    mergedFacets: MergedFacets,
    facets: kpLib.Facet[],
    options?: EntityMergeOptions,
) {
    for (const facet of facets) {
        const name = facet.name;
        const value = facetValueToString(facet);
        const caseSensitive = options?.caseSensitive === true;
        const nameKey = caseSensitive ? name : name.toLowerCase();
        const valueKey = caseSensitive ? value : value.toLowerCase();

        const existing = mergedFacets.get(nameKey);
        if (existing) {
            // For case-sensitive, keep using existing name/value when merging.
            const existingValues = existing.values.get(valueKey);
            if (existingValues) {
                continue;
            }
            existing.values.set(valueKey, value);
        } else {
            mergedFacets.set(nameKey, {
                name,
                values: new Map([[valueKey, value]]),
            });
        }
    }
}

function mergedFacetsToFacets(mergedFacets: MergedFacets): kpLib.Facet[] {
    const facets: kpLib.Facet[] = [];
    for (const { name, values } of mergedFacets.values()) {
        const facet: kpLib.Facet = {
            name,
            value: [...values.values()].join("; "),
        };
        facets.push(facet);
    }
    return facets;
}

/**
 * In place union
 */
function unionEntities(
    to: MergedEntity,
    other: kpLib.ConcreteEntity,
    options: EntityMergeOptions | undefined,
): boolean {
    addTypes(to.type, other.type, options);
    to.facets = unionFacets(to.facets, other.facets, options);
    return true;
}

function addTypes(
    to: Map<string, string>,
    other: string[],
    options: EntityMergeOptions | undefined,
): boolean {
    const caseSensitive = options?.caseSensitive === true;
    for (const t of other) {
        const key = caseSensitive ? t : t.toLowerCase();
        if (to.has(key)) {
            // Already exists, skip
            continue;
        }
        to.set(key, t);
    }
    return true;
}

/**
 * In place union
 */
function unionFacets(
    to: MergedFacets | undefined,
    other: kpLib.Facet[] | undefined,
    options: EntityMergeOptions | undefined,
): MergedFacets | undefined {
    if (other === undefined) {
        return to;
    }
    if (to === undefined) {
        return facetsToMergedFacets(other, options);
    }
    addMergeFacets(to, other, options);
    return to;
}
