// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as ms from "memory-storage";
import { EmailMessage, EmailMessageSerializer } from "./emailMessage.js";
import {
    createMemorySettings,
    IndexingState,
    MemorySettings,
} from "./memory.js";
import { createIndexingState, getIndexingErrors } from "./common.js";
import { Result, success, error } from "typechat";

export type EmailMemorySettings = MemorySettings;

export interface EmailMemoryData
    extends kp.IConversationDataWithIndexes<EmailMessage> {
    indexingState: IndexingState;
}

export class EmailMemory implements kp.IConversation {
    public messages: kp.IMessageCollection<EmailMessage>;
    public settings: EmailMemorySettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.SemanticRef[];
    public serializer: EmailMessageSerializer;
    public indexingState: IndexingState;

    constructor(
        public storageProvider: kp.IStorageProvider,
        public nameTag: string = "",
        public tags: string[] = [],
        settings?: EmailMemorySettings,
    ) {
        if (!settings) {
            settings = this.createSettings();
        }
        this.settings = settings;
        this.serializer = new EmailMessageSerializer();
        this.indexingState = createIndexingState();
        this.messages = storageProvider.createMessageCollection<EmailMessage>(
            this.serializer,
        );
        this.semanticRefs = [];
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
    }

    public async addMessage(
        message: EmailMessage,
    ): Promise<Result<kp.IndexingResults>> {
        // Add the message to memory and index it
        this.messages.append(message);
        const result = await kp.addToConversationIndex(
            this,
            this.settings.conversationSettings,
            this.messages.length - 1,
            this.semanticRefs.length,
        );
        const errorMsg = getIndexingErrors(result);
        if (errorMsg) {
            return error(errorMsg);
        }
        this.updateIndexingState();
        return success(result);
    }

    public async serialize(): Promise<EmailMemoryData> {
        const data: EmailMemoryData = {
            indexingState: this.indexingState,
            nameTag: this.nameTag,
            messages: [],
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
        };
        return data;
    }

    public async deserialize(emailData: EmailMemoryData): Promise<void> {
        this.indexingState = emailData.indexingState;
        this.nameTag = emailData.nameTag;
        this.semanticRefs = emailData.semanticRefs;
        this.tags = emailData.tags;
        if (emailData.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                emailData.semanticIndexData,
            );
        }
        if (emailData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                emailData.relatedTermsIndexData,
            );
        }
        if (emailData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.conversationSettings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                emailData.messageIndexData,
            );
        }
    }

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await kp.writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
        storageProvider?: kp.IStorageProvider,
    ): Promise<EmailMemory | undefined> {
        storageProvider ??= ms.sqlite.createSqlStorageProvider(
            dirPath,
            baseFileName,
            false,
        );
        const memory = new EmailMemory(storageProvider);
        const data = (await kp.readConversationDataFromFile(
            dirPath,
            baseFileName,
            memory.settings.conversationSettings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        )) as EmailMemoryData;
        if (data) {
            memory.deserialize(data);
        }
        return memory;
    }

    public close() {
        if (this.storageProvider) {
            this.storageProvider.close();
        }
    }

    private createSettings(): EmailMemorySettings {
        return createMemorySettings(
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );
    }

    private updateIndexingState(): void {
        this.indexingState.lastMessageOrdinal = this.messages.length - 1;
        this.indexingState.lastSemanticRefOrdinal =
            this.semanticRefs.length - 1;
    }
}

export function createEmailMemory(
    dirPath: string,
    baseFileName: string,
    createNew: boolean,
): EmailMemory {
    const db = ms.sqlite.createSqlStorageProvider(
        dirPath,
        baseFileName,
        createNew,
    );
    return new EmailMemory(db, baseFileName);
}
