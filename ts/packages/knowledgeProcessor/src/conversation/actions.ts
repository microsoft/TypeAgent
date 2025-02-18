// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    ScoredItem,
    SearchOptions,
    asyncArray,
    collections,
    dateTime,
} from "typeagent";
import { TermMap, TextIndexSettings, createTermMap } from "../textIndex.js";
import {
    createKnowledgeStoreOnStorage,
    KnowledgeStore,
} from "../knowledgeStore.js";
import { KeyValueIndex } from "../keyValueIndex.js";
import { Action, ActionParam, VerbTense } from "./knowledgeSchema.js";
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
    createHitTable,
    removeDuplicates,
} from "../setOperations.js";
import {
    ExtractedAction,
    isValidEntityName,
    knowledgeValueToString,
    NoEntityName,
} from "./knowledge.js";
import { TermFilter } from "./knowledgeTermSearchSchema.js";
import { toStopDate, toStartDate } from "./knowledgeActions.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import { TermFilterV2, ActionTerm } from "./knowledgeTermSearchSchema2.js";
import { EntityNameIndex, facetToString } from "./entities.js";
import {
    createFileSystemStorageProvider,
    StorageProvider,
} from "../storageProvider.js";
import { getSubjectFromActionTerm } from "./knowledgeTermSearch2.js";

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

export interface ActionSearchOptions extends SearchOptions {
    verbSearchOptions?: SearchOptions | undefined;
    loadActions?: boolean | undefined;
}

export function createActionSearchOptions(
    loadActions: boolean = false,
): ActionSearchOptions {
    return {
        maxMatches: 2,
        minScore: 0.8,
        verbSearchOptions: {
            maxMatches: 1,
            minScore: 0.8,
        },
        loadActions,
    };
}

export interface ActionIndex<TActionId = any, TSourceId = any>
    extends KnowledgeStore<ExtractedAction<TSourceId>, TActionId> {
    readonly verbTermMap: TermMap;

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

    getAllVerbs(): Promise<string[]>;
}

