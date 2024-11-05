// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    asyncArray,
    createObjectFolder,
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";
import { TextIndexSettings } from "./knowledgeIndex.js";
import { createTemporalLog, TemporalLog } from "./temporal.js";
import path from "path";
import { removeUndefined } from "./setOperations.js";

export interface KnowledgeStore<T, TId = any> {
    readonly settings: TextIndexSettings;
    readonly store: ObjectFolder<T>;
    readonly sequence: TemporalLog<TId, TId[]>;
    entries(): AsyncIterableIterator<T>;
    get(id: TId): Promise<T | undefined>;
    getMultiple(ids: TId[]): Promise<T[]>;
    add(item: T, id?: TId): Promise<TId>;
    addNext(items: T[], timestamp?: Date | undefined): Promise<TId[]>;
}

export async function createKnowledgeStore<T>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<KnowledgeStore<T, string>> {
    type TId = string;
    const [sequence, entries] = await Promise.all([
        createTemporalLog<TId[]>(
            { concurrency: settings.concurrency },
            path.join(rootPath, "sequence"),
            folderSettings,
            fSys,
        ),
        createObjectFolder<T>(
            path.join(rootPath, "entries"),
            folderSettings,
            fSys,
        ),
    ]);

    return {
        settings,
        store: entries,
        sequence,
        entries: entries.allObjects,
        get: entries.get,
        getMultiple,
        add,
        addNext,
    };

    async function getMultiple(ids: TId[]): Promise<T[]> {
        const items = await asyncArray.mapAsync(
            ids,
            settings.concurrency,
            (id) => entries.get(id),
        );
        return removeUndefined(items);
    }

    async function addNext(
        items: T[],
        timestamp?: Date | undefined,
    ): Promise<TId[]> {
        const itemIds = await asyncArray.mapAsync(items, 1, (e) =>
            entries.put(e),
        );

        itemIds.sort();
        await sequence.put(itemIds, timestamp);
        return itemIds;
    }

    async function add(item: T, id?: TId): Promise<TId> {
        return id ? id : await entries.put(item, id);
    }
}
