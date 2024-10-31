// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { removeDir } from "typeagent";

export type ColumnType = string | number;

export type SqlColumnType<T> = T extends string
    ? "TEXT"
    : T extends number
      ? "INTEGER"
      : never;

export type AssignedId<T> = {
    id: T;
    isNew: boolean;
};

export async function createDb(
    filePath: string,
    createNew: boolean,
): Promise<sqlite.Database> {
    if (createNew) {
        await removeDir(filePath);
    }
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");
    return db;
}

export function tablePath(rootName: string, name: string): string {
    return rootName + "_" + name;
}
