// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { createDb, tablePath } from "./common.js";
import { createTextIndex } from "./textTable.js";
import { createObjectTable } from "./objectTable.js";
import { ObjectFolder, ObjectFolderSettings } from "typeagent";
import { createTemporalLogTable, TemporalTable } from "./temporalTable.js";
import { TemporalLogSettings } from "knowledge-processor";
import { createKeyValueTable, KeyValueTable } from "./keyValueTable.js";

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
        createTemporalLog: _createTemporalLog,
        createTextIndex: _createTextIndex,
        createIndex: _createIndex,
    };

    async function _createObjectFolder<T>(
        basePath: string,
        name: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        return createObjectTable<T>(db, getTablePath(basePath, name), settings);
    }

    async function _createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ): Promise<TemporalTable<string, T>> {
        return createTemporalLogTable<T, string, string>(
            db,
            getTablePath(basePath, name),
            "TEXT",
            "TEXT",
        );
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

    async function _createIndex<TValueId extends knowLib.ValueType>(
        basePath: string,
        name: string,
        valueType: knowLib.ValueDataType<TValueId>,
    ): Promise<KeyValueTable<string, TValueId>> {
        return createKeyValueTable<string, TValueId>(
            db,
            getTablePath(basePath, name),
            "TEXT",
            valueType,
        );
    }

    function getTablePath(basePath: string, name: string): string {
        basePath = basePath.replace(rootPath, "");
        const baseDir = path
            .basename(basePath)
            .replaceAll("/", "_")
            .replaceAll("\\", "_");
        return tablePath(baseDir, name);
    }
}
