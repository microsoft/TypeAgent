// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import * as kp from "knowpro";
import {
    createMemorySettings,
    Memory,
    MemorySettings,
    Message,
    MessageMetadata,
} from "./memory.js";
import { TypeChatLanguageModel } from "typechat";
import { fileURLToPath } from "url";
import { importDocMemoryFromTextFile } from "./docImport.js";
import { ChatModel } from "aiclient";

export class DocPartMeta extends MessageMetadata {
    constructor(public sourceUrl?: string | undefined) {
        super();
    }
}

/**
 * A document contains document parts
 * A DocPart is a {@link Message} that can be added to a {@link DocMemory}
 */
export class DocPart extends Message<DocPartMeta> {
    /**
     * See {@link Message} for parameter/property descriptions
     */
    constructor(
        textChunks: string | string[] = [],
        metadata?: DocPartMeta | undefined,
        tags?: kp.MessageTag[] | undefined,
        timestamp?: string | undefined,
        knowledge?: kpLib.conversation.KnowledgeResponse | undefined,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        metadata ??= new DocPartMeta();
        tags ??= [];
        super(metadata, textChunks, tags, timestamp, knowledge, deletionInfo);
    }
}

/**
 * The state of indexing a document.
 * Captured state that allows the document to be indexed incrementally.
 * Can also capture state the allows indexing to resume in case of failure.
 *
 * This object should typically be opaque to the caller, but is useful for displaying status etc.
 */
export interface DocIndexingState {
    lastMessageOrdinal: number;
    lastSemanticRefOrdinal: number;
    lastIndexed: Date;
}

export interface DocMemorySettings extends MemorySettings {}

export function createDocMemorySettings(
    embeddingCacheSize = 64,
    getPersistentCache?: () => kpLib.TextEmbeddingCache | undefined,
    languageModel?: ChatModel,
): DocMemorySettings {
    const settings: DocMemorySettings = createMemorySettings(
        embeddingCacheSize,
        getPersistentCache,
        languageModel,
    );
    settings.useScopedSearch = true;
    return settings;
}

/**
 * A DocMemory is a collection of {@link DocPart}.
 * You can search document memories and generate answers using:
 * - using natural language queries
 * - Query expressions
 *
 * Indexing:
 * You must call {@link buildIndex} to enable query operations.
 * You call {@link writeToFile} to persist the memory and any indexes created by buildIndex.
 * Alternatively, you can incrementally and and index a new DocPart by calling {@link addDocPartToIndex}
 *
 * Doc memories are mutable.
 *
 * You can import text files like .vtt, .html, .md etc as DocMemories using the {@link importDocMemoryFromTextFile} function
 *
 * @see Memory base class for APIs
 * @see DocPart
 */
