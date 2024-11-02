// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    FileSystem,
    NameValue,
    ObjectFolder,
    ObjectFolderSettings,
    asyncArray,
    collections,
    createObjectFolder,
    dateTime,
    ensureUniqueObjectName,
    //generateMonotonicName,
} from "typeagent";
import { intersectMultiple, setFrom } from "./setOperations.js";
import { DateRange } from "../../typeagent/dist/dateTime.js";
import { pathToFileURL } from "url";
import path from "path";

/**
 * @template TId the type of the log entry Id
 * @template T type of object stored in the log
 */
export interface TemporalLog<TId = any, T = any> {
    size(): Promise<number>;
    all(): AsyncIterableIterator<NameValue<dateTime.Timestamped<T>, TId>>;
    allObjects(): AsyncIterableIterator<dateTime.Timestamped<T>>;
    get(id: TId): Promise<dateTime.Timestamped<T> | undefined>;
    getMultiple(ids: TId[]): Promise<(dateTime.Timestamped<T> | undefined)[]>;
    getIdsInRange(startAt: Date, stopAt?: Date): Promise<TId[]>;
    getEntriesInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<dateTime.Timestamped<T>[]>;
    put(value: T, timestamp?: Date): Promise<TId>;

    newestObjects(): AsyncIterableIterator<dateTime.Timestamped<T>>;
    getNewest(count: number): Promise<dateTime.Timestamped<T>[]>;
    getOldest(count: number): Promise<dateTime.Timestamped<T>[]>;

    getTimeRange(): Promise<DateRange | undefined>;

    remove(id: TId): Promise<void>;
    removeInRange(startAt: Date, stopAt: Date): Promise<void>;
    clear(): Promise<void>;

    getUrl?: (id: TId) => URL;
}

export type TemporalLogSettings = {
    concurrency: number;
};

export async function createTemporalLog<T>(
    settings: TemporalLogSettings,
    folderPath: string,
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem,
): Promise<TemporalLog<string, T>> {
    type TId = string;
    // Timestamped sequence of topics, as they were seen
    const sequence = await createObjectFolder<string>(
        folderPath,
        folderSettings,
        fSys,
    );
    return {
        size: sequence.size,
        all,
        allObjects,
        get,
        getMultiple,
        getIdsInRange,
        getEntriesInRange,
        put,
        newestObjects,
        getNewest,
        getOldest,
        getTimeRange,
        getUrl,
        remove,
        removeInRange,
        clear: sequence.clear,
    };

    async function* all(): AsyncIterableIterator<
        NameValue<dateTime.Timestamped<T>, TId>
    > {
        for await (const nv of sequence.all()) {
            yield {
                name: nv.name,
                value: dateTime.parseTimestamped<T>(nv.value),
            };
        }
    }

    async function* allObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        for await (const nv of sequence.all()) {
            yield dateTime.parseTimestamped<T>(nv.value);
        }
    }

    async function* newestObjects(): AsyncIterableIterator<
        dateTime.Timestamped<T>
    > {
        for await (const nv of sequence.newest()) {
            yield dateTime.parseTimestamped<T>(nv.value);
        }
    }

    async function get(id: TId): Promise<dateTime.Timestamped<T> | undefined> {
        return getTimestampedObject<T>(sequence, id);
    }

    async function getMultiple(
        ids: TId[],
    ): Promise<(dateTime.Timestamped<T> | undefined)[]> {
        return asyncArray.mapAsync(ids, settings.concurrency, async (id) =>
            get(id),
        );
    }

    async function getIdsInRange(startAt: Date, stopAt?: Date): Promise<TId[]> {
        const allIds = await sequence.allNames();
        const range = collections.getInRange(
            allIds,
            dateTime.timestampString(startAt),
            stopAt ? dateTime.timestampString(stopAt) : undefined,
            strCmp,
        );
        return range;
    }

    async function getEntriesInRange(
        startAt: Date,
        stopAt?: Date,
    ): Promise<dateTime.Timestamped<T>[]> {
        const ids = await getIdsInRange(startAt, stopAt);
        if (ids.length === 0) {
            return [];
        }
        return (await getMultiple(ids)) as dateTime.Timestamped<T>[];
    }

    async function getNewest(
        count: number,
    ): Promise<dateTime.Timestamped<T>[]> {
        const allIds = await sequence.allNames();
        count = Math.min(allIds.length, count);
        const ids = allIds.slice(allIds.length - count);
        return (await getMultiple(ids)) as dateTime.Timestamped<T>[];
    }

    async function getOldest(
        count: number,
    ): Promise<dateTime.Timestamped<T>[]> {
        const allIds = await sequence.allNames();
        count = Math.min(allIds.length, count);
        const ids = allIds.slice(0, count);
        return (await getMultiple(ids)) as dateTime.Timestamped<T>[];
    }

    async function getTimeRange(): Promise<DateRange | undefined> {
        // TODO: cache the time range.
        const allIds = await sequence.allNames();
        if (allIds.length === 0) {
            return undefined;
        }
        const first = await get(allIds[0]);
        if (!first) {
            return undefined;
        }
        const last = await get(allIds[allIds.length - 1]);
        return {
            startDate: first?.timestamp,
            stopDate: last?.timestamp,
        };
    }

    async function put(value: T, timestamp?: Date, id?: string): Promise<TId> {
        return putTimestampedObject(sequence, value, timestamp);
    }

    async function remove(id: TId): Promise<void> {
        sequence.remove(id);
    }

    async function removeInRange(startAt: Date, stopAt: Date): Promise<void> {
        const idsToRemove = await getIdsInRange(startAt, stopAt);
        for (const id of idsToRemove) {
            await sequence.remove(id);
        }
    }

    function getUrl(id: string): URL {
        return pathToFileURL(path.join(sequence.path, id));
    }
    function strCmp(x: string, y: string): number {
        return x.localeCompare(y);
    }
}

