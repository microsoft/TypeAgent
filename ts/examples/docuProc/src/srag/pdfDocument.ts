// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IKnowledgeSource,
    IMessage,
    IConversation,
    ConversationSettings,
    ConversationIndex,
    SemanticRef,
    createConversationSettings,
    IndexingEventHandlers,
    IndexingResults,
    buildConversationIndex,
    ConversationSecondaryIndexes,
    MessageTextIndex,
    writeConversationDataToFile,
    readConversationDataFromFile,
    //addMessageKnowledgeToSemanticRefIndex,
    buildTransientSecondaryIndexes,
    //Term,
    IConversationDataWithIndexes,
} from "knowpro";
import {
    conversation as kpLib,
    createEmbeddingCache,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";

import { openai } from "aiclient";

import registerDebug from "debug";
const debugLogger = registerDebug("conversation-memory.pdfdocs");

export class PdfChunkMessageMeta implements IKnowledgeSource {
    public docChunkId: string = "";
    public pageNumber: string = "";
    public topics: string[] | undefined;

    constructor() {}

    getKnowledge() {
        const entities: kpLib.ConcreteEntity[] = [];
        const actions: kpLib.Action[] = [];
        const docChunkEntity: kpLib.ConcreteEntity = {
            name: this.docChunkId,
            type: ["chunk"],
            facets: [
                { name: "Section Title", value: "Header 1" },
                { name: "Page NUmber", value: "1" },
            ],
        };
        const chunkInPageAction: kpLib.Action = {
            verbs: ["within", "in"],
            verbTense: "present",
            subjectEntityName: "Page Number",
            objectEntityName: docChunkEntity.name,
            indirectObjectEntityName: "none",
            subjectEntityFacet: undefined,
        };

        entities.push(docChunkEntity);
        actions.push(chunkInPageAction);

        return {
            entities,
            actions,
            inverseActions: [],
            topics: [],
        };
    }
}
export class PdfChunkMessage implements IMessage {
    constructor(
        public textChunks: string[],
        public metadata: PdfChunkMessageMeta,
        public tags: string[] = [],
        public timestamp: string | undefined = undefined,
    ) {}

    public getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }

    public addContent(content: string | string[]) {
        if (Array.isArray(content)) {
            this.textChunks[0] += content.join("\n");
        } else {
            this.textChunks[0] += content;
        }
    }
}

export class PdfDocument implements IConversation<PdfChunkMessage> {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: ConversationSecondaryIndexes;
    private embeddingModel: TextEmbeddingModelWithCache | undefined;

    constructor(
        public nameTag: string = "",
        public messages: PdfChunkMessage[] = [],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
    ) {
        const [model, embeddingSize] = this.createEmbeddingModel();
        this.embeddingModel = model;
        this.settings = createConversationSettings(model, embeddingSize);
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new ConversationSecondaryIndexes(this.settings);
    }

    private createEmbeddingModel(): [TextEmbeddingModelWithCache, number] {
        return [
            createEmbeddingCache(
                openai.createEmbeddingModel(),
                64,
                () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
            ),
            1536,
        ];
    }

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        this.beginIndexing();
        try {
            const result = await buildConversationIndex(
                this,
                this.settings,
                eventHandler,
            );
            //await this.buildTransientSecondaryIndexes(false);
            return result;
        } catch (ex) {
            debugLogger(
                `Pdf Document ${this.nameTag} buildIndex failed\n${ex}`,
            );
            throw ex;
        } finally {
            this.endIndexing();
        }
    }

    private beginIndexing(): void {
        if (this.embeddingModel) {
            this.embeddingModel.cacheEnabled = false;
        }
    }
    private endIndexing(): void {
        if (this.embeddingModel) {
            this.embeddingModel.cacheEnabled = true;
        }
    }

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public async serialize(): Promise<PdfChunkData> {
        const data: PdfChunkData = {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
            messageIndexData: this.secondaryIndexes.messageIndex?.serialize(),
        };
        return data;
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<PdfDocument | undefined> {
        const pdfDoc = new PdfDocument();
        const data = await readConversationDataFromFile(
            dirPath,
            baseFileName,
            pdfDoc.settings.relatedTermIndexSettings.embeddingIndexSettings
                ?.embeddingSize,
        );
        if (data) {
            pdfDoc.deserialize(data);
        }
        return pdfDoc;
    }

    public async deserialize(pdfChunkData: PdfChunkData): Promise<void> {
        this.nameTag = pdfChunkData.nameTag;
        const pdfChunkMessages = pdfChunkData.messages.map((m) => {
            const metadata = new PdfChunkMessageMeta();
            return new PdfChunkMessage(
                m.textChunks,
                metadata,
                m.tags,
                m.timestamp,
            );
        });
        this.messages = pdfChunkMessages;
        this.semanticRefs = pdfChunkData.semanticRefs;
        this.tags = pdfChunkData.tags;
        if (pdfChunkData.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                pdfChunkData.semanticIndexData,
            );
        }

        if (pdfChunkData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                pdfChunkData.relatedTermsIndexData,
            );
        }

        if (pdfChunkData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new MessageTextIndex(
                this.settings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                pdfChunkData.messageIndexData,
            );
        }

        await buildTransientSecondaryIndexes(this, this.settings);
    }
}
export interface PdfChunkData
    extends IConversationDataWithIndexes<PdfChunkMessage> {}
