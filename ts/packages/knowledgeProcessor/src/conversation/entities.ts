// Copyright (c) Microsoft Corporation and Henry Lucco.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    SearchOptions,
    asyncArray,
    collections,
    dateTime,
} from "typeagent";
import {
    TermSet,
    TextIndex,
    TextIndexSettings,
    createTermSet,
} from "../textIndex.js";
import {
    KnowledgeStore,
    createKnowledgeStoreOnStorage,
} from "../knowledgeStore.js";
import { ExtractedEntity, knowledgeValueToString } from "./knowledge.js";
import { TextBlock, TextBlockType } from "../text.js";
import { EntityFilter } from "./knowledgeSearchSchema.js";
import {
    SetOp,
    WithFrequency,
    addToSet,
    createHitTable,
    intersect,
    //intersectArrays,
    intersectMultiple,
    intersectUnionMultiple,
    removeUndefined,
    unionArrays,
    unionMultiple,
    uniqueFrom,
} from "../setOperations.js";
import {
    TemporalLog,
    filterTemporalSequence,
    getRangeOfTemporalSequence,
    itemsFromTemporalSequence,
} from "../temporal.js";
import {
    toStopDate,
    toStartDate,
    FilterWithTagScope,
    isFilterWithTagScope,
} from "./knowledgeActions.js";
import { ConcreteEntity, Facet } from "./knowledgeSchema.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { TermFilterV2 } from "./knowledgeTermSearchSchema2.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import {
    createFileSystemStorageProvider,
    StorageProvider,
} from "../storageProvider.js";
import { AliasMatcher, createAliasMatcher } from "../textMatcher.js";

export interface EntitySearchOptions extends SearchOptions {
    loadEntities?: boolean | undefined;
    nameSearchOptions?: SearchOptions | undefined;
    facetSearchOptions?: SearchOptions | undefined;
    combinationSetOp?: SetOp | undefined;
    /**
     * Select items with the 'topK' scores.
     * E.g. 3 means that the 3 highest scores are picked and any items with those scores selected
     */
    topK?: number;
    alwaysUseTags?: boolean | undefined;
}

export function createEntitySearchOptions(
    loadEntities: boolean = true,
): EntitySearchOptions {
    return {
        maxMatches: 2,
        minScore: 0.8,
        nameSearchOptions: {
            maxMatches: 5,
        },
        facetSearchOptions: {
            maxMatches: 10,
        },
        combinationSetOp: SetOp.IntersectUnion,
        loadEntities,
        alwaysUseTags: false,
    };
}

