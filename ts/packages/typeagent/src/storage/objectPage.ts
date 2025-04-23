// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { collections } from "../index.js";
import {
    FileSystem,
    fsDefault,
    ObjectDeserializer,
    ObjectSerializer,
    readObjectFromFile,
    writeObjectToFile,
} from "./objectFolder.js";

export interface ObjectPage<T = any> {
    readonly size: number;
    readonly isDirty: boolean;

    getAt(pos: number): T;
    indexOf(value: T): number;
    put(values: T | T[]): void;
    removeAt(pos: number): void;
    save(): Promise<void>;
}

export type ObjectPageSettings = {
    cacheSize?: number | undefined;
    serializer?: ObjectSerializer | undefined;
    deserializer?: ObjectDeserializer | undefined;
    safeWrites?: boolean | undefined | undefined;
};

export async function createObjectPage<T = any>(
    filePath: string,
    compareFn: (x: T, y: T) => number,
    settings?: ObjectPageSettings | undefined,
    fSys?: FileSystem | undefined,
): Promise<ObjectPage<T>> {
    const pageSettings = settings ?? {};
    const fileSystem = fSys ?? fsDefault();
    let data: T[] =
        (await readObjectFromFile(
            filePath,
            pageSettings.deserializer,
            fileSystem,
        )) ?? [];
    let isDirty = false;
    return {
        get size() {
            return data.length;
        },
        get isDirty() {
            return isDirty;
        },
        getAt,
        indexOf,
        put,
        removeAt,
        save,
    };

    function getAt(pos: number): T {
        return data[pos];
    }

    function indexOf(value: T): number {
        return collections.binarySearch(data, value, compareFn);
    }

    function put(values: T | T[]): void {
        if (Array.isArray(values)) {
            for (const value of values) {
                collections.addOrUpdateIntoSorted(data, value, compareFn);
            }
        } else {
            collections.addOrUpdateIntoSorted(data, values, compareFn);
        }
        isDirty = true;
    }

    function removeAt(pos: number): void {
        data.splice(pos, 1);
        isDirty = true;
    }

    async function save(): Promise<void> {
        if (isDirty) {
            try {
                isDirty = false;
                await writeObjectToFile(
                    filePath,
                    data,
                    pageSettings.serializer,
                    pageSettings.safeWrites,
                );
            } catch {
                isDirty = true;
            }
        }
    }
}

export interface HashObjectFolder<T = any> {
    get(key: string): Promise<T | undefined>;
    put(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
    save(): Promise<void>;
}

export async function createHashObjectFolder<T = any>(
    folderPath: string,
    clean: boolean = false,
    numBuckets: number = 17,
    pageSettings?: ObjectPageSettings | undefined,
    fSys?: FileSystem,
): Promise<HashObjectFolder<T>> {
    type KV = {
        key: string;
        value?: T | undefined;
    };
    type KVPage = ObjectPage<KV>;
    const fileSystem = fSys ?? fsDefault();
    if (clean) {
        await fileSystem.rmdir(folderPath);
    }
    await fileSystem.ensureDir(folderPath);

    const pageCache = createCache();
    const autoSave = pageCache === undefined;

    return {
        get,
        put,
        remove,
        save,
    };

    async function get(key: string): Promise<T | undefined> {
        const pageName = keyToPageName(key);
        const page = getCachedPage(pageName) ?? (await getPage(pageName));
        const pos = page.indexOf({ key });
        return pos >= 0 ? page.getAt(pos).value : undefined;
    }

    async function put(key: string, value: T): Promise<void> {
        const pageName = keyToPageName(key);
        const page = getCachedPage(pageName) ?? (await getPage(pageName));
        page.put({ key, value });
        if (autoSave && page.isDirty) {
            await page.save();
        }
    }

    async function remove(key: string): Promise<void> {
        const pageName = keyToPageName(key);
        const page = getCachedPage(pageName) ?? (await getPage(pageName));
        const pos = page.indexOf({ key });
        if (pos >= 0) {
            page.removeAt(pos);
            if (autoSave) {
                await page.save();
            }
        }
    }

    async function save(): Promise<void> {
        if (!pageCache) {
            return;
        }
        for (const kv of pageCache.all()) {
            await kv.value.save();
        }
    }

    function getCachedPage(pageName: string): KVPage | undefined {
        return pageCache ? pageCache.get(pageName) : undefined;
    }

    async function getPage(pageName: string): Promise<KVPage> {
        const pagePath = path.join(folderPath, pageName);
        const page = await createObjectPage<KV>(
            pagePath,
            (x, y) => collections.stringCompare(x.key, y.key, true),
            pageSettings,
            fSys,
        );
        if (pageCache) {
            const lruPage = pageCache.removeLRU();
            pageCache.put(pageName, page);
            if (lruPage && lruPage.isDirty) {
                await lruPage.save();
            }
        }
        return page;
    }

    function keyToPageName(key: string): string {
        const bucketId = collections.stringHashCode(key) % numBuckets;
        return bucketId.toFixed(0);
    }

    function createCache() {
        return pageSettings?.cacheSize && pageSettings.cacheSize > 0
            ? collections.createLRUCache<string, KVPage>(pageSettings.cacheSize)
            : undefined;
    }
}
