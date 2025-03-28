// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as sqlite from "better-sqlite3";
import { SqliteCollection } from "./sqliteCollection.js";
import { createDatabase } from "./sqliteCommon.js";
import path from "path";

export class SqlMessageCollection<TMessage extends kp.IMessage = kp.IMessage>
    extends SqliteCollection<TMessage, kp.MessageOrdinal>
    implements kp.IMessageCollection<TMessage>
{
    constructor(
        db: sqlite.Database,
        tableName: string = "messages",
        ensureExists: boolean = true,
    ) {
        super(db, tableName, ensureExists);
    }
}

export class SqlSemanticRefCollection
    extends SqliteCollection<kp.SemanticRef, kp.SemanticRefOrdinal>
    implements kp.ISemanticRefCollection
{
    constructor(
        db: sqlite.Database,
        tableName: string = "semanticRefs",
        ensureExists: boolean = true,
    ) {
        super(db, tableName, ensureExists);
    }
}

export class SqliteStorageProvider implements kp.IStorageProvider {
    private db: sqlite.Database;

    constructor(rootPath: string, name: string, createNew: boolean) {
        const dbPath = path.join(rootPath, name);
        this.db = createDatabase(dbPath, createNew);
    }

    public createMessageCollection<
        TMessage extends kp.IMessage = kp.IMessage,
    >(): kp.IMessageCollection<TMessage> {
        return new SqlMessageCollection(this.db);
    }

    public createSemanticRefCollection(): kp.ISemanticRefCollection {
        return new SqlSemanticRefCollection(this.db);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}
