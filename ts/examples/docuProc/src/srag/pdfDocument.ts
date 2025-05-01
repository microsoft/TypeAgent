// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import {
    conversation as kpLib,
    createEmbeddingCache,
    TextEmbeddingModelWithCache,
} from "knowledge-processor";

import { openai } from "aiclient";
import registerDebug from "debug";
import { CatalogEntryWithMeta } from "../pdfDownLoader.js";
const debugLogger = registerDebug("conversation-memory.pdfdocs");

export class PdfChunkMessageMeta
    implements kp.IKnowledgeSource, kp.IMessageMetadata
{
    constructor(
        public fileName: string,
        public pageNumber: string = "-",
        public chunkId: string,
        public sectionName: string = "",
        public pdfMetadata: CatalogEntryWithMeta,
    ) {}

    public get source() {
        return undefined;
    }

    public get dest() {
        return undefined;
    }

    getKnowledge() {
        const entities: kpLib.ConcreteEntity[] = [];
        const actions: kpLib.Action[] = [];
        const inverseActions: kpLib.Action[] = [];
        const timestampParam = [];

        if (this.pdfMetadata.meta.published) {
            timestampParam.push({
                name: "Timestamp",
                value: this.pdfMetadata.meta.published,
            });
        }

        // 1. Entity for the document chunk (this file chunk)
        const docChunkEntity: kpLib.ConcreteEntity = {
            name: this.chunkId,
            type: ["file-chunk", "pdf-chunk"],
            facets: [
                { name: "File Name", value: this.fileName },
                { name: "Page Number", value: this.pageNumber },
                { name: "Chunk ID", value: this.chunkId },
                { name: "Section Name", value: this.sectionName },
            ],
        };

        // 2. Entity for the full paper
        const paperEntity: kpLib.ConcreteEntity = {
            name: this.pdfMetadata.meta.title,
            type: ["paper", "arxiv"],
            facets: [
                { name: "arXiv ID", value: this.pdfMetadata.meta.id },
                { name: "Published", value: this.pdfMetadata.meta.published },
                { name: "Summary", value: this.pdfMetadata.meta.summary },
                ...(this.pdfMetadata.meta.comment
                    ? [
                          {
                              name: "Comment",
                              value: this.pdfMetadata.meta.comment,
                          },
                      ]
                    : []),
                ...(this.pdfMetadata.meta.primary_category
                    ? [
                          {
                              name: "Primary Category",
                              value: this.pdfMetadata.meta.primary_category,
                          },
                      ]
                    : []),
            ],
        };
        entities.push(paperEntity);

        // 3. Link chunk to paper
        const chunkToPaperAction: kpLib.Action = {
            verbs: ["extracted from", "derived from"],
            verbTense: "present",
            subjectEntityName: docChunkEntity.name,
            objectEntityName: paperEntity.name,
            indirectObjectEntityName: "none",
            subjectEntityFacet: undefined,
        };
        actions.push(chunkToPaperAction);

        // 4. Authors
        for (const author of this.pdfMetadata.meta.author) {
            const authorEntity: kpLib.ConcreteEntity = {
                name: author.name,
                type: ["author"],
            };
            entities.push(authorEntity);

            const authoredAction: kpLib.Action = {
                verbs: ["written by", "authored by"],
                verbTense: "past",
                subjectEntityName: paperEntity.name,
                objectEntityName: authorEntity.name,
                indirectObjectEntityName: "none",
                subjectEntityFacet: undefined,
                params: timestampParam,
            };
            actions.push(authoredAction);
        }

        // 5. Chunk belongs to page
        const chunkInPageAction: kpLib.Action = {
            verbs: ["contained within", "part of"],
            verbTense: "present",
            subjectEntityName: docChunkEntity.name,
            objectEntityName: `Page ${this.pageNumber}`,
            indirectObjectEntityName: "none",
            subjectEntityFacet: undefined,
        };
        actions.push(chunkInPageAction);

        // 6. Topics (categories)
        const topics: string[] = [];
        if (this.pdfMetadata.meta.category) {
            if (Array.isArray(this.pdfMetadata?.meta?.category)) {
                topics.push(
                    ...this.pdfMetadata.meta.category.map((cat: any) =>
                        cat["@_term"].trim(),
                    ),
                );
            }
        }

        // 7. Optionally generate inverse actions
        for (const action of actions) {
            inverseActions.push({
                verbs: this.generateInverseVerbs(action.verbs),
                verbTense: action.verbTense,
                subjectEntityName: action.objectEntityName,
                objectEntityName: action.subjectEntityName,
                indirectObjectEntityName: action.indirectObjectEntityName,
                subjectEntityFacet: undefined,
            });
        }

        return {
            entities,
            actions,
            inverseActions,
            topics,
        };
    }

    private generateInverseVerbs(verbs: string[]): string[] {
        // Simple inverses
        return verbs.map((verb) => {
            if (verb.includes("by")) return `was ${verb}`;
            if (verb.includes("within") || verb.includes("part of"))
                return `contains`;
            if (
                verb.includes("extracted from") ||
                verb.includes("derived from")
            )
                return `produced`;
            return `related to`; // fallback generic
        });
    }
}

