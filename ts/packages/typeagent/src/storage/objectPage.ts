// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import { collections } from "..";
import { readJsonFile } from "../objStream";
import { FileSystem, fsDefault, safeWrite } from "./objectFolder";

export interface ObjectPage<T = any> {
    readonly size: number;

    getAt(pos: number): T;
    indexOf(value: T): number;
    put(values: T | T[]): void;
    save(): Promise<void>;
}

export async function createObjectPage<T = any>(
    filePath: string,
    compareFn: (x: T, y: T) => number,
    safeWrites: boolean = false,
    fSys?: FileSystem | undefined,
): Promise<ObjectPage<T>> {
    const fileSystem = fSys ?? fsDefault();
    let data: T[] = (await readJsonFile(filePath)) ?? [];
    return {
        get size() {
            return data.length;
        },
        getAt,
        indexOf,
        put,
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
    }

    async function save(): Promise<void> {
        const json = JSON.stringify(data);
        if (safeWrites) {
            await safeWrite(filePath, json, fSys);
        }
        await fileSystem.write(filePath, json);
    }
}

export interface HashObjectFolder<T = any> {
    get(name: string): Promise<T | undefined>;
    put(key: string, value: T): Promise<void>;
}

export async function createHashObjectFolder<T = any>(
    folderPath: string,
    numBuckets: number = 17,
    fSys?: FileSystem,
): Promise<HashObjectFolder<T>> {
    type KV = {
        key: string;
        value?: T | undefined;
    };
    type KVPage = ObjectPage<KV>;
    const fileSystem = fSys ?? fsDefault();

    await fileSystem.ensureDir(folderPath);

    return {
        get,
        put,
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
        await page.save();
    }

    function getCachedPage(pageName: string): KVPage | undefined {
        return undefined;
    }

    async function getPage(pageName: string): Promise<KVPage> {
        const pagePath = path.join(folderPath, pageName);
        const page = await createObjectPage<KV>(
            pagePath,
            (x, y) => collections.stringCompare(x.key, y.key, true),
            false,
            fSys,
        );
        return page;
    }

    function keyToPageName(key: string): string {
        const bucketId = collections.stringHashCode(key) % numBuckets;
        return bucketId.toFixed(0);
    }
}
