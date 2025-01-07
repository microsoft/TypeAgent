// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
import {
    asyncArray,
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";
import { TextIndex, TextIndexSettings } from "./textIndex.js";
import { TemporalLog } from "./temporal.js";
import {
    intersectMultiple,
    removeUndefined,
    unionMultiple,
} from "./setOperations.js";
import {
    createFileSystemStorageProvider,
    StorageProvider,
} from "./storageProvider.js";
import path from "path";

export interface KnowledgeStore<T, TId = any> {
    readonly settings: TextIndexSettings;
    readonly store: ObjectFolder<T>;
    readonly sequence: TemporalLog<TId, TId[]>;
    entries(): AsyncIterableIterator<T>;
    get(id: TId): Promise<T | undefined>;
    getMultiple(ids: TId[]): Promise<T[]>;
    add(item: T, id?: TId): Promise<TId>;
    addNext(items: T[], timestamp?: Date | undefined): Promise<TId[]>;

    getTagIndex(): Promise<TextIndex<TId>>;
    /**
     * Add tag for knowledge entries with the given ids
     * @param tag
     * @param ids
     */
    addTag(tag: string, ids: TId | TId[]): Promise<string>;
    getByTag(
        tag: string | string[],
        unionMatches?: boolean,
    ): Promise<TId[] | undefined>;
}

export async function createKnowledgeStore<T>(
    settings: TextIndexSettings,
    rootPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<KnowledgeStore<T, string>> {
    return createKnowledgeStoreOnStorage<T>(
        settings,
        rootPath,
        createFileSystemStorageProvider(rootPath, folderSettings, fSys),
    );
}

export async function createKnowledgeStoreOnStorage<T>(
    settings: TextIndexSettings,
    rootPath: string,
    storageProvider: StorageProvider,
): Promise<KnowledgeStore<T, string>> {
    type TId = string;
    type TagId = string;
    const [sequence, entries] = await Promise.all([
        storageProvider.createTemporalLog<TId[]>(
            { concurrency: settings.concurrency },
            rootPath,
            "sequence",
        ),
        storageProvider.createObjectFolder<T>(rootPath, "entries"),
    ]);
    let tagIndex: TextIndex | undefined;
    return {
        settings,
        store: entries,
        sequence,
        entries: entries.allObjects,
        get: entries.get,
        getMultiple,
        add,
        addNext,
        getTagIndex,
        addTag,
        getByTag,
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

    async function addTag(tag: string, tIds: TId | TId[]): Promise<TagId> {
        const tagIndex = await getTagIndex();
        return await tagIndex.put(tag, Array.isArray(tIds) ? tIds : [tIds]);
    }

    async function getByTag(
        tag: string | string[],
        unionMatches?: boolean,
    ): Promise<TId[] | undefined> {
        unionMatches ??= false;
        const tagIndex = await getTagIndex();
        let tagMatches: string[] | undefined;
        if (Array.isArray(tag)) {
            const ids = await asyncArray.mapAsync(
                tag,
                settings.concurrency,
                (t) => tagIndex.get(t),
            );
            tagMatches = [
                ...(unionMatches
                    ? unionMultiple(...ids)
                    : intersectMultiple(...ids)),
            ];
        } else {
            tagMatches = await tagIndex.get(tag);
        }
        return tagMatches && tagMatches.length > 0 ? tagMatches : undefined;
    }

    async function getTagIndex(): Promise<TextIndex<TagId, TId>> {
        if (!tagIndex) {
            tagIndex = await storageProvider.createTextIndex<TId>(
                {
                    caseSensitive: false,
                    semanticIndex: undefined,
                    concurrency: settings.concurrency,
                },
                rootPath,
                "tags",
                "TEXT",
            );
        }
        return tagIndex;
    }
}

export interface TagIndexSettings {
    concurrency: number;
}

export interface TagIndex<TTagId = any, TId = any> {
    tags(): Promise<string[]>;
    addTag(tag: string, id: TId): Promise<TTagId>;
    getByTag(tag: string | string[]): Promise<TId[] | undefined>;
    getTagsFor(id: TId): Promise<string[] | undefined>;
    removeTag(tag: string, id: TId): Promise<void>;
}

export async function createTagIndexOnStorage(
    settings: TagIndexSettings,
    rootPath: string,
    storageProvider: StorageProvider,
): Promise<TagIndex<string, string>> {
    type TagId = string;
    type TId = string;
    const storePath = path.join(rootPath, "tags");
    const tagIndex = await storageProvider.createTextIndex<TId>(
        {
            caseSensitive: false,
            semanticIndex: undefined,
            concurrency: settings.concurrency,
        },
        storePath,
        "tagToSrc",
        "TEXT",
    );
    const sourceIndex = await storageProvider.createIndex<TagId>(
        storePath,
        "srcToTag",
        "TEXT",
    );

    return {
        tags,
        addTag,
        removeTag,
        getByTag,
        getTagsFor,
    };

    async function tags(): Promise<string[]> {
        return Promise.resolve([...tagIndex.text()]);
    }

    async function addTag(tag: string, id: TId): Promise<TagId> {
        const tagId = await tagIndex.put(tag, [id]);
        await sourceIndex.put([tagId], id);
        return tagId;
    }

    async function removeTag(tag: string, id: TId): Promise<void> {
        const tagId = await tagIndex.getId(tag);
        if (tagId) {
            await tagIndex.remove(tagId, [id]);
        }
    }

    async function getByTag(
        tag: string | string[],
    ): Promise<TId[] | undefined> {
        let tagMatches: TId[] | undefined;
        if (Array.isArray(tag)) {
            const ids = await asyncArray.mapAsync(
                tag,
                settings.concurrency,
                (t) => tagIndex.get(t),
            );
            tagMatches = [...intersectMultiple(...ids)];
        } else {
            tagMatches = await tagIndex.get(tag);
        }
        return tagMatches && tagMatches.length > 0 ? tagMatches : undefined;
    }

    async function getTagsFor(id: TId): Promise<string[] | undefined> {
        const postings = await sourceIndex.get(id);
        if (postings && postings.length > 0) {
            const tags = await asyncArray.mapAsync(
                postings,
                settings.concurrency,
                (id) => tagIndex.getText(id),
            );
            return removeUndefined(tags);
        }
        return undefined;
    }
}
