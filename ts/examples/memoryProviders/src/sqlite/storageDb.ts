// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "path";
import * as knowLib from "knowledge-processor";
import { createDatabase, tablePath } from "./common.js";
import { createTextIndex } from "./textTable.js";
import { createObjectTable } from "./objectTable.js";
import { ensureDir, ObjectFolder, ObjectFolderSettings } from "typeagent";
import { createTemporalLogTable, TemporalTable } from "./temporalTable.js";
import { TemporalLogSettings } from "knowledge-processor";
import { createKeyValueTable, KeyValueTable } from "./keyValueTable.js";

export interface StorageDb extends knowLib.StorageProvider {
    readonly rootPath: string;
    readonly name: string;

    close(): void;
}

export async function createStorageDb(
    rootPath: string,
    name: string,
    createNew: boolean,
): Promise<StorageDb> {
    await ensureDir(rootPath);
    const dbPath = path.join(rootPath, name);
    let db = await createDatabase(dbPath, createNew);
    let counter = 0;
    return {
        rootPath,
        name,
        createObjectFolder: _createObjectFolder,
        createTemporalLog: _createTemporalLog,
        createTextIndex: _createTextIndex,
        createIndex: _createIndex,
        close,
        clear,
    };

    async function _createObjectFolder<T>(
        basePath: string,
        name: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        ensureOpen();
        return createObjectTable<T>(db, getTablePath(basePath, name), settings);
    }

    async function _createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ): Promise<TemporalTable<string, T>> {
        ensureOpen();
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
        ensureOpen();
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
        ensureOpen();
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

    function ensureOpen() {
        if (db && db.open) {
            return;
        }
        throw new Error(`Database ${rootPath}, version ${counter} is not open`);
    }

    function close() {
        if (db) {
            db.close();
        }
    }

    async function clear(): Promise<void> {
        close();
        db = await createDatabase(dbPath, true);
        counter++;
    }
}
