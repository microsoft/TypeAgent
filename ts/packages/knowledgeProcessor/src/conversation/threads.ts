// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, NameValue } from "typeagent";
import { StorageProvider } from "../storageProvider.js";
import { removeUndefined } from "../setOperations.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import { createTagIndexOnStorage, TagIndex } from "../knowledgeStore.js";
import { TermFilterV2 } from "./knowledgeTermSearchSchema2.js";
import { getAllTermsInFilter } from "./knowledgeTermSearch2.js";

export interface ThreadDefinition {
    description: string;
    type: string;
}

export interface ThreadTimeRange extends ThreadDefinition {
    type: "temporal";
    timeRange: DateTimeRange;
}

export type ConversationThread = ThreadTimeRange;

export interface ThreadIndex<TThreadId = any> {
    readonly tagIndex: TagIndex;
    entries(): AsyncIterableIterator<NameValue<ConversationThread>>;
    add(threadDef: ConversationThread): Promise<TThreadId>;
    getIds(description: string): Promise<TThreadId[] | undefined>;
    getById(id: TThreadId): Promise<ConversationThread | undefined>;
    get(description: string): Promise<ConversationThread[] | undefined>;
    getNearest(
        description: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ConversationThread[]>;
    matchTags(filters: TermFilterV2[]): Promise<TThreadId[] | undefined>;
}

export async function createThreadIndexOnStorage(
    rootPath: string,
    storageProvider: StorageProvider,
): Promise<ThreadIndex<string>> {
    type ThreadId = string;
    const threadStore =
        await storageProvider.createObjectFolder<ConversationThread>(
            rootPath,
            "entries",
        );
    const textIndex = await storageProvider.createTextIndex<ThreadId>(
        { caseSensitive: false, semanticIndex: true, concurrency: 1 },
        rootPath,
        "description",
        "TEXT",
    );
    const tagIndex = await createTagIndexOnStorage(
        { concurrency: 1 },
        rootPath,
        storageProvider,
    );
    return {
        tagIndex,
        entries: () => threadStore.all(),
        add,
        getById,
        getIds,
        get,
        getNearest,
        matchTags,
    };

    async function add(threadDef: ConversationThread): Promise<ThreadId> {
        const entryId = await threadStore.put(threadDef);
        await textIndex.put(threadDef.description, [entryId]);
        return entryId;
    }

    function getById(id: ThreadId): Promise<ConversationThread | undefined> {
        return threadStore.get(id);
    }

    function getIds(description: string): Promise<ThreadId[] | undefined> {
        return textIndex.get(description);
    }

    async function get(
        description: string,
    ): Promise<ConversationThread[] | undefined> {
        const entryIds = await textIndex.get(description);
        if (entryIds && entryIds.length > 0) {
            return getByIds(entryIds);
        }
        return undefined;
    }

    async function getNearest(
        description: string,
        maxMatches: number,
        minScore?: number,
    ): Promise<ConversationThread[]> {
        const entryIds = await textIndex.getNearest(
            description,
            maxMatches,
            minScore,
        );
        if (entryIds && entryIds.length > 0) {
            return getByIds(entryIds);
        }
        return [];
    }

    async function getByIds(
        entryIds: ThreadId[],
    ): Promise<ConversationThread[]> {
        const threads = await asyncArray.mapAsync(entryIds, 1, (id) =>
            threadStore.get(id),
        );
        return removeUndefined(threads);
    }

    async function matchTags(
        filters: TermFilterV2[],
    ): Promise<ThreadId[] | undefined> {
        let matches: ThreadId[] | undefined;
        for (const filter of filters) {
            const terms = getAllTermsInFilter(filter, false);
            const threadIds = await tagIndex.getByTag(terms);
            if (threadIds && threadIds.length > 0) {
                matches ??= [];
                matches.push(...threadIds);
            }
        }
        return matches && matches.length > 0 ? matches : undefined;
    }
}
