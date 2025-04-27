// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { ValueDataType, ValueType } from "knowledge-processor";
import { removeFile } from "typeagent";
import { createRequire } from "node:module";
import path from "node:path";
export type AssignedId<T> = {
    id: T;
    isNew: boolean;
};

export type BooleanRow = {};

function getDbOptions() {
    if (process?.versions?.electron !== undefined) {
        return undefined;
    }
    const r = createRequire(import.meta.url);
    const betterSqlitePath = r.resolve("better-sqlite3/package.json");
    const nativeBinding = path.join(
        betterSqlitePath,
        "../build/Release-Node/better_sqlite3.node",
    );
    return { nativeBinding };
}

export async function createDatabase(
    filePath: string,
    createNew: boolean,
): Promise<sqlite.Database> {
    if (createNew) {
        await deleteDatabase(filePath);
    }
    const db = new Database(filePath, getDbOptions());
    db.pragma("journal_mode = WAL");
    return db;
}

export async function deleteDatabase(filePath: string): Promise<void> {
    await removeFile(filePath);
    await removeFile(filePath + "-shm");
    await removeFile(filePath + "-wal");
}

export function tablePath(rootName: string, name: string): string {
    return rootName + "_" + name;
}

export function sql_makeInClause(values: any[]): string {
    let sql = "";
    for (let i = 0; i < values.length; ++i) {
        if (i > 0) {
            sql += ", ";
        }
        sql += `'${values[i]}'`;
    }
    return sql;
}

export type ColumnSerializer = {
    serialize: (x: any) => any;
    deserialize: (x: any) => any;
};

export function getTypeSerializer<T extends ValueType>(
    type: ValueDataType<T>,
): [boolean, ColumnSerializer] {
    const isIdInt = type === "INTEGER";
    const serializer: ColumnSerializer = {
        serialize: isIdInt
            ? (x: any) => x
            : (x: any) => (x ? x.toString() : undefined),
        deserialize: isIdInt ? (x: any) => x : (x: any) => Number.parseInt(x),
    };
    return [isIdInt, serializer];
}