export async function putTimestampedObject(
    store: ObjectFolder<string>,
    value: any,
    timestamp?: Date,
): Promise<string> {
    timestamp ??= new Date();
    const tValue = dateTime.stringifyTimestamped(value, timestamp);
    let id: string | undefined = dateTime.timestampString(timestamp);
    id = ensureUniqueObjectName(store, id);
    if (!id) {
        throw new Error(`${store.path}\nCould not create unique id for ${id}`);
    }
    return store.put(tValue, id);
}

export async function getTimestampedObject<T>(
    store: ObjectFolder<string>,
    id: string,
): Promise<dateTime.Timestamped<T> | undefined> {
    const json = await store.get(id);
    if (json) {
        return dateTime.parseTimestamped<T>(json);
    }
    return undefined;
}

export function itemsFromTemporalSequence<T>(
    sequence: Iterable<dateTime.Timestamped<T[]>> | undefined,
): T[] | undefined {
    if (sequence) {
        return [...setFrom(sequence, (value) => value.value).values()].sort();
    }
    return undefined;
}

export function filterTemporalSequence<T>(
    sequence: Iterable<dateTime.Timestamped<T[]>>,
    requiredValues: T[],
): dateTime.Timestamped<T[]>[] {
    const filtered: dateTime.Timestamped<T[]>[] = [];
    for (const value of sequence) {
        const combined = [...intersectMultiple(value.value, requiredValues)];
        if (combined.length > 0) {
            filtered.push({
                timestamp: value.timestamp,
                value: combined,
            });
        }
    }
    return filtered;
}

export function getRangeOfTemporalSequence(
    sequence: dateTime.Timestamped[] | undefined,
): dateTime.DateRange | undefined {
    if (!sequence || sequence.length === 0) {
        return undefined;
    }

    return {
        startDate: sequence[0].timestamp,
        stopDate: sequence[sequence.length - 1].timestamp,
    };
}
