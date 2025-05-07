// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as ms from "memory-storage";
import { EmailMessage, EmailMessageSerializer } from "./emailMessage.js";
import {
    addSynonymsFileAsAliases,
    createMemorySettings,
    IndexFileSettings,
    IndexingState,
    Memory,
    MemorySettings,
} from "./memory.js";
import { createIndexingState, getIndexingErrors } from "./common.js";
import { Result, success, error } from "typechat";

export interface EmailMemorySettings extends MemorySettings {
    userProfile?: EmailUserProfile | undefined;
}

export interface EmailUserProfile {
    userName: string;
    emailAlias: string;
}

export interface EmailMemoryData
    extends kp.IConversationDataWithIndexes<EmailMessage> {
    indexingState: IndexingState;
}

export class EmailMemory
    extends Memory<EmailMemorySettings>
    implements kp.IConversation
{
    public messages: kp.IMessageCollection<EmailMessage>;
    public settings: EmailMemorySettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.ISemanticRefCollection;
    public serializer: EmailMessageSerializer;
    public indexingState: IndexingState;

    constructor(
        public storageProvider: ms.sqlite.SqliteStorageProvider,
        public nameTag: string = "",
        public tags: string[] = [],
        settings?: EmailMemorySettings,
    ) {
        super();
        if (!settings) {
            settings = this.createSettings();
        }
        this.settings = settings;
        this.serializer = new EmailMessageSerializer();
        this.indexingState = createIndexingState();
        this.messages = storageProvider.createMessageCollection<EmailMessage>(
            this.serializer,
        );
        this.semanticRefs = storageProvider.createSemanticRefCollection();
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
        this.updateStaticAliases();
    }

    /**
     * Add email messages. If updateIndex is true, also index them.
     * @param messages
     * @param updateIndex (default) true
     * @param eventHandler
     * @returns
     */
    public async addMessages(
        messages: EmailMessage | EmailMessage[],
        updateIndex: boolean = true,
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<Result<IndexingState>> {
        if (Array.isArray(messages)) {
            for (const message of messages) {
                this.messages.append(message);
            }
        } else {
            this.messages.append(messages);
        }
        if (updateIndex) {
            return this.buildIndex(eventHandler);
        }
        return success(this.indexingState);
    }

    /**
     * Indexing all pending messages.
     * Resumes at this.indexingState.lastMessageOrdinal + 1
     * @param eventHandler
     * @param autoSave (default true) Automatically save the updated index
     * @returns
     */
    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
        autoSave: boolean = true,
    ): Promise<Result<IndexingState>> {
        const messageOrdinalStartAt = this.indexingState.lastMessageOrdinal + 1;
        if (messageOrdinalStartAt < this.messages.length) {
            const result = await kp.addToConversationIndex(
                this,
                this.settings.conversationSettings,
                messageOrdinalStartAt,
                this.semanticRefs.length,
                eventHandler,
            );
            const errorMsg = getIndexingErrors(result);
            if (errorMsg) {
                return error(errorMsg);
            }
            this.updateIndexingState();
            if (autoSave) {
                await this.writeToFile(this.settings.fileSaveSettings);
            }
        }
        return success(this.indexingState);
    }

    public async serialize(): Promise<EmailMemoryData> {
        const data: EmailMemoryData = {
            indexingState: this.indexingState,
            nameTag: this.nameTag,
            messages: [],
            tags: this.tags,
            semanticRefs: [],
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
        // Rebuild transient secondary indexes associated with the conversation
        await kp.buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
        this.updateStaticAliases();
    }

    public async writeToFile(
        fileSaveSettings?: IndexFileSettings,
    ): Promise<void> {
        fileSaveSettings ??= this.settings.fileSaveSettings;
        if (!fileSaveSettings) {
            throw new Error("No file save settings provided");
        }
        const data = await this.serialize();
        await kp.writeConversationDataToFile(
            data,
            fileSaveSettings.dirPath,
            fileSaveSettings.baseFileName,
        );
    }

    public static async readFromFile(
        fileSettings: IndexFileSettings,
    ): Promise<EmailMemory | undefined> {
        const storageProvider = ms.sqlite.createSqlStorageProvider(
            fileSettings.dirPath,
            fileSettings.baseFileName,
            false,
        );
        const memory = new EmailMemory(storageProvider);
        memory.settings.fileSaveSettings = fileSettings;
        const data = (await kp.readConversationDataFromFile(
            fileSettings.dirPath,
            fileSettings.baseFileName,
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

    private updateStaticAliases() {
        this.addVerbAliases();
    }

    private addVerbAliases() {
        const aliases = this.secondaryIndexes.termToRelatedTermsIndex.aliases;
        addSynonymsFileAsAliases(
            aliases,
            ms.getAbsolutePathFromUrl(import.meta.url, "emailVerbs.json"),
        );
    }
}

export async function createEmailMemory(
    fileSettings: IndexFileSettings,
    createNew: boolean,
): Promise<EmailMemory> {
    let em: EmailMemory | undefined;
    if (createNew) {
        await kp.removeConversationData(
            fileSettings.dirPath,
            fileSettings.baseFileName,
        );
    } else {
        em = await EmailMemory.readFromFile(fileSettings);
    }
    if (!em) {
        const db = ms.sqlite.createSqlStorageProvider(
            fileSettings.dirPath,
            fileSettings.baseFileName,
            true,
        );
        em = new EmailMemory(db);
    }
    em.settings.fileSaveSettings = fileSettings;
    return em;
}
