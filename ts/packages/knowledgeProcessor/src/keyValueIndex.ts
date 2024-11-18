// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    asyncArray,
    createObjectFolder,
    FileSystem,
    ObjectFolderSettings,
} from "typeagent";
import { removeUndefined, union } from "./setOperations.js";

/**
 * KeyValueIndex is a multi-map.
 * For each keyId, maintains a collection of one or more value Ids
 */
export interface KeyValueIndex<TKeyId = any, TValueId = any> {
    get(id: TKeyId): Promise<TValueId[] | undefined>;
    getMultiple(ids: TKeyId[], concurrency?: number): Promise<TValueId[][]>;
    put(postings: TValueId[], id?: TKeyId): Promise<TKeyId>;
    replace(postings: TValueId[], id: TKeyId): Promise<TKeyId>;
    remove(id: TKeyId): Promise<void>;
}

export async function createIndexFolder<TValueId>(
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<KeyValueIndex<string, TValueId>> {
    type TKeyId = string;
    const indexFolder = await createObjectFolder<TValueId[]>(
        folderPath,
        folderSettings,
        fSys,
    );
    return {
        get,
        getMultiple,
        put,
        replace,
        remove,
    };

    async function get(id: TKeyId): Promise<TValueId[] | undefined> {
        return indexFolder.get(id);
    }

    async function getMultiple(
        ids: TKeyId[],
        concurrency?: number,
    ): Promise<TValueId[][]> {
        const values = await asyncArray.mapAsync(ids, concurrency ?? 1, (id) =>
            indexFolder.get(id),
        );
        return removeUndefined(values);
    }

    async function put(postings?: TValueId[], id?: TKeyId): Promise<TKeyId> {
        postings = preparePostings(postings);
        const existingPostings = id ? await indexFolder.get(id) : undefined;
        const updatedPostings =
            existingPostings && existingPostings.length > 0
                ? [...union(existingPostings, postings)]
                : postings;
        return await indexFolder.put(updatedPostings, id);
    }

    function replace(postings: TValueId[], id: TKeyId): Promise<TKeyId> {
        return indexFolder.put(postings, id);
    }

    function remove(id: TKeyId): Promise<void> {
        return indexFolder.remove(id);
    }

    function preparePostings(postings?: TValueId[]): TValueId[] {
        return postings ? postings.sort() : [];
    }
}