export class DocMemory
    extends Memory<DocMemorySettings, DocPart>
    implements kp.IConversation
{
    public messages: kp.MessageCollection<DocPart>;
    public semanticRefs: kp.SemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    public indexingState: DocIndexingState;

    constructor(
        nameTag: string = "",
        docParts: DocPart[] = [],
        settings?: DocMemorySettings,
        tags?: string[],
    ) {
        settings ??= createDocMemorySettings();
        if (!settings.embeddingModel.getPersistentCache) {
            settings.embeddingModel.getPersistentCache = () =>
                this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex;
        }
        super(settings, nameTag, tags);
        this.messages = new kp.MessageCollection<DocPart>(docParts);
        this.semanticRefs = new kp.SemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
        this.indexingState = {
            lastMessageOrdinal: -1,
            lastSemanticRefOrdinal: -1,
            lastIndexed: new Date(),
        };
        // Customize the search query translator for scoped queries
        customizeScopeQueryProcessing(
            this.settings.queryTranslator!,
            this.settings.languageModel,
        );
    }

    public override get conversation(): kp.IConversation<DocPart> {
        return this;
    }

    /**
     * Build a new index for this document memory. The index uses all available document parts
     * @param {kp.IndexingEventHandlers} eventHandler
     * @returns
     */
    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            const result = await kp.buildConversationIndex(
                this,
                this.settings.conversationSettings,
                eventHandler,
            );
            this.updateIndexingState();
            return result;
        } finally {
            this.endIndexing();
        }
    }

    /**
     * Index any new document parts added to the memory.
     * You can also use this method to resume indexing in case of failure.
     * @param {kp.IndexingEventHandlers} eventHandler
     * @returns {IndexingState} How much progress was made during indexing. Sometimes, network or LLM errors
     * will cause indexing to pause and return indexing state.
     */
    public async addToIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
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
                this.updateIndexingState();
                return result;
            }
            return {};
        } finally {
            this.endIndexing();
        }
    }

    /**
     * Add a new DocPart this memory and update the index.
     * Use for incrementally adding to this document
     * @param docPart
     * @param {kp.IndexingEventHandlers} eventHandler
     * @returns
     */
    public async addDocPartToIndex(
        docPart: DocPart,
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            this.messages.append(docPart);
            const messageOrdinal = this.messages.length - 1;

            const result = await kp.addToConversationIndex(
                this,
                this.settings.conversationSettings,
                messageOrdinal,
                this.semanticRefs.length,
                eventHandler,
            );
            this.updateIndexingState();
            return result;
        } finally {
            this.endIndexing();
        }
    }

    /**
     * If a document part changed, will dynamically update the index to reflect the new document part
     * @param messageOrdinal
     * @param updatedItem
     * @param eventHandler
     * @returns
     */
    public async updateItemInIndex(
        messageOrdinal: number,
        updatedItem: DocPart,
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            this.removeSemanticRefsForMessage(messageOrdinal);
            (this.messages as any).items[messageOrdinal] = updatedItem;

            const result = await kp.addToConversationIndex(
                this,
                this.settings.conversationSettings,
                messageOrdinal,
                this.semanticRefs.length,
                eventHandler,
            );
            this.updateIndexingState();
            return result;
        } finally {
            this.endIndexing();
        }
    }

    private removeSemanticRefsForMessage(messageOrdinal: number): void {
        if (!this.semanticRefs || !this.semanticRefIndex) return;

        const refsToRemove: number[] = [];
        for (let i = 0; i < this.semanticRefs.length; i++) {
            const ref = this.semanticRefs.get(i);
            if (ref.range.start.messageOrdinal === messageOrdinal) {
                refsToRemove.push(i);
            }
        }

        refsToRemove.reverse().forEach((refIndex) => {
            const ref = this.semanticRefs.get(refIndex);
            this.removeSemanticRefFromIndex(ref, refIndex);
        });

        const items = (this.semanticRefs as any).items;
        refsToRemove.reverse().forEach((refIndex) => {
            items.splice(refIndex, 1);
        });
    }

    private removeSemanticRefFromIndex(ref: any, refIndex: number): void {
        if (!this.semanticRefIndex) return;

        const knowledge = ref.knowledge;
        if (knowledge) {
            if (knowledge.name) {
                this.semanticRefIndex.removeTerm(knowledge.name, refIndex);
            }
            if (knowledge.type) {
                const types = Array.isArray(knowledge.type)
                    ? knowledge.type
                    : [knowledge.type];
                types.forEach((type: string) => {
                    this.semanticRefIndex.removeTerm(type, refIndex);
                });
            }
            if (knowledge.text) {
                this.semanticRefIndex.removeTerm(knowledge.text, refIndex);
            }
        }
    }

    private updateIndexingState(): void {
        this.indexingState.lastMessageOrdinal = this.messages.length - 1;
        this.indexingState.lastSemanticRefOrdinal =
            this.semanticRefs.length - 1;
        this.indexingState.lastIndexed = new Date();
    }

    /**
     * Serialize the memory into a transferable JSON blob
     * @returns
     */
    public async serialize(): Promise<DocMemoryData> {
        const data: DocMemoryData = {
            nameTag: this.nameTag,
            messages: this.messages.getAll(),
            tags: this.tags,
            semanticRefs: this.semanticRefs.getAll(),
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
            indexingState: this.indexingState,
        };
        return data;
    }

    /**
     * Deserialize memory from a JSON blob
     * @param docMemoryData
     */
    public async deserialize(docMemoryData: DocMemoryData): Promise<void> {
        this.nameTag = docMemoryData.nameTag;
        const docParts = docMemoryData.messages.map((m) => {
            return docPartClassFromJsonObj(m);
        });
        this.messages = new kp.MessageCollection<DocPart>(docParts);
        this.semanticRefs = new kp.SemanticRefCollection(
            docMemoryData.semanticRefs,
        );
        this.tags = docMemoryData.tags;
        if (docMemoryData.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                docMemoryData.semanticIndexData,
            );
        }
        if (docMemoryData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                docMemoryData.relatedTermsIndexData,
            );
        }
        if (docMemoryData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.conversationSettings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                docMemoryData.messageIndexData,
            );
        }

        if (docMemoryData.indexingState) {
            this.indexingState = {
                ...docMemoryData.indexingState,
                lastIndexed: new Date(docMemoryData.indexingState.lastIndexed),
            };
        } else {
            this.indexingState = {
                lastMessageOrdinal: this.messages.length - 1,
                lastSemanticRefOrdinal: this.semanticRefs.length - 1,
                lastIndexed: new Date(),
            };
        }

        await kp.buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
    }

    /**
     * Write this Document memory and its indexes to files.
     * Uses the 2 file format for knowpro: a JSON data file and an embeddings file
     * @param dirPath Directory to write memory files
     * @param baseFileName Base filename to use for memory files
     */
    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await kp.writeConversationDataToFile(data, dirPath, baseFileName);
    }

    /**
     * Read this memory from files.
     * The files must have been written using {@link writeToFile}
     * @param dirPath Directory that contains memory files
     * @param baseFileName Base filename for memory files
     * @param settings
     * @returns
     */
    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
        settings?: DocMemorySettings,
    ): Promise<DocMemory | undefined> {
        const docMemory = new DocMemory(undefined, undefined, settings);
        const data = await kp.readConversationDataFromFile(
            dirPath,
            baseFileName,
            docMemory.settings.conversationSettings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        );
        if (data) {
            docMemory.deserialize(data);
        }
        return docMemory;
    }

    /**
     * Import a text file as a document memory
     * Supported formats:
     *   .vtt
     *   .md
     *   .html/htm
     *   .txt
     * @param docFilePath
     * @param maxCharsPerChunk
     * @param docName
     * @param settings
     * @returns
     */
    public async importFromTextFile(
        docFilePath: string,
        maxCharsPerChunk: number,
        docName?: string,
        settings?: DocMemorySettings,
    ) {
        return importDocMemoryFromTextFile(docFilePath, maxCharsPerChunk);
    }
}

