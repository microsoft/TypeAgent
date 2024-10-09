// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    SearchOptions,
    asyncArray,
    dateTime,
} from "typeagent";
import {
    KeyValueIndex,
    KnowledgeStore,
    TextIndex,
    TextIndexSettings,
    createIndexFolder,
    createKnowledgeStore,
    createTextIndex,
} from "../knowledgeIndex.js";
import { Action, VerbTense } from "./knowledgeSchema.js";
import path from "path";
import { ActionFilter } from "./knowledgeSearchSchema.js";
import {
    TemporalLog,
    getRangeOfTemporalSequence,
    itemsFromTemporalSequence,
    filterTemporalSequence,
} from "../temporal.js";
import {
    addToSet,
    intersect,
    intersectUnionMultiple,
    unionMultiple,
    uniqueFrom,
    intersectMultiple,
} from "../setOperations.js";
import {
    ExtractedAction,
    NoEntityName,
    actionVerbsToString,
} from "./knowledge.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { toStopDate, toStartDate } from "./knowledgeActions.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import { TermFilterV2, VerbTermV2 } from "./knowledgeTermSearchSchema2.js";

export interface ActionSearchOptions extends SearchOptions {
    verbSearchOptions?: SearchOptions | undefined;
    nameSearchOptions?: SearchOptions | undefined;
    loadActions?: boolean | undefined;
}

export interface ActionSearchResult<TActionId = any> {
    actionIds?: TActionId[] | undefined;
    actions?: Action[];
    temporalSequence?: dateTime.Timestamped<TActionId[]>[] | undefined;

    getTemporalRange(): dateTime.DateRange | undefined;
}

function createSearchResults<TActionId = any>(): ActionSearchResult<TActionId> {
    return {
        getTemporalRange(): dateTime.DateRange | undefined {
            return getRangeOfTemporalSequence(this.temporalSequence);
        },
    };
}

