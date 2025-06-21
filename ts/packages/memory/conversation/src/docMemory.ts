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

export class DocPartMeta extends MessageMetadata {
    constructor(public sourceUrl?: string | undefined) {
        super();
    }
}

/**
 * A part of a document.
 * Use tags to annotate headings, etc.
 */
export class DocPart extends Message<DocPartMeta> {
    constructor(
        textChunks: string | string[] = [],
        metadata?: DocPartMeta | undefined,
        tags?: string[] | undefined,
        timestamp?: string | undefined,
        knowledge?: kpLib.conversation.KnowledgeResponse | undefined,
        deletionInfo: kp.DeletionInfo | undefined = undefined,
    ) {
        metadata ??= new DocPartMeta();
        tags ??= [];
        super(metadata, textChunks, tags, timestamp, knowledge, deletionInfo);
    }
}

export interface DocMemorySettings extends MemorySettings {}

export function createTextMemorySettings(
    embeddingCacheSize = 64,
    getPersistentCache?: () => kpLib.TextEmbeddingCache | undefined,
) {
    return {
        ...createMemorySettings(embeddingCacheSize, getPersistentCache),
    };
}

export class DocMemory
    extends Memory<DocMemorySettings, DocPart>
    implements kp.IConversation
{
    public messages: kp.MessageCollection<DocPart>;
    public semanticRefs: kp.SemanticRefCollection;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;

    constructor(
        nameTag: string = "",
        docParts: DocPart[] = [],
        settings?: DocMemorySettings,
        tags?: string[],
    ) {
        settings ??= createTextMemorySettings(
            64,
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );

        super(settings ?? createTextMemorySettings(), nameTag, tags);
        this.messages = new kp.MessageCollection<DocPart>(docParts);
        this.semanticRefs = new kp.SemanticRefCollection();

        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings.conversationSettings,
        );
    }

    public override get conversation(): kp.IConversation<DocPart> {
        return this;
    }

    public async buildIndex(
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            return await kp.buildConversationIndex(
                this,
                this.settings.conversationSettings,
                eventHandler,
            );
        } finally {
            this.endIndexing();
        }
    }

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
        };
        return data;
    }

    public async deserialize(docMemoryData: DocMemoryData): Promise<void> {
        this.nameTag = docMemoryData.nameTag;
        const docParts = docMemoryData.messages.map((m) => {
            const metadata = new DocPartMeta(m.metadata.sourceUrl);
            return new DocPart(m.textChunks, metadata, m.tags, m.timestamp);
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
        // Rebuild transient secondary indexes associated with the doc memory
        await kp.buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
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
    ): Promise<DocMemory | undefined> {
        const docMemory = new DocMemory();
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
}

export interface DocMemoryData
    extends kp.IConversationDataWithIndexes<DocPart> {}

export class DocPartSerializer implements kp.JsonSerializer<DocPart> {
    public serialize(value: DocPart): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): DocPart {
        const jMsg: DocPart = JSON.parse(json);
        const jMeta: DocPartMeta = jMsg.metadata;
        return new DocPart(
            jMsg.textChunks,
            jMeta,
            jMsg.tags,
            jMsg.timestamp,
            jMsg.knowledge,
            jMsg.deletionInfo,
        );
    }
}
