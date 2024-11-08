// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sqlite from "better-sqlite3";

import {
    createFileNameGenerator,
    FileNameType,
    generateTicksString,
    generateTimestampString,
    NameValue,
    ObjectFolder,
    ObjectFolderSettings,
} from "typeagent";

export type ObjectTableRow = {
    name: string;
    text?: string | undefined;
    blob?: Buffer | undefined;
};

export function createObjectTable<T>(
    db: sqlite.Database,
    tableName: string,
    settings?: ObjectFolderSettings | undefined,
    ensureExists: boolean = true,
): ObjectFolder<T> {
    const tableSettings = settings ?? {};
    const fileNameGenerator = createNameGenerator();

    const schemaSql = `  
    CREATE TABLE IF NOT EXISTS ${tableName} (  
      name TEXT PRIMARY KEY NOT NULL,
      text TEXT,
      blob BLOB
    );`;
    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_size = db.prepare(
        `SELECT count(name) as count from ${tableName}`,
    );
    const sql_exists = db.prepare(`SELECT 1 from ${tableName} WHERE name = ?`);
    const sql_get = db.prepare(
        `SELECT text, blob FROM ${tableName} WHERE name = ?`,
    );
    const sql_getNames = db.prepare(`SELECT name FROM ${tableName}`);
    const sql_writeText = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (name, text, blob) VALUES (?, ?, NULL)`,
    );
    const sql_writeBlob = db.prepare(
        `INSERT OR REPLACE INTO ${tableName} (name, text, blob) VALUES (?, NULL, ?)`,
    );
    const sql_remove = db.prepare(`DELETE FROM ${tableName} WHERE name = ?`);
    return {
        get path() {
            return tableName;
        },
        size,
        get,
        put,
        remove,
        exists,
        all,
        allObjects,
        newest,
        clear,
        allNames,
    };

    function exists(value: string): boolean {
        const row = sql_exists.get(value);
        return row !== undefined;
    }

    function size(): Promise<number> {
        const row = sql_size.get();
        const count = row ? (row as any).count : 0;
        return Promise.resolve(count);
    }

    function get(name: string): Promise<T | undefined> {
        return Promise.resolve(readObject(name));
    }

    async function allNames(): Promise<string[]> {
        const rows = sql_getNames.iterate();
        const names: string[] = [];
        for (const row of rows) {
            names.push((row as ObjectTableRow).name);
        }
        return names;
    }

    async function* allObjects(): AsyncIterableIterator<T> {
        for await (const nv of all()) {
            yield nv.value;
        }
    }

    function all() {
        const sql_getObjects = db.prepare(`SELECT name FROM ${tableName}`);
        return asyncIterateObjects(sql_getObjects);
    }

    function newest() {
        const sql_getObjects = db.prepare(
            `SELECT name FROM ${tableName} ORDER BY name DESC`,
        );
        return asyncIterateObjects(sql_getObjects);
    }

    async function* asyncIterateObjects(
        stmt: sqlite.Statement,
    ): AsyncIterableIterator<NameValue<T>> {
        const rows = stmt.iterate();
        for (const row of rows) {
            const name = (row as ObjectTableRow).name;
            const value = readObject(name);
            if (value) {
                yield { name: name, value: value };
            }
        }
    }

    function put(
        obj: T,
        name?: string,
        onNameAssigned?: (obj: T, name: string) => void,
    ): Promise<string> {
        let objectName: string;
        if (name === undefined || name.length === 0) {
            const objFileName = fileNameGenerator.next().value;
            if (onNameAssigned) {
                onNameAssigned(obj, objFileName);
            }
            objectName = objFileName;
        } else {
            objectName = name;
        }

        writeObject(objectName, obj);
        return Promise.resolve(objectName);
    }

    async function clear(): Promise<void> {
        const sql_remove = db.prepare(`DELETE * from ${tableName}`);
        sql_remove.run();
        return Promise.resolve();
    }

    function remove(name: string): Promise<void> {
        sql_remove.run(name);
        return Promise.resolve();
    }

    function createNameGenerator() {
        const fileNameType =
            tableSettings.fileNameType ?? FileNameType.Timestamp;
        return createFileNameGenerator(
            fileNameType === FileNameType.Timestamp
                ? generateTimestampString
                : generateTicksString,
            (name: string) => {
                return !exists(name);
            },
        );
    }

    function writeObject(name: string, obj: T): void {
        const data = tableSettings.serializer
            ? tableSettings.serializer(obj)
            : JSON.stringify(obj);
        if (typeof data === "string") {
            sql_writeText.run(name, data);
        } else {
            sql_writeBlob.run(name, data);
        }
    }

    function readObject(name: string): T | undefined {
        try {
            const row = sql_get.get(name);
            if (row !== undefined) {
                const data = row as ObjectTableRow;
                if (tableSettings.deserializer) {
                    if (data.blob) {
                        return tableSettings.deserializer(data.blob);
                    }
                } else if (data.text) {
                    return JSON.parse(data.text);
                }
            }
        } catch {}
        return undefined;
    }
}