export interface ActionIndex<TActionId = any, TSourceId = any>
    extends KnowledgeStore<ExtractedAction<TSourceId>, TActionId> {
    readonly verbIndex: TextIndex<TActionId>;

    addMultiple(
        items: ExtractedAction<TSourceId>[],
        ids?: TActionId[],
    ): Promise<TActionId[]>;
    getSourceIds(ids: TActionId[]): Promise<TSourceId[]>;
    getActions(ids: TActionId[]): Promise<Action[]>;
    search(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<TActionId>>;
    searchTerms(
        filter: TermFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<TActionId>>;
    searchTermsV2(
        filter: TermFilterV2,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<TActionId>>;
    loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: ActionSearchResult<TActionId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined>;
}

export async function createActionIndex<TSourceId = any>(
    settings: TextIndexSettings,
    getNameIndex: () => Promise<TextIndex<string>>,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<ActionIndex<string, TSourceId>> {
    type ActionId = string;
    // Initialize indexes
    const [
        actionStore,
        verbIndex,
        subjectIndex,
        objectIndex,
        indirectObjectIndex,
    ] = await Promise.all([
        createKnowledgeStore<ExtractedAction<TSourceId>>(
            settings,
            rootPath,
            folderSettings,
            fSys,
        ),
        createTextIndex<ActionId>(
            settings,
            path.join(rootPath, "verbs"),
            folderSettings,
            fSys,
        ),
        createIndexFolder<ActionId>(
            path.join(rootPath, "subjects"),
            folderSettings,
            fSys,
        ),
        createIndexFolder<ActionId>(
            path.join(rootPath, "objects"),
            folderSettings,
            fSys,
        ),
        createIndexFolder<ActionId>(
            path.join(rootPath, "indirectObjects"),
            folderSettings,
            fSys,
        ),
    ]);
    return {
        ...actionStore,
        verbIndex,
        add,
        addMultiple,
        getActions,
        getSourceIds,
        search,
        searchTerms,
        searchTermsV2,
        loadSourceIds,
    };

    async function add(
        action: ExtractedAction<TSourceId>,
        id?: ActionId,
    ): Promise<ActionId> {
        id = await actionStore.add(action, id);
        const postings = [id];

        const names = await getNameIndex();
        await Promise.all([
            addVerb(action.value, postings),
            addName(
                names,
                subjectIndex,
                action.value.subjectEntityName,
                postings,
            ),
            addName(
                names,
                objectIndex,
                action.value.objectEntityName,
                postings,
            ),
            addName(
                names,
                indirectObjectIndex,
                action.value.indirectObjectEntityName,
                postings,
            ),
        ]);
        return id;
    }

    async function addMultiple(
        items: ExtractedAction<TSourceId>[],
        ids?: ActionId[],
    ): Promise<ActionId[]> {
        if (ids && items.length !== ids?.length) {
            throw Error("Id length mismatch");
        }
        // TODO: parallelize
        return asyncArray.mapAsync(items, 1, (action, i) =>
            add(action, ids ? ids[i] : undefined),
        );
    }

    async function getSourceIds(ids: ActionId[]): Promise<TSourceId[]> {
        const entities = await actionStore.getMultiple(ids);
        const unique = uniqueFrom<ExtractedAction<TSourceId>>(
            entities,
            (e) => e.sourceIds,
            true,
        );
        return unique ? unique : [];
    }

    async function getActions(ids: ActionId[]): Promise<Action[]> {
        return await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            async (id) => {
                const entity = (await actionStore.get(id))!;
                return entity.value;
            },
        );
    }

    async function addVerb(
        action: Action,
        actionIds: ActionId[],
    ): Promise<void> {
        const fullVerb = actionVerbsToString(action.verbs, action.verbTense);
        await verbIndex.put(fullVerb, actionIds);
    }

    async function addName(
        names: TextIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        name: string,
        actionIds: ActionId[],
    ): Promise<void> {
        if (name && name !== NoEntityName) {
            const nameId = await names.getId(name);
            if (nameId) {
                await nameIndex.put(actionIds, nameId);
            }
        }
    }

    async function search(
        filter: ActionFilter,
        options: ActionSearchOptions,
        timeRange?: DateTimeRange | undefined,
        searchResults?: ActionSearchResult<ActionId> | undefined,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = searchResults ?? createSearchResults<ActionId>();

        if (timeRange) {
            results.temporalSequence = await matchTimeRange(timeRange);
        }

        const names = await getNameIndex();
        const [
            subjectToActionIds,
            objectToActionIds,
            indirectObjectToActionIds,
            verbToActionIds,
        ] = await Promise.all([
            matchName(names, subjectIndex, filter.subjectEntityName, options),
            matchName(names, objectIndex, filter.objectEntityName, options),
            matchName(
                names,
                indirectObjectIndex,
                filter.indirectObjectEntityName,
                options,
            ),
            matchVerbs(filter, options),
        ]);
        results.actionIds = [
            ...intersectMultiple(
                verbToActionIds,
                subjectToActionIds,
                objectToActionIds,
                indirectObjectToActionIds,
                itemsFromTemporalSequence(results.temporalSequence),
            ),
        ];
        if (results.actionIds && results.temporalSequence) {
            // The temporal sequence maintains all entity ids seen at a timestamp.
            // Since we identified specific entity ids, we remove the other ones
            results.temporalSequence = filterTemporalSequence(
                results.temporalSequence,
                results.actionIds,
            );
        }
        if (options.loadActions && results.actionIds) {
            results.actions = await getActions(results.actionIds);
        }
        return results;
    }

    async function searchTerms(
        filter: TermFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = createSearchResults<ActionId>();
        if (filter.timeRange) {
            results.temporalSequence = await matchTimeRange(filter.timeRange);
        }

        const names = await getNameIndex();
        const [
            subjectToActionIds,
            objectToActionIds,
            indirectToObjectIds,
            verbToActionIds,
        ] = await Promise.all([
            matchTerms(names, subjectIndex, filter.terms, options),
            matchTerms(names, objectIndex, filter.terms, options),
            matchTerms(names, indirectObjectIndex, filter.terms, options),
            matchVerbTerms(filter.verbs, undefined, options),
        ]);
        results.actionIds = [
            ...intersectMultiple(
                intersectUnionMultiple(
                    subjectToActionIds,
                    objectToActionIds,
                    indirectToObjectIds,
                ),
                verbToActionIds,
                itemsFromTemporalSequence(results.temporalSequence),
            ),
        ];
        if (results.actionIds && results.temporalSequence) {
            // The temporal sequence maintains all entity ids seen at a timestamp.
            // Since we identified specific entity ids, we remove the other ones
            results.temporalSequence = filterTemporalSequence(
                results.temporalSequence,
                results.actionIds,
            );
        }

        if (options.loadActions && results.actionIds) {
            results.actions = await getActions(results.actionIds);
        }
        return results;
    }

    async function searchTermsV2(
        filter: TermFilterV2,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = createSearchResults<ActionId>();
        if (filter.timeRange) {
            results.temporalSequence = await matchTimeRange(filter.timeRange);
        }

        if (filter.verbs) {
            await searchVerbTerm(
                filter.verbs,
                filter.timeRange,
                options,
                results,
            );
        } else {
            const names = await getNameIndex();
            const [subjectToActionIds, objectToActionIds, indirectToActionIds] =
                await Promise.all([
                    matchTerms(names, subjectIndex, filter.terms, options),
                    matchTerms(names, objectIndex, filter.terms, options),
                    matchTerms(
                        names,
                        indirectObjectIndex,
                        filter.terms,
                        options,
                    ),
                ]);
            results.actionIds = [
                ...intersectMultiple(
                    intersectUnionMultiple(
                        subjectToActionIds,
                        objectToActionIds,
                        indirectToActionIds,
                    ),
                    itemsFromTemporalSequence(results.temporalSequence),
                ),
            ];
        }
        if (results.actionIds && results.temporalSequence) {
            // The temporal sequence maintains all entity ids seen at a timestamp.
            // Since we identified specific entity ids, we remove the other ones
            results.temporalSequence = filterTemporalSequence(
                results.temporalSequence,
                results.actionIds,
            );
        }

        if (options.loadActions && results.actionIds) {
            results.actions = await getActions(results.actionIds);
        }
        return results;
    }

    async function searchVerbTerm(
        filter: VerbTermV2,
        timeRange: DateTimeRange | undefined,
        options: ActionSearchOptions,
        results: ActionSearchResult<string>,
    ) {
        const actionFilter: ActionFilter = {
            filterType: "Action",
            verbFilter: {
                verbs: filter.verbs,
            },
            subjectEntityName: filter.subject ?? "none",
            objectEntityName: filter.object,
            indirectObjectEntityName: filter.indirectObject,
        };
        await search(actionFilter, options, timeRange, results);
    }

    async function matchName(
        names: TextIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        name: string | undefined,
        options: ActionSearchOptions,
    ): Promise<IterableIterator<ActionId> | undefined> {
        if (name && name !== NoEntityName) {
            const nameOptions = options.nameSearchOptions ?? options;
            // Possible names of entities
            const nameIds = await names.getNearestText(
                name,
                nameOptions.maxMatches,
                nameOptions.minScore,
            );
            if (nameIds && nameIds.length > 0) {
                // Load all actions for those entities
                const matches = await nameIndex.getMultiple(
                    nameIds,
                    settings.concurrency,
                );
                if (matches && matches.length > 0) {
                    return unionMultiple(...matches);
                }
            }
        }
        return undefined;
    }

    async function matchVerbs(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionId[] | undefined> {
        if (filter.verbFilter && filter.verbFilter.verbs.length > 0) {
            return matchVerbTerms(
                filter.verbFilter.verbs,
                filter.verbFilter.verbTense,
                options,
            );
        }
        return undefined;
    }

    async function matchTerms(
        names: TextIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        terms: string[],
        options: ActionSearchOptions,
    ) {
        const matches = await asyncArray.mapAsync(
            terms,
            settings.concurrency,
            (term) => matchName(names, nameIndex, term, options),
        );
        return intersectUnionMultiple(...matches);
    }

    async function matchVerbTerms(
        verbs: string[] | undefined,
        verbTense: VerbTense | undefined,
        options: ActionSearchOptions,
    ): Promise<ActionId[] | undefined> {
        if (verbs && verbs.length > 0) {
            const verbOptions = options.verbSearchOptions ?? options;
            const matches = await verbIndex.getNearest(
                actionVerbsToString(verbs, verbTense),
                verbOptions.maxMatches,
                verbOptions.minScore,
            );
            return matches;
        }
        return undefined;
    }

    async function matchTimeRange(timeRange: DateTimeRange | undefined) {
        if (timeRange) {
            return await actionStore.sequence.getEntriesInRange(
                toStartDate(timeRange.startDate),
                toStopDate(timeRange.stopDate),
            );
        }
        return undefined;
    }

    async function loadSourceIds(
        sourceIdLog: TemporalLog<TSourceId>,
        results: ActionSearchResult<ActionId>[],
        unique?: Set<TSourceId>,
    ): Promise<Set<TSourceId> | undefined> {
        if (results.length === 0) {
            return unique;
        }
        unique ??= new Set<TSourceId>();
        await asyncArray.forEachAsync(
            results,
            settings.concurrency,
            async (a) => {
                if (a.actionIds && a.actionIds.length > 0) {
                    const ids = await getSourceIds(a.actionIds);
                    const timeRange = a.getTemporalRange();
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
