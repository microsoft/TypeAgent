// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as sqlite from "better-sqlite3";
import { SqliteCollection } from "./sqliteCollection.js";
import { createDatabase } from "./sqliteCommon.js";
import { SqliteDataFrame } from "./sqliteDataFrame.js";

export class SqlMessageCollection<TMessage extends kp.IMessage = kp.IMessage>
    extends SqliteCollection<TMessage, kp.MessageOrdinal>
    implements kp.IMessageCollection<TMessage>
{
    constructor(
        db: sqlite.Database,
        serializer?: kp.JsonSerializer<TMessage>,
        tableName: string = "messages",
        ensureExists: boolean = true,
    ) {
        super(db, serializer, tableName, ensureExists);
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
        super(db, undefined, tableName, ensureExists);
    }
}

export class SqliteStorageProvider
    implements kp.IStorageProvider, kp.dataFrame.IDataFrameStorageProvider
{
    private db: sqlite.Database;

    constructor(dbPath: string, createNew: boolean) {
        this.db = createDatabase(dbPath, createNew);
    }

    public createMessageCollection<TMessage extends kp.IMessage = kp.IMessage>(
        serializer?: kp.JsonSerializer<TMessage>,
    ): kp.IMessageCollection<TMessage> {
        return new SqlMessageCollection(this.db, serializer);
    }

    public createSemanticRefCollection(): kp.ISemanticRefCollection {
        return new SqlSemanticRefCollection(this.db);
    }

    public createDataFrame(
        name: string,
        columns:
            | kp.dataFrame.DataFrameColumns
            | [string, kp.dataFrame.DataFrameColumnDef][],
    ): kp.dataFrame.IDataFrame {
        return new SqliteDataFrame(this.db, name, columns);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}
