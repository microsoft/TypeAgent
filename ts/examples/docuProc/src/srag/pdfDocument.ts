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
    //MessageTextIndex,
    writeConversationDataToFile,
    readConversationDataFromFile,
    buildTransientSecondaryIndexes,
    //Term,
    IConversationDataWithIndexes,
} from "knowpro";
import {
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";

//import { openai, TextEmbeddingModel } from "aiclient";

import registerDebug from "debug";
const debugLogger = registerDebug("conversation-memory.pdfdocs");
////import { interactiveRagOnDocQueryLoop } from "../pdfQNAInteractiveApp.js";

export class PdfChunkMessageMeta implements IKnowledgeSource {

    public pageid: string | undefined;
    public topics: string[] | undefined;

    constructor() {}

    getKnowledge() {
        const entities: kpLib.ConcreteEntity[] = [];
        return {
            entities,
            actions: [],
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
    public semanticRefs: SemanticRef[];

    private embeddingModel: TextEmbeddingModelWithCache | undefined;

    constructor(
        public nameTag: string = "",
        public messages: PdfChunkMessage[] = [],
        public tags: string[] = [],
        settings?: ConversationSettings,
    ) {
        this.semanticRefs = [];
        if (settings === undefined) {
            this.settings = createConversationSettings();
        }
        else {
            this.settings = settings;
        }
        this.semanticRefIndex = new ConversationIndex();
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
            debugLogger(`Pdf Document ${this.nameTag} buildIndex failed\n${ex}`);
            throw ex;
        } finally {
            this.endIndexing();
        }
    }

    public async buildSecondaryIndexes(
        eventHandler?: IndexingEventHandlers,
    ): Promise<void> {
        await this.buildTransientSecondaryIndexes(false);
        return;
    }

    private async buildTransientSecondaryIndexes(all: boolean): Promise<void> {
        if (all) {
            // Build transient secondary indexes associated with the conversation
            // These are automatically build by calls to buildConversationIndex, but
            // may need to get rebuilt when we deserialize persisted conversations
            await buildTransientSecondaryIndexes(this, this.settings);
        }
        //this.buildParticipantAliases();
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
        }
        
        if (pdfChunkData.messageIndexData) {
        }
        await this.buildTransientSecondaryIndexes(true);
    }
}
export interface PdfChunkData
    extends IConversationDataWithIndexes<PdfChunkMessage>{}

