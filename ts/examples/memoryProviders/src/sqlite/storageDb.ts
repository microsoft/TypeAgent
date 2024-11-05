// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { createDb, tablePath } from "./common.js";
import { createTextIndex } from "./textTable.js";

export interface StorageDb extends knowLib.StorageProvider {
    readonly rootPath: string;
    readonly name: string;
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
        basePath = basePath.replace(rootPath, "");
        const baseDir = path.basename(basePath);
        return createTextIndex<string, TSourceId>(
            settings,
            db,
            tablePath(baseDir, name),
            "TEXT",
            sourceIdType,
        );
    }
}
