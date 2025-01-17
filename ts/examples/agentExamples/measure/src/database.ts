// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import Database, * as sqlite from "better-sqlite3";
import { removeFile } from "typeagent";

export async function createDatabase(
    filePath: string,
    createNew: boolean,
): Promise<sqlite.Database> {
    if (createNew) {
        await deleteDatabase(filePath);
    }
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");
    return db;
}

async function deleteDatabase(filePath: string): Promise<void> {
    await removeFile(filePath);
    await removeFile(filePath + "-shm");
    await removeFile(filePath + "-wal");
}
