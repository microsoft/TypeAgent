// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    SearchOptions,
    asyncArray,
    collections,
    createObjectFolder,
    dateTime,
} from "typeagent";
import {
    TextIndex,
    TextIndexSettings,
    createTextIndex,
} from "../knowledgeIndex.js";
import path from "path";
import { ExtractedEntity, knowledgeValueToString } from "./knowledge.js";
import { TextBlock, TextBlockType } from "../text.js";
import { EntityFilter } from "./knowledgeSearchSchema.js";
import {
    FrequencyTable,
    SetOp,
    WithFrequency,
    addToSet,
    createFrequencyTable,
    intersect,
    intersectMultiple,
    intersectUnionMultiple,
    removeUndefined,
    unionArrays,
    unionMultiple,
    uniqueFrom,
} from "../setOperations.js";
import {
    TemporalLog,
    createTemporalLog,
    filterTemporalSequence,
    getRangeOfTemporalSequence,
    itemsFromTemporalSequence,
} from "../temporal.js";
import { toStopDate, toStartDate } from "./knowledgeActions.js";
import { ConcreteEntity, Facet } from "./knowledgeSchema.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";

export interface EntityIndex<TEntityId = any, TSourceId = any, TTextId = any> {
    readonly settings: TextIndexSettings;
    readonly sequence: TemporalLog<TEntityId, TEntityId[]>;
    readonly nameIndex: TextIndex<TTextId, TEntityId>;
    readonly typeIndex: TextIndex<TTextId, TEntityId>;
    readonly facetIndex: TextIndex<TTextId, TEntityId>;
    entities(): AsyncIterableIterator<ExtractedEntity<TSourceId>>;
    get(id: TEntityId): Promise<ExtractedEntity<TSourceId> | undefined>;
    getMultiple(ids: TEntityId[]): Promise<ExtractedEntity<TSourceId>[]>;
    getSourceIds(ids: TEntityId[]): Promise<TSourceId[]>;
    getEntities(ids: TEntityId[]): Promise<ConcreteEntity[]>;
    put(entity: ExtractedEntity<TSourceId>, id?: TEntityId): Promise<TEntityId>;
    putMultiple(
        entities: ExtractedEntity<TSourceId>[],
        ids?: TEntityId[],
    ): Promise<TEntityId[]>;
    putNext(
        entities: ExtractedEntity<TSourceId>[],
        timestamp?: Date,
    ): Promise<TEntityId[]>;
    search(
        filter: EntityFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<TEntityId>>;
    searchTerms(
        filter: TermFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<TEntityId>>;
    loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: EntitySearchResult<TEntityId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined>;
}

export interface EntitySearchOptions extends SearchOptions {
    loadEntities?: boolean | undefined;
    nameSearchOptions?: SearchOptions | undefined;
    matchNameToType: boolean;
    combinationSetOp?: SetOp | undefined;
}

export async function createEntityIndex<TSourceId = string>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<EntityIndex<string, TSourceId, string>> {
    type EntityId = string;
    const sequence = await createTemporalLog<EntityId[]>(
        { concurrency: settings.concurrency },
        path.join(rootPath, "sequence"),
        folderSettings,
        fSys,
    );
    const entries = await createObjectFolder<ExtractedEntity<TSourceId>>(
        path.join(rootPath, "entries"),
        folderSettings,
        fSys,
    );
    const nameIndex = await createTextIndex<EntityId>(
        settings,
        path.join(rootPath, "names"),
        folderSettings,
        fSys,
    );
    const typeIndex = await createTextIndex<EntityId>(
        settings,
        path.join(rootPath, "types"),
        folderSettings,
        fSys,
    );
    const facetIndex = await createTextIndex<EntityId>(
        settings,
        path.join(rootPath, "facets"),
        folderSettings,
        fSys,
    );
    return {
        settings,
        sequence,
        nameIndex,
        typeIndex,
        facetIndex,
        entities: entries.allObjects,
        get: entries.get,
        getMultiple,
        getSourceIds,
        getEntities,
        put,
        putMultiple,
        putNext,
        search,
        searchTerms,
        loadSourceIds,
    };

    async function getMultiple(
        ids: EntityId[],
    ): Promise<ExtractedEntity<TSourceId>[]> {
        const entities = await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            (id) => entries.get(id),
        );
        return removeUndefined(entities);
    }

    async function getSourceIds(ids: EntityId[]): Promise<TSourceId[]> {
        const entities = await getMultiple(ids);
        const unique = uniqueFrom<ExtractedEntity<TSourceId>>(
            entities,
            (e) => e.sourceIds,
            true,
        );
        return unique ? unique : [];
    }

    async function getEntities(ids: EntityId[]): Promise<ConcreteEntity[]> {
        return await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            async (id) => {
                const entity = (await entries.get(id))!;
                return entity.value;
            },
        );
    }

