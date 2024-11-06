// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createObjectFolder,
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";
import {
    createIndexFolder,
    createTextIndex,
    TextIndex,
    TextIndexSettings,
} from "./knowledgeIndex.js";
import path from "path";
import {
    createTemporalLog,
    TemporalLog,
    TemporalLogSettings,
} from "./temporal.js";
import { KeyValueIndex } from "./keyValueIndex.js";

export type ValueType = string | number;

export type ValueDataType<T> = T extends string
    ? "TEXT"
    : T extends number
      ? "INTEGER"
      : never;

export interface StorageProvider {
    createObjectFolder<T>(
        folderPath: string,
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
}

export function createFileSystemStorageProvider(
    defaultFolderSettings?: ObjectFolderSettings,
    fSys?: FileSystem | undefined,
): StorageProvider {
    return {
        createObjectFolder: _createObjectFolder,
        createTemporalLog: _createTemporalLog,
        createTextIndex: _createTextIndex,
        createIndex: _createIndex,
    };

    async function _createObjectFolder<T>(
        folderPath: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        return createObjectFolder<T>(
            folderPath,
            settings ?? defaultFolderSettings,
            fSys,
        );
    }

    async function _createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ) {
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
        return createIndexFolder<TValueId>(
            path.join(basePath, name),
            defaultFolderSettings,
            fSys,
        );
    }
}