export function createActionIndex<TSourceId = any>(
    settings: TextIndexSettings,
    getNameIndex: () => Promise<EntityNameIndex<string>>,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<ActionIndex<string, TSourceId>> {
    return createActionIndexOnStorage<TSourceId>(
        settings,
        getNameIndex,
        rootPath,
        createFileSystemStorageProvider(rootPath, folderSettings, fSys),
    );
}
export async function createActionIndexOnStorage<TSourceId = any>(
    settings: TextIndexSettings,
    getEntityNameIndex: () => Promise<EntityNameIndex<string>>,
    rootPath: string,
    storageProvider: StorageProvider,
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
        createKnowledgeStoreOnStorage<ExtractedAction<TSourceId>>(
            settings,
            rootPath,
            storageProvider,
        ),
        storageProvider.createTextIndex<ActionId>(
            settings,
            rootPath,
            "verbs",
            "TEXT",
        ),
        storageProvider.createIndex<ActionId>(rootPath, "subjects", "TEXT"),
        storageProvider.createIndex<ActionId>(rootPath, "objects", "TEXT"),
        storageProvider.createIndex<ActionId>(
            rootPath,
            "indirectObjects",
            "TEXT",
        ),
    ]);
    const verbTermMap = createTermMap();
    return {
        ...actionStore,
        verbTermMap,
        add,
        addMultiple,
        getActions,
        getSourceIds,
        search,
        searchTerms,
        searchTermsV2,
        loadSourceIds,

        getAllVerbs,
    };

    async function add(
        action: ExtractedAction<TSourceId>,
        id?: ActionId,
    ): Promise<ActionId> {
        id = await actionStore.add(action, id);
        const postings = [id];

        const names = await getEntityNameIndex();
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
        const actions = await actionStore.getMultiple(ids);
        const unique = uniqueFrom<ExtractedAction<TSourceId>>(
            actions,
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

    async function getAllVerbs(): Promise<string[]> {
        return [...verbIndex.text()].sort();
    }

    async function addVerb(
        action: Action,
        actionIds: ActionId[],
    ): Promise<void> {
        const fullVerb = actionVerbsToString(action.verbs, action.verbTense);
        await verbIndex.put(fullVerb, actionIds);
    }

    async function addName(
        names: EntityNameIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        name: string,
        actionIds: ActionId[],
    ): Promise<void> {
        if (isValidEntityName(name)) {
            const nameId = await names.nameIndex.getId(name);
            if (nameId) {
                await nameIndex.put(actionIds, nameId);
            }
        }
    }

    async function search(
        filter: ActionFilter,
        options: ActionSearchOptions,
        otherTerms?: string[] | undefined,
        timeRange?: DateTimeRange | undefined,
        searchResults?: ActionSearchResult<ActionId> | undefined,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = searchResults ?? createSearchResults<ActionId>();

        if (timeRange) {
            results.temporalSequence = await matchTimeRange(timeRange);
        }

        const entityNames = await getEntityNameIndex();
        const [
            subjectToActionIds,
            objectToActionIds,
            indirectObjectToActionIds,
            termsToActionIds,
            verbToActionIds,
        ] = await Promise.all([
            matchName(
                entityNames,
                subjectIndex,
                filter.subjectEntityName,
                options,
            ),
            matchName(
                entityNames,
                objectIndex,
                filter.objectEntityName,
                options,
            ),
            matchName(
                entityNames,
                indirectObjectIndex,
                filter.indirectObjectEntityName,
                options,
            ),
            matchTerms(entityNames, indirectObjectIndex, otherTerms, options),
            matchVerbs(filter, options),
        ]);
        const entityActionIds = intersectUnionMultiple(
            subjectToActionIds,
            objectToActionIds,
            indirectObjectToActionIds,
            termsToActionIds,
        );

        results.actionIds = [
            ...intersectMultiple(
                entityActionIds,
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

    async function searchTerms(
        filter: TermFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = createSearchResults<ActionId>();
        if (filter.timeRange) {
            results.temporalSequence = await matchTimeRange(filter.timeRange);
        }

        const entityNames = await getEntityNameIndex();
        const [
            subjectToActionIds,
            objectToActionIds,
            indirectToObjectIds,
            verbToActionIds,
        ] = await Promise.all([
            matchTerms(entityNames, subjectIndex, filter.terms, options),
            matchTerms(entityNames, objectIndex, filter.terms, options),
            matchTerms(entityNames, indirectObjectIndex, filter.terms, options),
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
        if (!filter.action) {
            return results;
        }
        if (filter.timeRange) {
            results.temporalSequence = await matchTimeRange(filter.timeRange);
        }

        await searchVerbTerm(
            filter.action,
            filter.searchTerms,
            filter.timeRange,
            options,
            results,
        );

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
        actionTerm: ActionTerm,
        otherTerms: string[] | undefined,
        timeRange: DateTimeRange | undefined,
        options: ActionSearchOptions,
        results: ActionSearchResult<string>,
    ) {
        const actionFilter: ActionFilter = {
            filterType: "Action",
            subjectEntityName:
                getSubjectFromActionTerm(actionTerm) ?? NoEntityName,
            objectEntityName: actionTerm.object,
        };
        if (actionTerm.verbs) {
            actionFilter.verbFilter = {
                verbs: actionTerm.verbs.words,
                verbTense: actionTerm.verbs.verbTense,
            };
        }
        await search(actionFilter, options, otherTerms, timeRange, results);
    }

    async function matchName(
        entityNames: EntityNameIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        name: string | undefined,
        options: ActionSearchOptions,
    ): Promise<IterableIterator<ActionId> | undefined> {
        if (isValidEntityName(name)) {
            // Possible names of entities
            const nameIds = await entityNames.nameIndex.getNearestText(
                name!,
                options.maxMatches,
                options.minScore,
                entityNames.nameAliases,
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
        entityNames: EntityNameIndex<string>,
        nameIndex: KeyValueIndex<string, ActionId>,
        terms: string[] | undefined,
        options: ActionSearchOptions,
    ) {
        if (!terms || terms.length === 0) {
            return undefined;
        }
        const matches = await asyncArray.mapAsync(
            terms,
            settings.concurrency,
            (term) => matchName(entityNames, nameIndex, term, options),
        );
        return intersectUnionMultiple(...matches);
    }

    async function matchVerbTerms(
        verbs: string[] | undefined,
        verbTense: VerbTense | undefined,
        options: ActionSearchOptions,
    ): Promise<ActionId[] | undefined> {
        if (verbs && verbs.length > 0) {
            verbs = mapVerbTerms(verbs);
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

    function mapVerbTerms(terms: string[]): string[] {
        return terms.map((t) => verbTermMap.get(t) ?? t);
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

export function actionToString(action: Action): string {
    let text = "";
    text = appendEntityName(text, action.subjectEntityName);
    text += ` [${action.verbs.join(", ")}]`;
    text = appendEntityName(text, action.objectEntityName);
    text = appendEntityName(text, action.indirectObjectEntityName);
    text += ` {${action.verbTense}}`;
    if (action.subjectEntityFacet) {
        text += ` <${facetToString(action.subjectEntityFacet)}>`;
    }
    return text;

    function appendEntityName(text: string, name: string): string {
        if (text.length > 0) {
            text += " ";
        }
        if (isValidEntityName(name)) {
            text += `<${name}>`;
        } else {
            text += "<>";
        }
        return text;
    }
}

export function actionVerbsToString(
    verbs: string[],
    verbTense?: VerbTense,
): string {
    const text = verbTense
        ? `${verbs.join(" ")} {${verbTense}}`
        : verbs.join(" ");
    return text;
}

export function actionParamToString(param: string | ActionParam): string {
    return typeof param === "string"
        ? param
        : `${param.name}="${knowledgeValueToString(param.value)}"`;
}

export type CompositeAction = {
    subject?: string | undefined;
    verbs?: string | undefined;
    object?: string | undefined;
    indirectObject?: string | undefined;
    params?: string[] | undefined;
};

export type ActionGroupKey = Pick<
    CompositeAction,
    "subject" | "verbs" | "object"
>;
export type ActionGroupValue = Pick<
    CompositeAction,
    "object" | "indirectObject" | "params"
>;
export interface ActionGroup extends ActionGroupKey {
    values?: ActionGroupValue[] | undefined;
}

export function toCompositeAction(action: Action) {
    const composite: CompositeAction = {
        verbs: actionVerbsToString(action.verbs, action.verbTense),
    };
    if (isValidEntityName(action.subjectEntityName)) {
        composite.subject = action.subjectEntityName;
    }
    if (isValidEntityName(action.objectEntityName)) {
        composite.object = action.objectEntityName;
    }
    if (isValidEntityName(action.indirectObjectEntityName)) {
        composite.indirectObject = action.indirectObjectEntityName;
    }
    if (action.params) {
        composite.params = action.params.map((a) => actionParamToString(a));
    }
    return composite;
}

/**
 * Action groups are sorted by relevance
 * @param actions
 * @param fullActionsOnly
 * @returns
 */
export function mergeActions(
    actions: Iterable<Action>,
    fullActionsOnly: boolean = true,
): ActionGroup[] {
    if (fullActionsOnly) {
        actions = getFullActions(actions);
    }
    const merged = mergeCompositeActions(toCompositeActions(actions));
    return merged.map((a) => a.item);
}

function* toCompositeActions(
    actions: Iterable<Action>,
): IterableIterator<CompositeAction> {
    for (const a of actions) {
        yield toCompositeAction(a);
    }
}

export function mergeCompositeActions(
    actions: Iterable<CompositeAction>,
): ScoredItem<ActionGroup>[] {
    const merged = createHitTable<ActionGroup>((k) => actionGroupKey(k));
    for (const action of actions) {
        const key = actionGroupKey(action);
        let existing = merged.get(action);
        if (!existing) {
            existing = { item: actionToActionGroup(action), score: 0 };
            merged.set(key, existing);
        }
        if (appendToActionGroup(existing.item, action)) {
            existing.score += 1;
        }
    }
    const groups = merged.byHighestScore();
    groups.forEach((g) => {
        removeDuplicates(g.item.values, compareActionGroupValue);
        mergeActionGroup(g.item);
    });
    return groups;
}

function actionGroupKey(group: ActionGroupKey): string {
    let key = "";
    if (group.subject) {
        key += group.subject;
        key += " ";
    }
    key += group.verbs;
    if (group.object) {
        key += " " + group.object;
    }
    return key;
}

function actionToActionGroup(action: CompositeAction): ActionGroup {
    const group: ActionGroup = {};
    if (action.subject) {
        group.subject = action.subject;
    }
    if (action.verbs) {
        group.verbs = action.verbs;
    }
    return group;
}

function appendToActionGroup(x: ActionGroup, y: CompositeAction): boolean {
    if (x.subject !== y.subject || x.verbs !== y.verbs) {
        return false;
    }
    x.values ??= [];
    const obj: ActionGroupValue = {};
    if (y.object) {
        obj.object = y.object;
    }
    if (y.indirectObject) {
        obj.indirectObject = y.indirectObject;
    }
    if (y.params) {
        obj.params = y.params;
    }
    x.values.push(obj);
    return true;
}

function mergeActionGroup(
    group: ActionGroup,
    mergeLength: number = 2,
): ActionGroup {
    // Simple merge for now: if all the objects are the same, merge them
    const values = group.values;
    if (!values || values.length <= mergeLength) {
        return group;
    }
    values.sort();

    const obj = values[0].object;
    if (!obj) {
        return group;
    }
    for (let i = 1; i < values.length; ++i) {
        if (obj !== values[i].object) {
            return group;
        }
    }
    group.object = obj;
    for (let i = 0; i < values.length; ++i) {
        delete values[i].object;
    }

    return group;
}

function compareActionGroupValue(
    x: ActionGroupValue,
    y: ActionGroupValue,
    caseSensitive: boolean = true,
): number {
    let cmp = collections.stringCompare(x.object, y.object, caseSensitive);
    if (cmp === 0) {
        cmp = collections.stringCompare(
            x.indirectObject,
            y.indirectObject,
            caseSensitive,
        );
        if (cmp === 0) {
            cmp = collections.stringCompareArray(
                x.params,
                y.params,
                caseSensitive,
            );
        }
    }
    return cmp;
}

function* getFullActions(actions: Iterable<Action>): IterableIterator<Action> {
    for (const a of actions) {
        if (
            isValidEntityName(a.subjectEntityName) &&
            a.verbs &&
            a.verbs.length > 0 &&
            isValidEntityName(a.objectEntityName)
        ) {
            yield a;
        }
    }
}