    async function putNext(
        entities: ExtractedEntity<TSourceId>[],
        timestamp?: Date,
    ): Promise<EntityId[]> {
        const entityIds = await asyncArray.mapAsync(entities, 1, (e) =>
            entries.put(e),
        );

        entityIds.sort();
        await sequence.put(entityIds, timestamp);
        return entityIds;
    }

    async function put(
        extractedEntity: ExtractedEntity<TSourceId>,
        id?: EntityId,
    ): Promise<EntityId> {
        const entityId = id ? id : await entries.put(extractedEntity);
        const sourceIds: EntityId[] = [entityId];
        await Promise.all([
            addName(extractedEntity.value.name, sourceIds),
            addTypes(extractedEntity.value.type, sourceIds),
            addFacets(extractedEntity.value.facets, sourceIds),
        ]);
        return entityId;
    }

    async function putMultiple(
        entities: ExtractedEntity<TSourceId>[],
        ids?: EntityId[],
    ): Promise<EntityId[]> {
        if (ids && entities.length !== ids?.length) {
            throw Error("Id length mismatch");
        }
        // TODO: parallelize
        return asyncArray.mapAsync(entities, 1, (entity, i) =>
            put(entity, ids ? ids[i] : undefined),
        );
    }

    async function addName(name: string, entityIds: EntityId[]): Promise<void> {
        await nameIndex.put(name, entityIds);
    }

    async function addTypes(
        type: string[],
        entityIds: EntityId[],
    ): Promise<void> {
        const typeEntries: TextBlock[] = type.map((t) => {
            return {
                value: t,
                entityIds,
                type: TextBlockType.Word,
            };
        });
        await typeIndex.putMultiple(typeEntries);
    }

    async function addFacets(
        facets: Facet[] | undefined,
        entityIds: EntityId[],
    ) {
        if (facets && facets.length > 0) {
            const facetEntries: TextBlock[] = facets.map((f) => {
                return {
                    value: facetToString(f),
                    entityIds,
                    type: TextBlockType.Word,
                };
            });
            await facetIndex.putMultiple(facetEntries);
        }
    }

