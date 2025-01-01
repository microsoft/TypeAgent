// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, NameValue } from "typeagent";
import { StorageProvider } from "../storageProvider.js";
import { removeUndefined } from "../setOperations.js";
import { DateTimeRange } from "./dateTimeSchema.js";
import { createTagIndexOnStorage } from "../knowledgeStore.js";

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

    addTag(tag: string, ids: TThreadId | TThreadId[]): Promise<string>;
    getByTag(tag: string | string[]): Promise<TThreadId[] | undefined>;
}

export async function createThreadIndexOnStorage(
    rootPath: string,
    storageProvider: StorageProvider,
): Promise<ThreadIndex<string>> {
    type EntryId = string;
    const threadStore =
        await storageProvider.createObjectFolder<ConversationThread>(
            rootPath,
            "entries",
        );
    const textIndex = await storageProvider.createTextIndex<EntryId>(
        { caseSensitive: false, semanticIndex: true, concurrency: 1 },
        rootPath,
        "description",
        "TEXT",
    );
    const tagIndex = await createTagIndexOnStorage(
        { concurrency: 1 },
        rootPath,
        storageProvider,
        "TEXT",
    );
    return {
        entries: () => threadStore.all(),
        add,
        getById,
        getIds,
        get,
        getNearest,
        addTag,
        getByTag,
    };

    async function add(threadDef: ConversationThread): Promise<EntryId> {
        const entryId = await threadStore.put(threadDef);
        await textIndex.put(threadDef.description, [entryId]);
        return entryId;
    }

    function getById(id: EntryId): Promise<ConversationThread | undefined> {
        return threadStore.get(id);
    }

    function getIds(description: string): Promise<EntryId[] | undefined> {
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
        entryIds: EntryId[],
    ): Promise<ConversationThread[]> {
        const threads = await asyncArray.mapAsync(entryIds, 1, (id) =>
            threadStore.get(id),
        );
        return removeUndefined(threads);
    }

    function addTag(tag: string, ids: EntryId | EntryId[]): Promise<EntryId> {
        return tagIndex.addTag(tag, ids);
    }

    function getByTag(tag: string | string[]): Promise<EntryId[] | undefined> {
        return tagIndex.getByTag(tag);
    }
}