export interface DocMemoryData
    extends kp.IConversationDataWithIndexes<DocPart> {
    indexingState?: DocIndexingState;
}

export class DocPartSerializer implements kp.JsonSerializer<DocPart> {
    public serialize(value: DocPart): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): DocPart {
        const jMsg: DocPart = JSON.parse(json);
        return docPartClassFromJsonObj(jMsg);
    }
}

/**
 * Documents contain additional entity types like sections, parts, tables, lists.
 * To allow the LLM to translate NL queries featuring these, we must add some additional comments
 * and few shot examples in the query schema. We do this by using a custom schema file that
 * implements the same interfaces but adds more comments
 * @param searchQueryTranslator
 * @param languageModel
 */
function customizeScopeQueryProcessing(
    searchQueryTranslator: kp.SearchQueryTranslator,
    languageModel: TypeChatLanguageModel,
) {
    // Customize the search query translator for scoped queries
    const customScopeTranslator =
        kp.createSearchQueryJsonTranslator<kp.querySchema2.SearchQuery>(
            languageModel,
            fileURLToPath(new URL("docSearchQuerySchema.ts", import.meta.url)),
        );
    searchQueryTranslator!.translate2 = (request, preamble) => {
        return customScopeTranslator.translate(request, preamble);
    };
}

/**
 * DocPart is a class, and JSON deserialization does not restore it
 * @param jMsg
 * @returns
 */
function docPartClassFromJsonObj(jMsg: DocPart): DocPart {
    const jMeta: DocPartMeta = jMsg.metadata;
    const part = new DocPart(
        jMsg.textChunks,
        jMeta,
        jMsg.tags,
        jMsg.timestamp,
        jMsg.knowledge,
        jMsg.deletionInfo,
    );
    return part;
}
