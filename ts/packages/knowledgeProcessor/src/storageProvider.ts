// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileSystem, ObjectFolderSettings } from "typeagent";
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
    createTextIndex<TSourceId extends ValueType>(
        settings: TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: ValueDataType<TSourceId>,
    ): Promise<TextIndex<string, TSourceId>>;
}

export function createFileSystemProvider(
    folderSettings?: ObjectFolderSettings,
    fSys?: FileSystem | undefined,
): StorageProvider {
    return {
        createTextIndex: _createTextIndex,
    };

    async function _createTextIndex<TSourceId extends ValueType>(
        settings: TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: ValueDataType<TSourceId>,
    ): Promise<TextIndex<string, TSourceId>> {
        return createTextIndex<TSourceId>(
            settings,
            path.join(basePath, name),
            folderSettings,
            fSys,
        );
    }
}
