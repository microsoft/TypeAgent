// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { createDb } from "./common.js";
import { createTextIndex, TextTable } from "./textTable.js";

export interface StorageDb extends knowLib.StorageProvider {
    readonly rootPath: string;
    readonly name: string;

    createTextIndex<TSourceId extends knowLib.ValueType>(
        settings: knowLib.TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: knowLib.ValueDataType<TSourceId>,
    ): Promise<TextTable<string, TSourceId>>;
}

export async function createStorageDb(
    rootPath: string,
    name: string,
    createNew: boolean,
): Promise<StorageDb> {
    const db = await createDb(path.join(rootPath, name), createNew);
    return {
        rootPath,
        name,
        createTextIndex: _createTextIndex,
    };

    async function _createTextIndex<TSourceId extends knowLib.ValueType>(
        settings: knowLib.TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: knowLib.ValueDataType<TSourceId>,
    ) {
        return createTextIndex<string, TSourceId>(
            settings,
            db,
            name,
            "TEXT",
            sourceIdType,
        );
    }
}
