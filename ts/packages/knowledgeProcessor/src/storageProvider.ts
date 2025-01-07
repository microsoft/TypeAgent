// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createObjectFolder,
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";
import { createTextIndex, TextIndex, TextIndexSettings } from "./textIndex.js";
import path from "path";
import {
    createTemporalLog,
    TemporalLog,
    TemporalLogSettings,
} from "./temporal.js";
import { createIndexFolder, KeyValueIndex } from "./keyValueIndex.js";

export type ValueType = string | number;

export type ValueDataType<T> = T extends string
    ? "TEXT"
    : T extends number
      ? "INTEGER"
      : never;

export interface StorageProvider {
    createObjectFolder<T>(
        basePath: string,
        name: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>>;
    createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ): Promise<TemporalLog<string, T>>;
    createTextIndex<TSourceId extends ValueType>(
        settings: TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: ValueDataType<TSourceId>,
    ): Promise<TextIndex<string, TSourceId>>;
    createIndex<TValueId extends ValueType>(
        basePath: string,
        name: string,
        valueType: ValueDataType<TValueId>,
    ): Promise<KeyValueIndex<string, TValueId>>;

    clear(): Promise<void>;
}

export function createFileSystemStorageProvider(
    rootPath: string,
    defaultFolderSettings?: ObjectFolderSettings,
    fSys?: FileSystem | undefined,
): StorageProvider {
    return {
        createObjectFolder: _createObjectFolder,
        createTemporalLog: _createTemporalLog,
        createTextIndex: _createTextIndex,
        createIndex: _createIndex,
        clear,
    };

    async function _createObjectFolder<T>(
        basePath: string,
        name: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        verifyPath(basePath);
        return createObjectFolder<T>(
            path.join(basePath, name),
            settings ?? defaultFolderSettings,
            fSys,
        );
    }

    async function _createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ) {
        verifyPath(basePath);
        return createTemporalLog<T>(
            settings,
            path.join(basePath, name),
            defaultFolderSettings,
            fSys,
        );
    }

    async function _createTextIndex<TSourceId extends ValueType>(
        settings: TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: ValueDataType<TSourceId>,
    ): Promise<TextIndex<string, TSourceId>> {
        if (sourceIdType !== "TEXT") {
            throw new Error(`SourceId of type ${sourceIdType} not supported.`);
        }
        verifyPath(basePath);
        return createTextIndex<TSourceId>(
            settings,
            path.join(basePath, name),
            defaultFolderSettings,
            fSys,
        );
    }

    async function _createIndex<TValueId extends ValueType>(
        basePath: string,
        name: string,
        valueType: ValueDataType<TValueId>,
    ) {
        verifyPath(basePath);
        return createIndexFolder<TValueId>(
            path.join(basePath, name),
            defaultFolderSettings,
            fSys,
        );
    }

    function verifyPath(basePath: string) {
        if (!basePath.startsWith(rootPath)) {
            throw new Error(`${basePath} must be a subDir of ${rootPath}`);
        }
    }

    async function clear() {
        // TODO: implement this once conversation is cleaned up and message Index is also backed by storageProvider
        // await removeDir(rootPath, fSys);
    }
}
