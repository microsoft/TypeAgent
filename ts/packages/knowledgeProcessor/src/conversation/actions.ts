// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    ObjectFolderSettings,
    ScoredItem,
    SearchOptions,
    asyncArray,
    dateTime,
} from "typeagent";
import {
    KnowledgeStore,
    TextIndex,
    TextIndexSettings,
    createKnowledgeStore,
    createTextIndex,
    searchIndex,
} from "../knowledgeIndex.js";
import { Action, VerbTense } from "./knowledgeSchema.js";
import path from "path";
import { TextBlock, TextBlockType } from "../text.js";
import { ActionFilter } from "./knowledgeSearchSchema.js";
import { getRangeOfTemporalSequence } from "../temporal.js";
import {
    SetOp,
    intersectArrays,
    unionArrays,
    uniqueFrom,
} from "../setOperations.js";
import { EntityIndex } from "./entities.js";
import { ExtractedAction, actionVerbsToString } from "./knowledge.js";

export interface ActionSearchOptions extends SearchOptions {
    verbSearchOptions?: SearchOptions | undefined;
    entitySearchOptions?: SearchOptions | undefined;
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

export type ConcreteActionFilter<TEntityId = any> = {
    // Each verb is typically a word
    verbs: string[];
    verbTense: VerbTense;
    // ASSUMPTION: the following ID arrays are SORTED
    subjectEntityIds?: TEntityId[] | undefined;
    objectEntityIds?: TEntityId[] | undefined;
    indirectObjectEntityIds?: TEntityId[] | undefined;
};

export interface ActionIndex<TActionId = any, TEntityId = any, TSourceId = any>
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
    searchVerbs(
        verb: string[],
        tense?: VerbTense,
        options?: SearchOptions,
    ): Promise<ScoredItem<TActionId[]>[]>;
}

export async function createActionIndex<TEntityId = any, TSourceId = any>(
    settings: TextIndexSettings,
    getEntityIndex: () => Promise<EntityIndex<TEntityId>>,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<ActionIndex<string, string, TSourceId>> {
    type ActionId = string;
    const actionStore = await createKnowledgeStore<ExtractedAction<TSourceId>>(
        settings,
        rootPath,
        folderSettings,
        fSys,
    );

    const verbIndex = await createTextIndex<ActionId>(
        settings,
        path.join(rootPath, "verbs"),
        folderSettings,
        fSys,
    );
    const subjectIndex = await createTextIndex<ActionId>(
        settings,
        path.join(rootPath, "subjects"),
        folderSettings,
        fSys,
    );
    return {
        ...actionStore,
        verbIndex,
        add,
        addMultiple,
        getActions,
        getSourceIds,
        search,
        searchVerbs,
    };

    async function add(
        action: ExtractedAction<TSourceId>,
        id?: ActionId,
    ): Promise<ActionId> {
        id = await actionStore.add(action, id);
        const postings = [id];

        await Promise.all([
            addVerb(action.value, postings),
            addSubject(action.value, postings),
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

    async function addSubject(
        action: Action,
        actionIds: ActionId[],
    ): Promise<void> {
        if (action.subjectEntityName) {
            await subjectIndex.put(action.subjectEntityName, actionIds);
        }
    }

    async function search(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = createSearchResults<ActionId>();

        const [subjectToActionIds, verbToActionIds] = await Promise.all([
            matchSubjects(filter, options),
            matchVerbs(filter, options),
        ]);
        results.actionIds = intersectArrays(
            subjectToActionIds,
            verbToActionIds,
        );
        if (results.actionIds) {
            results.actions = await getActions(results.actionIds);
        }
        const [objects, indirectObjects] = await Promise.all([
            resolveObjects(filter, options),
            resolveIndirectObjects(filter, options),
        ]);
        if (results.actions && results.actions.length > 0) {
            // Todo: index
            filterResults(results, filter, objects, indirectObjects);
        }
        return results;
    }

    async function searchVerbs(
        verbs: string[],
        tense?: VerbTense,
        options?: SearchOptions,
    ): Promise<ScoredItem<ActionId[]>[]> {
        const fullVerb = actionVerbsToString(verbs, tense);
        return searchIndex(
            verbIndex,
            fullVerb,
            false,
            options?.maxMatches ?? 1,
            options?.minScore,
        );
    }

    async function matchSubjects(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionId[] | undefined> {
        return filter.subjectEntityName
            ? subjectIndex.getNearest(
                  filter.subjectEntityName,
                  options.maxMatches,
                  options.minScore,
              )
            : undefined;
    }

    async function matchVerbs(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionId[] | undefined> {
        if (filter.verbs && filter.verbs.length > 0) {
            const verbOptions = options.verbSearchOptions ?? options;
            return verbIndex.getNearest(
                actionVerbsToString(filter.verbs, filter.verbTense),
                verbOptions.maxMatches,
                verbOptions.minScore,
            );
        }
        return undefined;
    }

    async function resolveObjects(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ) {
        if (filter.objectEntityName) {
            return resolveEntityNames(filter.objectEntityName!, options);
        }
        return undefined;
    }

    async function resolveIndirectObjects(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ) {
        if (filter.indirectObjectEntityName) {
            return resolveEntityNames(
                filter.indirectObjectEntityName!,
                options,
            );
        }
        return undefined;
    }

    function filterResults(
        results: ActionSearchResult<ActionId>,
        filter: ActionFilter,
        objects: string[] | undefined,
        indirectObjects: string[] | undefined,
    ) {
        for (let i = 0; i < results.actions!.length; ) {
            const action = results.actions![i];
            if (
                !filterEntity(filter.objectEntityName, objects) ||
                !filterEntity(filter.indirectObjectEntityName, indirectObjects)
            ) {
                removeMatch(results, i);
            } else {
                ++i;
            }
        }
    }

    function filterEntity(
        name: string | undefined,
        entityNames: string[] | undefined,
    ): boolean {
        if (entityNames && entityNames.length > 0) {
            // TODO: consider switch to binary search
            return name ? entityNames.indexOf(name.toLowerCase()) >= 0 : false;
        }
        return true;
    }

    function removeMatch(results: ActionSearchResult<ActionId>, at: number) {
        results.actions!.splice(at, 1);
        results.actionIds!.splice(at, 1);
    }

    async function resolveEntityNames(
        name: string,
        options: SearchOptions,
    ): Promise<string[] | undefined> {
        const entityIndex = await getEntityIndex();
        const textIds = await entityIndex.nameIndex.getNearestText(
            name,
            options.maxMatches,
            options.minScore,
        );
        return (await entityIndex.nameIndex.getTextMultiple(
            textIds,
        )) as string[];
    }
}
