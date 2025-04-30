// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
//import * as kpLib from "knowledge-processor";
import * as ms from "memory-storage";

export class EmailMessage implements kp.IMessage {
    constructor(
        public textChunks: string[],
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
        public metadata: kp.IMessageMetadata | undefined = undefined,
        public deletionInfo?: kp.DeletionInfo | undefined,
    ) {}

    public getKnowledge() {
        return undefined;
    }
}

export class EmailMemory implements kp.IConversation {
    public messages: kp.MessageCollection<EmailMessage>;
    public settings: kp.ConversationSettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.SemanticRef[];

    constructor(
        public nameTag: string = "",
        messages: EmailMessage[] = [],
        public tags: string[] = [],
        settings?: kp.ConversationSettings,
    ) {
        if (!settings) {
            settings = kp.createConversationSettings();
        }
        this.settings = settings;

        this.messages = new kp.MessageCollection<EmailMessage>(messages);
        this.semanticRefs = [];
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
    }
}

export class EmailDb {
    private db: any;

    constructor(dbPath: string, createNew: boolean) {
        this.db = ms.sqlite.createDatabase(dbPath, createNew);
    }

    public close() {
        if (this.db) {
            this.db.close();
        }
    }
}
