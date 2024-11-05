// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createObjectFolder,
    FileSystem,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";
import {
    createTextIndex,
    TextIndex,
    TextIndexSettings,
} from "./knowledgeIndex.js";
import path from "path";

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
    createTextIndex<TSourceId extends ValueType>(
        settings: TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: ValueDataType<TSourceId>,
    ): Promise<TextIndex<string, TSourceId>>;
}

export function createFileSystemProvider(
    defaultFolderSettings?: ObjectFolderSettings,
    fSys?: FileSystem | undefined,
): StorageProvider {
    return {
        createObjectFolder: _createObjectFolder,
        createTextIndex: _createTextIndex,
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
}
