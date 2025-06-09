// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as ms from "memory-storage";
import { WebsiteMessage, WebsiteMessageSerializer } from "./websiteMessage.js";
import { Result, success, error, PromptSection } from "typechat";

export interface WebsiteMemorySettings {
    languageModel: any;
    embeddingModel: any;
    embeddingSize: number;
    conversationSettings: kp.ConversationSettings;
    queryTranslator?: kp.SearchQueryTranslator | undefined;
    answerGenerator?: kp.IAnswerGenerator | undefined;
    fileSaveSettings?: IndexFileSettings | undefined;
    userProfile?: WebsiteUserProfile | undefined;
}

export interface WebsiteUserProfile {
    userName: string;
    preferredDomains?: string[];
    interests?: string[];
}

export interface IndexFileSettings {
    dirPath: string;
    baseFileName: string;
}

export type IndexingState = {
    lastMessageOrdinal: kp.MessageOrdinal;
    lastSemanticRefOrdinal: kp.SemanticRefOrdinal;
};

export interface WebsiteMemoryData
    extends kp.IConversationDataWithIndexes<WebsiteMessage> {
    indexingState: IndexingState;
}

function createIndexingState(): IndexingState {
    return {
        lastMessageOrdinal: -1,
        lastSemanticRefOrdinal: -1,
    };
}

/**
 * A memory containing Website Visit Messages {@link WebsiteMessage}
 */
export class WebsiteMemory implements kp.IConversation {
    public messages: kp.IMessageCollection<WebsiteMessage>;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public semanticRefs: kp.ISemanticRefCollection;
    public serializer: WebsiteMessageSerializer;
    public indexingState: IndexingState;
    public nameTag: string = "";
    public tags: string[] = [];
    
    private noiseTerms: Set<string> = new Set();

    constructor(
        public storageProvider: ms.sqlite.SqliteStorageProvider,
        public settings: WebsiteMemorySettings,
    ) {
        this.serializer = new WebsiteMessageSerializer();
        this.indexingState = createIndexingState();
        this.messages = storageProvider.createMessageCollection<WebsiteMessage>(
            this.serializer,
        );
        this.semanticRefs = storageProvider.createSemanticRefCollection();
        this.semanticRefIndex = new kp.ConversationIndex();
        
        // Create minimal but valid conversation settings 
        if (!this.settings.conversationSettings) {
            this.settings.conversationSettings = {
                semanticRefIndexSettings: {
                    autoExtractKnowledge: true,
                },
                relatedTermIndexSettings: {
                    embeddingIndexSettings: {
                        embeddingSize: this.settings.embeddingSize || 1536,
                    },
                },
                messageTextIndexSettings: {
                    embeddingIndexSettings: {
                        embeddingSize: this.settings.embeddingSize || 1536,
                    },
                },
            } as any;
        }
        
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
        this.updateStaticMaps();
    }

    public get conversation(): kp.IConversation<WebsiteMessage> {
        return this;
    }

    /**
     * Add website visit messages. If updateIndex is true, also index them.
     */
    public async addMessages(
        messages: WebsiteMessage | WebsiteMessage[],
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
     */
    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
        autoSave: boolean = true,
    ): Promise<Result<IndexingState>> {
        try {
            this.beginIndexing();

            const messageOrdinalStartAt =
                this.indexingState.lastMessageOrdinal + 1;
            if (messageOrdinalStartAt < this.messages.length) {
                const result = await kp.addToConversationIndex(
                    this,
                    this.settings.conversationSettings,
                    messageOrdinalStartAt,
                    this.semanticRefs.length,
                    eventHandler,
                );
                const errorMsg = this.getIndexingErrors(result);
                if (errorMsg) {
                    return error(errorMsg);
                }
                this.updateIndexingState();
                if (autoSave) {
                    await this.writeToFile(this.settings.fileSaveSettings);
                }
            }
            return success(this.indexingState);
        } finally {
            this.endIndexing();
        }
    }

