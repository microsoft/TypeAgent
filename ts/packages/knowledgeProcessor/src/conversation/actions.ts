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
    KnowledgeStore,
    TextIndex,
    TextIndexSettings,
    createIndexFolder,
    createKnowledgeStore,
    createTextIndex,
} from "../knowledgeIndex.js";
import { Action, VerbTense } from "./knowledgeSchema.js";
import path from "path";
import { TextBlock, TextBlockType } from "../text.js";
import { ActionFilter } from "./knowledgeSearchSchema.js";
import { getRangeOfTemporalSequence } from "../temporal.js";
import { SetOp, uniqueFrom } from "../setOperations.js";
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
}

export async function createActionIndex<TEntityId = any, TSourceId = any>(
    settings: TextIndexSettings,
    getEntityIndex: () => Promise<EntityIndex<TEntityId>>,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<ActionIndex<string, string, TSourceId>> {
    type EntityId = string;
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
    return {
        ...actionStore,
        verbIndex,
        add,
        addMultiple,
        getActions,
        getSourceIds,
        search,
    };

    async function add(
        action: ExtractedAction<TSourceId>,
        id?: ActionId,
    ): Promise<ActionId> {
        id = await actionStore.add(action, id);
        await addVerb(action.value, id);
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

    async function addVerb(action: Action, id: ActionId): Promise<void> {
        const fullVerb = actionVerbsToString(action.verbs, action.verbTense);
        await verbIndex.put(fullVerb, [id]);
    }

    async function search(
        filter: ActionFilter,
        options: ActionSearchOptions,
    ): Promise<ActionSearchResult<ActionId>> {
        const results = createSearchResults<ActionId>();
        const fullVerb = actionVerbsToString(filter.verbs, filter.verbTense);
        if (filter.verbs) {
            const verbOptions = options.verbSearchOptions ?? options;
            results.actionIds = await verbIndex.getNearest(
                fullVerb,
                verbOptions.maxMatches,
                verbOptions.minScore,
            );
        }
        if (results.actionIds) {
            results.actions = await getActions(results.actionIds);
        }
        if (results.actions && results.actions.length > 0) {
            // Todo: index
            filterResults(
                results,
                filter,
                await resolveEntities(
                    filter,
                    options.entitySearchOptions ?? options,
                ),
            );
        }
        return results;
    }

    function filterResults(
        results: ActionSearchResult<ActionId>,
        filter: ActionFilter,
        actionEntities: ActionEntities,
    ) {
        for (let i = 0; i < results.actions!.length; ) {
            const action = results.actions![i];
            if (
                !filterEntity(
                    filter.subjectEntityName,
                    actionEntities.subjects,
                ) ||
                !filterEntity(
                    filter.objectEntityName,
                    actionEntities.objects,
                ) ||
                !filterEntity(
                    filter.indirectObjectEntityName,
                    actionEntities.indirectObjects,
                )
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

    async function resolveEntities(
        filter: ActionFilter,
        options: SearchOptions,
    ): Promise<ActionEntities> {
        const actionEntities: ActionEntities = {};
        const tasks = [];
        if (filter.subjectEntityName) {
            tasks.push(async () => {
                actionEntities.subjects = await resolveEntityNames(
                    filter.subjectEntityName!,
                    options,
                );
            });
        }
        if (filter.objectEntityName) {
            tasks.push(async () => {
                actionEntities.objects = await resolveEntityNames(
                    filter.objectEntityName!,
                    options,
                );
            });
        }
        if (filter.indirectObjectEntityName) {
            tasks.push(async () => {
                actionEntities.indirectObjects = await resolveEntityNames(
                    filter.indirectObjectEntityName!,
                    options,
                );
            });
        }
        await Promise.all(tasks);
        return actionEntities;
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

    type ActionEntities = {
        subjects?: string[] | undefined;
        objects?: string[] | undefined;
        indirectObjects?: string[] | undefined;
    };
}