    async function search(
        filter: EntityFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<EntityId>> {
        const results = createSearchResults();
        let typeMatchIds: EntityId[] | undefined;
        let nameMatchIds: EntityId[] | IterableIterator<EntityId> | undefined;
        let nameTypeMatchIds: EntityId[] | undefined;
        if (filter.timeRange) {
            results.temporalSequence = await sequence.getEntriesInRange(
                toStartDate(filter.timeRange.startDate),
                toStopDate(filter.timeRange.stopDate),
            );
        }
        if (filter.type && filter.type.length > 0) {
            typeMatchIds = await typeIndex.getNearestMultiple(
                filter.type,
                options.combinationSetOp ?? SetOp.Intersect,
                {
                    maxMatches: options.maxMatches,
                    minScore: options.minScore,
                },
            );
        }
        if (filter.name && filter.name.length > 0) {
            nameMatchIds = await nameIndex.getNearest(
                filter.name,
                options.nameSearchOptions?.maxMatches ?? options.maxMatches,
                options.nameSearchOptions?.minScore ?? options.minScore,
            );
            if (
                options.matchNameToType &&
                (nameMatchIds === undefined || nameMatchIds.length == 0)
            ) {
                // The AI will often mix types and names...
                nameTypeMatchIds = await typeIndex.getNearest(
                    filter.name,
                    options.maxMatches,
                    options.minScore,
                );
            }
            if (nameTypeMatchIds && nameTypeMatchIds.length > 0) {
                nameMatchIds = unionMultiple(nameMatchIds, nameTypeMatchIds);
            }
        }
        results.entityIds = [
            ...intersectMultiple(
                intersectUnionMultiple(typeMatchIds, nameMatchIds),
                itemsFromTemporalSequence(results.temporalSequence),
            ),
        ];
        if (results.entityIds && results.temporalSequence) {
            // The temporal sequence maintains all entity ids seen at a timestamp.
            // Since we identified specific entity ids, we remove the other ones
            results.temporalSequence = filterTemporalSequence(
                results.temporalSequence,
                results.entityIds,
            );
        }
        if (options.loadEntities && results.entityIds) {
            results.entities = await getEntities(results.entityIds);
        }
        return results;
    }

    async function searchTerms(
        filter: TermFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<EntityId>> {
        const results = createSearchResults();
        if (filter.timeRange) {
            results.temporalSequence = await sequence.getEntriesInRange(
                toStartDate(filter.timeRange.startDate),
                toStopDate(filter.timeRange.stopDate),
            );
        }
        if (filter.terms && filter.terms.length > 0) {
            const hitCounter = createFrequencyTable<EntityId>();
            await Promise.all([
                nameIndex.getNearestHitsMultiple(
                    filter.terms,
                    hitCounter,
                    options.nameSearchOptions?.maxMatches ?? options.maxMatches,
                    options.nameSearchOptions?.minScore ?? options.minScore,
                ),
                typeIndex.getNearestHitsMultiple(
                    filter.terms,
                    hitCounter,
                    options.maxMatches,
                    options.minScore,
                ),
                facetIndex.getNearestHitsMultiple(
                    filter.terms,
                    hitCounter,
                    options.maxMatches,
                    options.minScore,
                ),
            ]);
            const entityHits = hitCounter.getTop();
            results.entityIds = [
                ...intersectMultiple(
                    entityHits,
                    itemsFromTemporalSequence(results.temporalSequence),
                ),
            ];
        }
        if (results.entityIds && results.temporalSequence) {
            // The temporal sequence maintains all entity ids seen at a timestamp.
            // Since we identified specific entity ids, we remove the other ones
            results.temporalSequence = filterTemporalSequence(
                results.temporalSequence,
                results.entityIds,
            );
        }
        if (options.loadEntities && results.entityIds) {
            results.entities = await getEntities(results.entityIds);
        }
        return results;
    }

    async function loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: EntitySearchResult<EntityId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined> {
        unique ??= new Set<TSourceId>();
        if (results.length === 0) {
            return unique;
        }
        await asyncArray.forEachAsync(
            results,
            settings.concurrency,
            async (e) => {
                if (e.entityIds && e.entityIds.length > 0) {
                    const ids = await getSourceIds(e.entityIds);
                    const timeRange = e.getTemporalRange();
                    if (timeRange) {
                        const idRange = await sourceIdLog.getIdsInRange(
                            timeRange.startDate,
                            timeRange.stopDate,
                        );
                        addToSet(unique, intersect(ids, idRange));
                    } else {
                        addToSet(unique, ids);
                    }
                }
            },
        );
        return unique.size === 0 ? undefined : unique;
    }
}

export interface EntitySearchResult<TEntityId = any> {
    entityIds?: TEntityId[] | undefined;
    entities?: ConcreteEntity[];
    temporalSequence?: dateTime.Timestamped<TEntityId[]>[] | undefined;

    getTemporalRange(): dateTime.DateRange | undefined;
}

function createSearchResults<TEntityId = any>(): EntitySearchResult<TEntityId> {
    return {
        getTemporalRange(): dateTime.DateRange | undefined {
            return getRangeOfTemporalSequence(this.temporalSequence);
        },
    };
}

export function entityToString(entity: CompositeEntity): string {
    let text = entity.name;
    text += "\n";
    text += entity.type.join(", ");
    if (entity.facets) {
        text += "\n";
        text += entity.facets.join("\n");
    }
    return text;
}

export function mergeEntities(
    entities: Iterable<ConcreteEntity>,
): Map<string, WithFrequency<CompositeEntity>> {
    return mergeCompositeEntities(toComposite(entities));
    function* toComposite(entities: Iterable<ConcreteEntity>) {
        for (const entity of entities) {
            yield toCompositeEntity(entity);
        }
    }
}

export type CompositeEntity = {
    name: string;
    type: string[];
    facets?: string[] | undefined;
};

export function mergeCompositeEntities(
    entities: Iterable<CompositeEntity>,
): Map<string, WithFrequency<CompositeEntity>> {
    const merged = new Map<string, WithFrequency<CompositeEntity>>();
    for (let entity of entities) {
        const existing = merged.get(entity.name);
        if (existing) {
            if (appendCompositeEntity(existing.value, entity)) {
                existing.count++;
            }
        } else {
            merged.set(entity.name, { value: entity, count: 1 });
        }
    }
    return merged;
}

export function appendCompositeEntity(
    x: CompositeEntity,
    y: CompositeEntity,
): boolean {
    if (x.name !== y.name) {
        return false;
    }
    x.type = unionArrays(x.type, y.type)!;
    x.facets = unionArrays(x.facets, y.facets);
    return true;
}

export function toCompositeEntity(entity: ConcreteEntity): CompositeEntity {
    const composite: CompositeEntity = {
        name: entity.name,
        type: [...entity.type],
    };
    composite.name = composite.name.toLowerCase();
    collections.lowerAndSort(composite.type);
    if (entity.facets) {
        composite.facets = entity.facets.map((f) => facetToString(f));
        collections.lowerAndSort(composite.facets);
    }
    return composite;
}

export function facetToString(facet: Facet): string {
    return `${facet.name}="${knowledgeValueToString(facet.value)}"`;
}

export function matchFacet(x: Facet, y: Facet): boolean {
    if (x.name !== y.name) {
        return false;
    }
    if (typeof x.value === "object") {
        if (typeof y.value === "object") {
            return (
                x.value.amount === y.value.amount &&
                x.value.units === y.value.units
            );
        } else {
            return false;
        }
    } else {
        return x.value === y.value;
    }
}

export function mergeEntityFacet(entity: ConcreteEntity, facet: Facet) {
    entity.facets ??= [];
    const name = facet.name.toLowerCase();
    if (!entity.facets.find((f) => f.name.toLowerCase() === name)) {
        entity.facets.push(facet);
    }
}
