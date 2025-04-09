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
    SecondaryIndexingResults,
    buildSecondaryIndexes,
    ConversationThreads,
    //MessageTextIndex,
    //writeConversationDataToFile,
    //readConversationDataFromFile,
    buildTransientSecondaryIndexes,
    //Term,
    ConversationSecondaryIndexes,
    IConversationDataWithIndexes,
} from "knowpro";import {
    createEmbeddingCache,
    conversation as kpLib,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";

import { openai, TextEmbeddingModel } from "aiclient";

import registerDebug from "debug";
const debugLogger = registerDebug("conversation-memory.pdfdocs");
////import { interactiveRagOnDocQueryLoop } from "../pdfQNAInteractiveApp.js";

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

export class PdfChunkMessageMeta implements IKnowledgeSource {

    public pageid: string | undefined;
    public topics: string[] | undefined;

    constructor(
        public readonly fileName: string,
        public readonly pageNumber: number,
        public readonly chunkId: string,
        public readonly startOffset: number,
        public readonly endOffset: number,
    ) {}

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

export class PdfDocument implements IConversation<PdfChunkMessage> {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: PdfDocSecondaryIndexes;
    public semanticRefs: SemanticRef[];

    private embeddingModel: TextEmbeddingModelWithCache | undefined;

    constructor(
        public nameTag: string = "",
        public messages: PdfChunkMessage[] = [],
        public tags: string[] = [],
        settings?: ConversationSettings,
    ) {
        this.semanticRefs = [];
        if (!settings) {
            const [model, embeddingSize] = this.getEmbeddingModel();
            settings = createConversationSettings(model, embeddingSize);
        }
        this.settings = settings;
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new PdfDocSecondaryIndexes(this.settings);
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
            await this.buildTransientSecondaryIndexes(false);
            await this.secondaryIndexes.threads.buildIndex();
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
    ): Promise<SecondaryIndexingResults> {
        this.secondaryIndexes = new PdfDocSecondaryIndexes(this.settings);
        const result = await buildSecondaryIndexes(
            this,
            this.settings,
            eventHandler,
        );
        await this.buildTransientSecondaryIndexes(false);
        await this.secondaryIndexes.threads.buildIndex();
        return result;
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

    private getEmbeddingModel(): [TextEmbeddingModel, number] {
        this.embeddingModel ??= createEmbeddingCache(
            openai.createEmbeddingModel(),
            64,
            () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
        );

        return [this.embeddingModel, 1536];
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
 
}


export class PdfDocSecondaryIndexes extends ConversationSecondaryIndexes {
    public threads: ConversationThreads;

    constructor(settings: ConversationSettings) {
        super(settings);
        this.threads = new ConversationThreads(settings.threadSettings);
    }
}

export interface PdfChunkData
    extends IConversationDataWithIndexes<PdfChunkMessage>{}