    public async serialize(): Promise<WebsiteMemoryData> {
        const data: WebsiteMemoryData = {
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

    public async deserialize(websiteData: WebsiteMemoryData): Promise<void> {
        this.indexingState = websiteData.indexingState;
        this.nameTag = websiteData.nameTag;
        this.tags = websiteData.tags;
        if (websiteData.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                websiteData.semanticIndexData,
            );
        }
        if (websiteData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                websiteData.relatedTermsIndexData,
            );
        }
        if (websiteData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.conversationSettings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                websiteData.messageIndexData,
            );
        }
        // Rebuild transient secondary indexes associated with the conversation
        await kp.buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
        this.updateStaticMaps();
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
        settings: WebsiteMemorySettings,
    ): Promise<WebsiteMemory | undefined> {
        const storageProvider = ms.sqlite.createSqlStorageProvider(
            fileSettings.dirPath,
            fileSettings.baseFileName,
            false,
        );
        const memory = new WebsiteMemory(storageProvider, settings);
        memory.settings.fileSaveSettings = fileSettings;
        const data = (await kp.readConversationDataFromFile(
            fileSettings.dirPath,
            fileSettings.baseFileName,
            memory.settings.conversationSettings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        )) as WebsiteMemoryData;
        if (data) {
            await memory.deserialize(data);
        }
        return memory;
    }

    public close() {
        if (this.storageProvider) {
            this.storageProvider.close();
        }
    }

    public getModelInstructions(): PromptSection[] | undefined {
        if (this.settings.userProfile) {
            const instructions: PromptSection[] = [
                {
                    role: "system",
                    content: `You are answering requests about website visits belonging to:\n'''${JSON.stringify(this.settings.userProfile)}\n'''`,
                },
            ];
            return instructions;
        }
        return undefined;
    }

    private beginIndexing(): void {
        if (this.semanticRefIndex === undefined) {
            this.semanticRefIndex = new kp.ConversationIndex();
        }
        if (this.semanticRefs === undefined) {
            this.semanticRefs = this.storageProvider.createSemanticRefCollection();
        }
    }

    private endIndexing(): void {
        // Nothing to do for now
    }

    private updateIndexingState(): void {
        this.indexingState.lastMessageOrdinal = this.messages.length - 1;
        this.indexingState.lastSemanticRefOrdinal =
            this.semanticRefs.length - 1;
    }

    private updateStaticMaps() {
        this.addVerbAliases();

        this.noiseTerms.add("website");
        this.noiseTerms.add("page");
        this.noiseTerms.add("site");
        this.noiseTerms.add("url");
        this.noiseTerms.add("link");
    }

    private addVerbAliases() {
        // Add verb aliases if needed
    }

    private getIndexingErrors(result: any): string | undefined {
        // Simple error handling - in real implementation would be more sophisticated
        return undefined;
    }
}

export function createWebsiteMemorySettings(
    languageModel?: any,
    embeddingModel?: any,
    embeddingSize?: number,
): WebsiteMemorySettings {
    // Use provided models or create defaults
    const langModel = languageModel || null;
    const embedModel = embeddingModel || null;
    const embedSize = embeddingSize || 1536;
    
    let conversationSettings: any = null;
    
    // Only create conversation settings if we have valid models
    if (langModel && embedModel) {
        conversationSettings = kp.createConversationSettings(embedModel, embedSize);
        conversationSettings.semanticRefIndexSettings.knowledgeExtractor =
            kp.createKnowledgeExtractor(langModel);
    }
    
    const settings: WebsiteMemorySettings = {
        languageModel: langModel,
        embeddingModel: embedModel,
        embeddingSize: embedSize,
        conversationSettings: conversationSettings,
    };
    return settings;
}

export async function createWebsiteMemory(
    fileSettings: IndexFileSettings,
    createNew: boolean,
    knowledgeModel?: any,
    queryTranslator?: kp.SearchQueryTranslator,
    answerGenerator?: kp.IAnswerGenerator,
): Promise<WebsiteMemory> {
    let wm: WebsiteMemory | undefined;
    if (createNew) {
        await kp.removeConversationData(
            fileSettings.dirPath,
            fileSettings.baseFileName,
        );
    } else {
        // For now, skip trying to read existing file and always create new
        // const settings = createWebsiteMemorySettings(knowledgeModel);
        // wm = await WebsiteMemory.readFromFile(fileSettings, settings);
    }
    if (!wm) {
        const db = ms.sqlite.createSqlStorageProvider(
            fileSettings.dirPath,
            fileSettings.baseFileName,
            true,
        );
        
        // Create settings with the provided models
        const settings = createWebsiteMemorySettings(knowledgeModel);
        if (queryTranslator) settings.queryTranslator = queryTranslator;
        if (answerGenerator) settings.answerGenerator = answerGenerator;
        
        wm = new WebsiteMemory(db, settings);
    }
    wm.settings.fileSaveSettings = fileSettings;
    return wm;
}