export interface EntityIndex<TEntityId = any, TSourceId = any, TTextId = any>
    extends KnowledgeStore<ExtractedEntity<TSourceId>, TEntityId> {
    readonly nameIndex: TextIndex<TTextId, TEntityId>;
    readonly typeIndex: TextIndex<TTextId, TEntityId>;
    readonly facetIndex: TextIndex<TTextId, TEntityId>;
    readonly nameAliases: AliasMatcher<TTextId>;
    readonly noiseTerms: TermSet;

    entities(): AsyncIterableIterator<ExtractedEntity<TSourceId>>;
    get(id: TEntityId): Promise<ExtractedEntity<TSourceId> | undefined>;
    getMultiple(ids: TEntityId[]): Promise<ExtractedEntity<TSourceId>[]>;
    getSourceIds(ids: TEntityId[]): Promise<TSourceId[]>;
    getEntities(ids: TEntityId[]): Promise<ConcreteEntity[]>;
    getEntityIdsInTimeRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<TEntityId[] | undefined>;
    add(entity: ExtractedEntity<TSourceId>, id?: TEntityId): Promise<TEntityId>;
    addMultiple(
        entities: ExtractedEntity<TSourceId>[],
        ids?: TEntityId[],
    ): Promise<TEntityId[]>;
    search(
        filter: EntityFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<TEntityId>>;
    searchTerms(
        filter: TermFilter,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<TEntityId>>;
    searchTermsV2(
        filter: TermFilterV2 | FilterWithTagScope<TermFilterV2>,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<TEntityId>>;
    loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: EntitySearchResult<TEntityId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined>;
}

export function createEntityIndex<TSourceId = string>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<EntityIndex<string, TSourceId, string>> {
    return createEntityIndexOnStorage(
        settings,
        rootPath,
        createFileSystemStorageProvider(rootPath, folderSettings, fSys),
    );
}

export async function createEntityIndexOnStorage<TSourceId = string>(
    settings: TextIndexSettings,
    rootPath: string,
    storageProvider: StorageProvider,
): Promise<EntityIndex<string, TSourceId, string>> {
    type EntityId = string;
    const [entityStore, nameIndex, typeIndex, facetIndex] = await Promise.all([
        createKnowledgeStoreOnStorage<ExtractedEntity<TSourceId>>(
            settings,
            rootPath,
            storageProvider,
        ),
        storageProvider.createTextIndex<EntityId>(
            settings,
            rootPath,
            "names",
            "TEXT",
        ),
        storageProvider.createTextIndex<EntityId>(
            settings,
            rootPath,
            "types",
            "TEXT",
        ),
        storageProvider.createTextIndex<EntityId>(
            settings,
            rootPath,
            "facets",
            "TEXT",
        ),
    ]);
    const nameAliases = await createAliasMatcher(
        nameIndex,
        storageProvider,
        rootPath,
        "nameAliases",
        "TEXT",
    );

    const noiseTerms = createTermSet();
    return {
        ...entityStore,
        nameIndex,
        typeIndex,
        facetIndex,
        nameAliases,
        noiseTerms,
        entities: () => entityStore.entries(),
        get: (id) => entityStore.get(id),
        getMultiple,
        getSourceIds,
        getEntities,
        getEntityIdsInTimeRange,
        add,
        addMultiple,
        search,
        searchTerms,
        searchTermsV2,
        loadSourceIds,
    };

    async function getMultiple(
        ids: EntityId[],
    ): Promise<ExtractedEntity<TSourceId>[]> {
        const entities = await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            (id) => entityStore.get(id),
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
                const entity = (await entityStore.get(id))!;
                return entity.value;
            },
        );
    }

    async function getEntityIdsInTimeRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<EntityId[] | undefined> {
        // Get all entity ids seen in this date range
        const temporalSequence = await entityStore.sequence.getEntriesInRange(
            startAt,
            stopAt,
        );
        return itemsFromTemporalSequence(temporalSequence);
    }

    async function add(
        extractedEntity: ExtractedEntity<TSourceId>,
        id?: EntityId,
    ): Promise<EntityId> {
        const entityId = id ? id : await entityStore.add(extractedEntity);
        const sourceIds: EntityId[] = [entityId];
        await Promise.all([
            addName(extractedEntity.value.name, sourceIds),
            addTypes(extractedEntity.value.type, sourceIds),
            addFacets(extractedEntity.value.facets, sourceIds),
        ]);

        return entityId;
    }

    async function addMultiple(
        entities: ExtractedEntity<TSourceId>[],
        ids?: EntityId[],
    ): Promise<EntityId[]> {
        if (ids && ids.length !== entities.length) {
            throw Error("Id length mismatch");
        }
        // TODO: parallelize
        return asyncArray.mapAsync(entities, 1, (entity, i) =>
            add(entity, ids ? ids[i] : undefined),
        );
    }

    async function addName(name: string, sourceIds: EntityId[]): Promise<void> {
        await nameIndex.put(name, sourceIds);
    }

    async function addTypes(
        type: string[],
        sourceIds: EntityId[],
    ): Promise<void> {
        const typeEntries: TextBlock[] = type.map((t) => {
            return {
                value: t,
                sourceIds,
                type: TextBlockType.Word,
            };
        });
        await typeIndex.putMultiple(typeEntries);
    }

    async function addFacets(
        facets: Facet[] | undefined,
        sourceIds: EntityId[],
    ) {
        if (facets && facets.length > 0) {
            const facetEntries: TextBlock[] = facets.map((f) => {
                return {
                    value: facetToString(f),
                    sourceIds,
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
            results.temporalSequence =
                await entityStore.sequence.getEntriesInRange(
                    toStartDate(filter.timeRange.startDate),
                    toStopDate(filter.timeRange.stopDate),
                );
        }
        if (filter.type && filter.type.length > 0) {
            typeMatchIds = await typeIndex.getNearestMultiple(
                filter.type,
                options.maxMatches,
                options.minScore,
            );
        }
        if (filter.name && filter.name.length > 0) {
            nameMatchIds = await nameIndex.getNearest(
                filter.name,
                options.nameSearchOptions?.maxMatches ?? options.maxMatches,
                options.nameSearchOptions?.minScore ?? options.minScore,
            );
            if (nameMatchIds === undefined || nameMatchIds.length == 0) {
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
        const terms = combineTerms(filter);
        return matchEntities(terms, filter.timeRange, options);
    }

    async function searchTermsV2(
        filterOrScoped: TermFilterV2 | FilterWithTagScope<TermFilterV2>,
        options: EntitySearchOptions,
    ): Promise<EntitySearchResult<EntityId>> {
        let filter: TermFilterV2;
        let tags: string[] | undefined;
        if (isFilterWithTagScope(filterOrScoped)) {
            filter = filterOrScoped.filter;
            tags = filterOrScoped.tags;
        } else {
            filter = filterOrScoped;
        }
        if (filter.searchTerms && filter.searchTerms.length > 0) {
            if (options.alwaysUseTags && !tags) {
                tags = filter.searchTerms;
            }
            return matchEntities(
                filter.searchTerms,
                filter.timeRange,
                options,
                tags,
            );
        }
        return createSearchResults();
    }

    async function matchEntities(
        terms: string[],
        timeRange: DateTimeRange | undefined,
        options: EntitySearchOptions,
        tags?: string[],
    ): Promise<EntitySearchResult<EntityId>> {
        const results = createSearchResults();
        if (timeRange) {
            results.temporalSequence =
                await entityStore.sequence.getEntriesInRange(
                    toStartDate(timeRange.startDate),
                    toStopDate(timeRange.stopDate),
                );
        }
        let tagMatchIds: string[] | undefined;
        if (tags) {
            tagMatchIds = await entityStore.getByTag(tags);
        }
        terms = terms.filter((t) => !noiseTerms.has(t));
        if (terms && terms.length > 0) {
            const entityIdHitTable = createHitTable<EntityId>();
            const scoreBoost = 100;
            await Promise.all([
                nameIndex.getNearestHitsMultiple(
                    terms,
                    entityIdHitTable,
                    options.nameSearchOptions?.maxMatches ?? options.maxMatches,
                    options.nameSearchOptions?.minScore ?? options.minScore,
                    scoreBoost,
                    nameAliases,
                ),
                typeIndex.getNearestHitsMultiple(
                    terms,
                    entityIdHitTable,
                    options.maxMatches,
                    options.minScore,
                    scoreBoost,
                ),
                facetIndex.getNearestHitsMultiple(
                    terms,
                    entityIdHitTable,
                    options.facetSearchOptions?.maxMatches,
                    options.facetSearchOptions?.minScore ?? options.minScore,
                ),
            ]);
            entityIdHitTable.roundScores(2);
            let entityIdHits = entityIdHitTable
                .getTopK(determineTopK(options))
                .sort();

            results.entityIds = [
                ...intersectMultiple(
                    entityIdHits,
                    tagMatchIds,
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

    function combineTerms(filter: TermFilter): string[] {
        let terms: string[] | undefined;
        if (filter.verbs && filter.verbs.length > 0) {
            terms = [];
            terms.push(...filter.verbs);
            if (filter.terms && filter.terms.length > 0) {
                terms.push(...filter.terms);
            }
        }
        return terms ?? filter.terms;
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

    function determineTopK(options: EntitySearchOptions): number {
        const topK = options.topK;
        return topK === undefined || topK < 10 ? 10 : topK;
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

export function getTopMergedEntities(
    rawEntities: Iterable<ConcreteEntity>,
    topK: number = -1,
): CompositeEntity[] | undefined {
    const mergedEntities = mergeEntities(rawEntities);
    let entities: CompositeEntity[] | undefined;
    if (mergedEntities.size > 0) {
        // Sort in hit count order
        entities = [...mergedEntities.values()]
            .sort((x, y) => y.count - x.count)
            .map((e) => e.value);
        entities = topK > 0 ? entities.slice(0, topK) : entities;
    }
    return entities;
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
    if (entity === undefined) {
        return {
            name: "undefined",
            type: ["undefined"],
        };
    }
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

export function toCompositeEntities(
    entities: Iterable<ExtractedEntity>,
): IterableIterator<CompositeEntity> {
    const merged = mergeCompositeEntities(
        collections.mapIterate(entities, (e) => toCompositeEntity(e.value)),
    );
    return collections.mapIterate(merged.values(), (e) => e.value);
}

export function facetToString(facet: Facet): string {
    return `${facet.name}="${knowledgeValueToString(facet.value)}"`;
}

export function facetMatch(x: Facet, y: Facet): boolean {
    if (!collections.stringEquals(x.name, y.name, false)) {
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
    // Look for an equal facet
    for (const f of entity.facets) {
        if (facetMatch(f, facet)) {
            break;
        }
    }
    entity.facets.push(facet);
}

export function pushFacet(entity: ConcreteEntity, name: string, value: string) {
    entity.facets ??= [];
    entity.facets.push({ name, value });
}

export function entityFromRecord(
    ns: string,
    name: string,
    type: string,
    record: Record<string, any>,
): ConcreteEntity {
    let entity: ConcreteEntity = {
        name: `${ns}:${name}`,
        type: [`${ns}:${type}`],
    };
    const facets = facetsFromRecord(record);
    if (facets) {
        entity.facets = facets;
    }
    return entity;
}

export function facetsFromRecord(
    record: Record<string, any>,
): Facet[] | undefined {
    let facets: Facet[] | undefined;
    for (const name in record) {
        const value = record[name];
        if (value) {
            facets ??= [];
            facets.push({ name, value });
        }
    }

    return facets;
}

export type EntityNameIndex<TTextId = any> = {
    nameIndex: TextIndex<TTextId>;
    nameAliases?: AliasMatcher<TTextId> | undefined;
};
