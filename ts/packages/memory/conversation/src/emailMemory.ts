// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
//import * as kpLib from "knowledge-processor";
import * as ms from "memory-storage";
import { EmailMessage } from "./emailMessage.js";

export class EmailMemory implements kp.IConversation {
    public messages: kp.IMessageCollection<EmailMessage>;
    public settings: kp.ConversationSettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.SemanticRef[];

    constructor(
        public storageProvider: kp.IStorageProvider,
        public nameTag: string = "",
        public tags: string[] = [],
        settings?: kp.ConversationSettings,
    ) {
        if (!settings) {
            settings = kp.createConversationSettings();
        }
        this.settings = settings;

        (this.messages =
            storageProvider.createMessageCollection<EmailMessage>()),
            (this.semanticRefs = []);
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }

    public close() {
        if (this.storageProvider) {
            this.storageProvider.close();
        }
    }
}

export class EmailSqliteProvider {
    public dbProvider: ms.sqlite.SqliteStorageProvider;

    constructor(dbPath: string, createNew: boolean) {
        this.dbProvider = new ms.sqlite.SqliteStorageProvider(
            dbPath,
            createNew,
        );
    }

    public close() {
        if (this.dbProvider) {
            this.dbProvider.close();
        }
    }
}

export function createEmailMemoryOnDb(
    dbPath: string,
    createNew: boolean,
): EmailMemory {
    const db = new ms.sqlite.SqliteStorageProvider(dbPath, createNew);
    return new EmailMemory(db);
}