export class PdfChunkMessage implements kp.IMessage {
    public timestamp: string | undefined = undefined;
    constructor(
        public textChunks: string[],
        public metadata: PdfChunkMessageMeta,
        public tags: string[] = [],
    ) {}

    public getKnowledge(): kpLib.KnowledgeResponse {
        return (
            this.metadata?.getKnowledge() ?? {
                entities: [],
                actions: [],
                inverseActions: [],
                topics: [],
            }
        );
    }

    public addContent(content: string | string[]) {
        if (Array.isArray(content)) {
            this.textChunks[0] += content.join("\n");
        } else {
            this.textChunks[0] += content;
        }
    }
}
export class PdfKnowproIndex implements kp.IConversation<PdfChunkMessage> {
    public settings: kp.ConversationSettings;
    public semanticRefIndex: kp.ConversationIndex;
    public secondaryIndexes: kp.ConversationSecondaryIndexes;
    private embeddingModel: TextEmbeddingModelWithCache | undefined;
    public messages: kp.MessageCollection<PdfChunkMessage>;

    constructor(
        public nameTag: string = "",
        messages: PdfChunkMessage[] = [],
        public tags: string[] = [],
        public semanticRefs: kp.SemanticRef[] = [],
    ) {
        const [model, embeddingSize] = this.createEmbeddingModel();
        this.embeddingModel = model;
        this.settings = kp.createConversationSettings(model, embeddingSize);
        this.semanticRefIndex = new kp.ConversationIndex();
        this.secondaryIndexes = new kp.ConversationSecondaryIndexes(
            this.settings,
        );
        this.messages = new kp.MessageCollection<PdfChunkMessage>(messages);
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
        eventHandler?: kp.IndexingEventHandlers,
    ): Promise<kp.IndexingResults> {
        this.beginIndexing();
        try {
            const result = await kp.buildConversationIndex(
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
        await kp.writeConversationDataToFile(data, dirPath, baseFileName);
    }

    public async serialize(): Promise<PdfChunkData> {
        const data: PdfChunkData = {
            nameTag: this.nameTag,
            messages: this.messages.getAll(),
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
    ): Promise<PdfKnowproIndex | undefined> {
        const pdfDoc = new PdfKnowproIndex();
        const data = await kp.readConversationDataFromFile(
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
            // placeholder - fix this later
            const metadata = m.metadata as PdfChunkMessageMeta;
            return new PdfChunkMessage(m.textChunks, metadata, m.tags);
        });
        this.messages = new kp.MessageCollection<PdfChunkMessage>(
            pdfChunkMessages,
        );
        this.semanticRefs = pdfChunkData.semanticRefs;
        this.tags = pdfChunkData.tags;
        if (pdfChunkData.semanticIndexData) {
            this.semanticRefIndex = new kp.ConversationIndex(
                pdfChunkData.semanticIndexData,
            );
        }

        if (pdfChunkData.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                pdfChunkData.relatedTermsIndexData,
            );
        }

        if (pdfChunkData.messageIndexData) {
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                pdfChunkData.messageIndexData,
            );
        }

        await kp.buildTransientSecondaryIndexes(this, this.settings);
    }
}
export interface PdfChunkData
    extends kp.IConversationDataWithIndexes<PdfChunkMessage> {}
