// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { createDb, tablePath } from "./common.js";
import { createTextIndex } from "./textTable.js";
import { createObjectTable } from "./objectTable.js";
import { ObjectFolder, ObjectFolderSettings } from "typeagent";

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
        createObjectFolder: _createObjectFolder,
        createTextIndex: _createTextIndex,
    };

    async function _createObjectFolder<T>(
        folderPath: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        return createObjectTable<T>(db, folderPath, settings);
    }

    async function _createTextIndex<TSourceId extends knowLib.ValueType>(
        settings: knowLib.TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: knowLib.ValueDataType<TSourceId>,
    ) {
        return createTextIndex<string, TSourceId>(
            settings,
            db,
            getTablePath(basePath, name),
            "TEXT",
            sourceIdType,
        );
    }

    function getTablePath(basePath: string, name: string): string {
        basePath = basePath.replace(rootPath, "");
        const baseDir = path.basename(basePath);
        return tablePath(baseDir, name);
    }
}
