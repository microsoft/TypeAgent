// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SemanticRef,
    IndexingResults,
    IndexingEventHandlers,
    IConversationDataWithIndexes,
    writeConversationDataToFile,
    readConversationDataFromFile,
    buildTransientSecondaryIndexes,
    readConversationDataFromBuffer,
    dataFrame,
    MessageCollection,
    SemanticRefCollection,
} from "knowpro";
import {
    DocMemory,
    DocMemorySettings,
    createTextMemorySettings,
} from "conversation-memory";
import sqlite from "better-sqlite3";
import * as ms from "memory-storage";
import {
    VisitFrequencyTable,
    WebsiteCategoryTable,
    BookmarkFolderTable,
    KnowledgeEntityTable,
    KnowledgeTopicTable,
    ActionKnowledgeCorrelationTable,
} from "./tables.js";
import { Website, WebsiteMeta } from "./websiteMeta.js";
import { WebsiteDocPart } from "./websiteDocPart.js";
import path from "node:path";
import fs from "node:fs";

export interface WebsiteCollectionData
    extends IConversationDataWithIndexes<WebsiteDocPart> {}

export interface WebsiteSearchResult {
    website: WebsiteDocPart;
    relevanceScore: number;
    matchedElements: string[];
    knowledgeContext?:
        | {
              entityCount: number;
              topicCount: number;
              actionCount: number;
          }
        | undefined;
}

export interface KnowledgeInsights {
    totalSites: number;
    sitesWithKnowledge: number;
    topEntities: Map<string, number>;
    topTopics: Map<string, number>;
    actionTypes: Map<string, number>;
    averageKnowledgeRichness: number;
    timeframe: string;
}

export class WebsiteCollection
    extends DocMemory
    implements dataFrame.IConversationWithDataFrame
{
    public dataFrames!: dataFrame.DataFrameCollection;
    public visitFrequency!: dataFrame.IDataFrame;
    public websiteCategories!: dataFrame.IDataFrame;
    public bookmarkFolders!: dataFrame.IDataFrame;
    public knowledgeEntities!: dataFrame.IDataFrame;
    public knowledgeTopics!: dataFrame.IDataFrame;
    public actionKnowledgeCorrelations!: dataFrame.IDataFrame;

    private db: sqlite.Database | undefined = undefined;
    private dbPath: string = "";

    constructor(
        nameTag: string = "",
        websites: Website[] = [],
        tags: string[] = [],
        semanticRefs: SemanticRef[] = [],
        dbPath: string = "",
        db: sqlite.Database | undefined = undefined,
        settings?: DocMemorySettings,
    ) {
        // Convert Website objects to WebsiteDocPart objects
        const docParts = websites.map((website) =>
            WebsiteDocPart.fromWebsite(website),
        );

        // Create settings if not provided
        if (!settings) {
            settings = createTextMemorySettings(64);
        }

        super(nameTag, docParts, settings, tags);

        this.dbPath = dbPath;
        this.db = db;

        // Initialize data frames
        this.initializeDataFrames();

        // Add semantic refs if provided
        if (semanticRefs.length > 0) {
            this.semanticRefs = new SemanticRefCollection(semanticRefs);
        }
    }

    private initializeDataFrames(): void {
        // Create dataFrames (tables)
        if (!this.dbPath) {
            this.dbPath = ":memory:";
        }
        this.db = ms.sqlite.createDatabase(this.dbPath, true);
        this.visitFrequency = new VisitFrequencyTable(this.db);
        this.websiteCategories = new WebsiteCategoryTable(this.db);
        this.bookmarkFolders = new BookmarkFolderTable(this.db);
        this.knowledgeEntities = new KnowledgeEntityTable(this.db);
        this.knowledgeTopics = new KnowledgeTopicTable(this.db);
        this.actionKnowledgeCorrelations = new ActionKnowledgeCorrelationTable(
            this.db,
        );

        // Create dataFrames collection
        this.dataFrames = new Map<string, dataFrame.IDataFrame>([
            [this.visitFrequency.name, this.visitFrequency],
            [this.websiteCategories.name, this.websiteCategories],
            [this.bookmarkFolders.name, this.bookmarkFolders],
            [this.knowledgeEntities.name, this.knowledgeEntities],
            [this.knowledgeTopics.name, this.knowledgeTopics],
            [
                this.actionKnowledgeCorrelations.name,
                this.actionKnowledgeCorrelations,
            ],
        ]);
    }

    /**
     * Add websites to the collection with smart deduplication
     */
    public addWebsites(websites: Website[]): void {
        for (const website of websites) {
            this.addWebsiteWithDeduplication(website);
        }
    }

    /**
     * Add a single website with smart deduplication logic
     */
    public addWebsiteWithDeduplication(website: Website): void {
        const docPart = WebsiteDocPart.fromWebsite(website);
        const url = website.metadata.url;
        
        // Check if URL already exists in collection
        const existingIndex = this.findWebsiteByUrl(url);
        
        if (existingIndex !== -1) {
            const existing = this.messages.get(existingIndex) as WebsiteDocPart;
            
            // Preserve richer data: prefer entries with more content/knowledge
            if (this.shouldReplaceExisting(existing, docPart)) {
                console.log(`[WebsiteCollection] Replacing existing entry for ${url} with richer data`);
                // Update existing entry with new data
                (this.messages as any).items[existingIndex] = docPart;
            } else {
                console.log(`[WebsiteCollection] Skipping duplicate entry for ${url} - existing data is richer`);
                return;
            }
        } else {
            // New URL, add normally
            this.messages.append(docPart);
        }
    }

    /**
     * Find website by URL in the collection
     */
    private findWebsiteByUrl(url: string): number {
        const websites = this.messages.getAll() as WebsiteDocPart[];
        for (let i = 0; i < websites.length; i++) {
            if (websites[i].url === url) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Determine if new data should replace existing data
     * Priority: Rich AI data > HTML content > Basic metadata
     */
    private shouldReplaceExisting(existing: WebsiteDocPart, newEntry: WebsiteDocPart): boolean {
        // Calculate content richness scores
        const existingScore = this.calculateRichnessScore(existing);
        const newScore = this.calculateRichnessScore(newEntry);
        
        console.log(`[WebsiteCollection] Existing richness: ${existingScore}, New richness: ${newScore}`);
        
        return newScore > existingScore;
    }

    /**
     * Calculate how rich/valuable a website entry is
     */
    private calculateRichnessScore(docPart: WebsiteDocPart): number {
        let score = 0;
        
        // Basic metadata (always present)
        score += 1;
        
        // HTML content
        if (docPart.textChunks && docPart.textChunks.length > 0) {
            score += 2;
            // More content = higher score
            score += Math.min(docPart.textChunks.join('').length / 1000, 5);
        }
        
        // Knowledge data (AI-extracted)
        const knowledge = docPart.getKnowledge();
        if (knowledge) {
            score += 5; // AI knowledge is very valuable
            score += knowledge.entities.length * 0.1;
            score += knowledge.topics.length * 0.1;
            score += knowledge.actions.length * 0.1;
        }
        
        // Detected actions
        if (docPart.metadata.detectedActions && docPart.metadata.detectedActions.length > 0) {
            score += 2;
        }
        
        return score;
    }

    /**
     * Add a single website to the collection
     */
    public addWebsite(website: Website): void {
        this.addWebsiteWithDeduplication(website);
    }

    /**
     * Get websites in the legacy format for backward compatibility
     */
    public getWebsites(): Website[] {
        return this.messages
            .getAll()
            .map((docPart) => (docPart as WebsiteDocPart).toWebsite());
    }

    /**
     * Get WebsiteDocPart messages (new format)
     */
    public getWebsiteDocParts(): WebsiteDocPart[] {
        return this.messages.getAll() as WebsiteDocPart[];
    }

    public addMetadataToIndex() {
        // This functionality is now handled by the base DocMemory class
        // But we maintain the method for API compatibility
        if (this.semanticRefIndex) {
            // The base class handles knowledge indexing automatically
        }
    }

    /**
     * Enumerates the messages and adds them to the data frame.
     */
    public addMetadataToDataFrames() {
        if (this.semanticRefIndex) {
            const domainVisits = new Map<
                string,
                { count: number; lastVisit: string }
            >();

            let index = 0;
            for (const docPart of this.messages) {
                const websitePart = docPart as WebsiteDocPart;
                const sourceRef: dataFrame.RowSourceRef = {
                    range: {
                        start: {
                            messageOrdinal: index,
                            chunkOrdinal: 0,
                        },
                    },
                };

                // Track visit frequency
                if (websitePart.domain) {
                    const existing = domainVisits.get(websitePart.domain);
                    const visitCount = websitePart.visitCount || 1;
                    const lastVisit =
                        websitePart.visitDate ||
                        websitePart.bookmarkDate ||
                        new Date().toISOString();

                    if (existing) {
                        existing.count += visitCount;
                        if (lastVisit > existing.lastVisit) {
                            existing.lastVisit = lastVisit;
                        }
                    } else {
                        domainVisits.set(websitePart.domain, {
                            count: visitCount,
                            lastVisit: lastVisit,
                        });
                    }
                }

                // Add website categories
                if (this.websiteCategories && websitePart.pageType) {
                    const categoryRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            domain: websitePart.domain || websitePart.url,
                            category: websitePart.pageType,
                            confidence: 0.8,
                        },
                    };
                    this.websiteCategories.addRows(categoryRow);
                }

                // Add bookmark folder information
                if (
                    this.bookmarkFolders &&
                    websitePart.websiteSource === "bookmark" &&
                    websitePart.folder
                ) {
                    const folderRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            folderPath: websitePart.folder,
                            url: websitePart.url,
                            title: websitePart.title || "",
                            dateAdded:
                                websitePart.bookmarkDate ||
                                new Date().toISOString(),
                        },
                    };
                    this.bookmarkFolders.addRows(folderRow);
                }

                // NEW: Add knowledge entities and topics
                const knowledge = websitePart.getKnowledge();
                if (knowledge) {
                    const extractionDate = new Date().toISOString();

                    // Add knowledge entities
                    if (this.knowledgeEntities && knowledge.entities) {
                        for (const entity of knowledge.entities) {
                            const entityRow: dataFrame.DataFrameRow = {
                                sourceRef,
                                record: {
                                    url: websitePart.url,
                                    domain:
                                        websitePart.domain || websitePart.url,
                                    entityName: entity.name,
                                    entityType: Array.isArray(entity.type)
                                        ? entity.type.join(", ")
                                        : entity.type || "unknown",
                                    confidence: 0.8, // Default confidence
                                    extractionDate,
                                },
                            };
                            this.knowledgeEntities.addRows(entityRow);
                        }
                    }

                    // Add knowledge topics
                    if (this.knowledgeTopics && knowledge.topics) {
                        for (const topic of knowledge.topics) {
                            const topicRow: dataFrame.DataFrameRow = {
                                sourceRef,
                                record: {
                                    url: websitePart.url,
                                    domain:
                                        websitePart.domain || websitePart.url,
                                    topic: topic,
                                    relevance: 0.7, // Default relevance
                                    extractionDate,
                                },
                            };
                            this.knowledgeTopics.addRows(topicRow);
                        }
                    }

                    // Add action-knowledge correlations
                    if (
                        this.actionKnowledgeCorrelations &&
                        knowledge.actions &&
                        websitePart.metadata.detectedActions
                    ) {
                        for (const action of knowledge.actions) {
                            for (const detectedAction of websitePart.metadata
                                .detectedActions) {
                                // Find related entities and topics for this action
                                const relatedEntity =
                                    knowledge.entities.find(
                                        (e) =>
                                            action.objectEntityName === e.name,
                                    )?.name ||
                                    action.objectEntityName ||
                                    "unknown";

                                const relatedTopic =
                                    knowledge.topics.find((t) =>
                                        action.verbs.some((verb) =>
                                            t
                                                .toLowerCase()
                                                .includes(verb.toLowerCase()),
                                        ),
                                    ) ||
                                    knowledge.topics[0] ||
                                    "unknown";

                                const correlationRow: dataFrame.DataFrameRow = {
                                    sourceRef,
                                    record: {
                                        url: websitePart.url,
                                        domain:
                                            websitePart.domain ||
                                            websitePart.url,
                                        actionType: detectedAction.actionType,
                                        relatedEntity,
                                        relatedTopic,
                                        confidence: Math.min(
                                            detectedAction.confidence,
                                            0.9,
                                        ),
                                        correlationDate: extractionDate,
                                    },
                                };
                                this.actionKnowledgeCorrelations.addRows(
                                    correlationRow,
                                );
                            }
                        }
                    }
                }

                index++;
            }

            // Add aggregated visit frequency data
            if (this.visitFrequency) {
                for (const [domain, data] of domainVisits) {
                    const visitRow: dataFrame.DataFrameRow = {
                        sourceRef: {
                            range: {
                                start: { messageOrdinal: 0, chunkOrdinal: 0 },
                            },
                        },
                        record: {
                            domain: domain,
                            visitCount: data.count,
                            lastVisitDate: data.lastVisit,
                        },
                    };
                    this.visitFrequency.addRows(visitRow);
                }
            }
        }
    }

    public override async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        const result = await super.buildIndex(eventHandler);

        this.addMetadataToIndex();
        this.addMetadataToDataFrames();

        return result;
    }

    public override async addToIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        const result = await super.addToIndex(eventHandler);

        if (result && !this.hasErrors(result)) {
            this.addMetadataToIndexIncremental();
            this.addMetadataToDataFramesIncremental();
        }

        return result;
    }

    public async addWebsiteToIndex(
        website: WebsiteDocPart,
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        const result = await super.addItemToIndex(website, eventHandler);

        if (result && !this.hasErrors(result)) {
            const messageOrdinal = this.messages.length - 1;
            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: {
                        messageOrdinal,
                        chunkOrdinal: 0,
                    },
                },
            };
            this.addWebsiteToDataFrames(website, sourceRef, messageOrdinal);
        }

        return result;
    }

    public async updateWebsiteInIndex(
        url: string,
        updatedWebsite: WebsiteDocPart,
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        const messageOrdinal = this.findWebsiteMessageOrdinal(url);
        if (messageOrdinal === -1) {
            throw new Error(`Website with URL ${url} not found in index`);
        }

        this.removeWebsiteFromDataFrames(messageOrdinal);

        const result = await super.updateItemInIndex(
            messageOrdinal,
            updatedWebsite,
            eventHandler,
        );

        if (result && !this.hasErrors(result)) {
            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: {
                        messageOrdinal,
                        chunkOrdinal: 0,
                    },
                },
            };
            this.addWebsiteToDataFrames(
                updatedWebsite,
                sourceRef,
                messageOrdinal,
            );
        }

        return result;
    }

    private findWebsiteMessageOrdinal(url: string): number {
        const websites = this.messages.getAll();
        for (let i = 0; i < websites.length; i++) {
            const website = websites[i] as WebsiteDocPart;
            if (website.url === url) {
                return i;
            }
        }
        return -1;
    }

    private removeWebsiteFromDataFrames(messageOrdinal: number): void {
        this.removeFromDataFrameByMessageOrdinal(
            this.websiteCategories,
            messageOrdinal,
        );
        this.removeFromDataFrameByMessageOrdinal(
            this.bookmarkFolders,
            messageOrdinal,
        );
        this.removeFromDataFrameByMessageOrdinal(
            this.knowledgeEntities,
            messageOrdinal,
        );
        this.removeFromDataFrameByMessageOrdinal(
            this.knowledgeTopics,
            messageOrdinal,
        );
        this.removeFromDataFrameByMessageOrdinal(
            this.actionKnowledgeCorrelations,
            messageOrdinal,
        );
    }

    private removeFromDataFrameByMessageOrdinal(
        dataFrame: dataFrame.IDataFrame | undefined,
        messageOrdinal: number,
    ): void {
        if (!dataFrame) return;

        const frameImpl = dataFrame as any;
        if (frameImpl.rows) {
            frameImpl.rows = frameImpl.rows.filter(
                (row: dataFrame.DataFrameRow) =>
                    row.sourceRef?.range?.start?.messageOrdinal !==
                    messageOrdinal,
            );
        }
    }

    private hasErrors(result: IndexingResults): boolean {
        if (result.semanticRefs?.error) {
            return true;
        }
        if (result.secondaryIndexResults) {
            const secondary = result.secondaryIndexResults;
            return !!(
                secondary.properties?.error ||
                secondary.timestamps?.error ||
                secondary.relatedTerms?.error ||
                secondary.message?.error
            );
        }
        return false;
    }

    private addMetadataToIndexIncremental(): void {
        // The base class handles knowledge indexing automatically
    }

    private addMetadataToDataFramesIncremental(): void {
        if (!this.semanticRefIndex) return;

        const startOrdinal = this.indexingState.lastMessageOrdinal + 1;
        const endOrdinal = this.messages.length - 1;

        for (let index = startOrdinal; index <= endOrdinal; index++) {
            const websitePart = this.messages.get(index) as WebsiteDocPart;
            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: {
                        messageOrdinal: index,
                        chunkOrdinal: 0,
                    },
                },
            };

            this.addWebsiteToDataFrames(websitePart, sourceRef, index);
        }
    }

    private addWebsiteToDataFrames(
        websitePart: WebsiteDocPart,
        sourceRef: dataFrame.RowSourceRef,
        index: number,
    ): void {
        if (this.websiteCategories && websitePart.pageType) {
            const categoryRow: dataFrame.DataFrameRow = {
                sourceRef,
                record: {
                    domain: websitePart.domain || websitePart.url,
                    category: websitePart.pageType,
                    confidence: 0.8,
                },
            };
            this.websiteCategories.addRows(categoryRow);
        }

        if (
            this.bookmarkFolders &&
            websitePart.websiteSource === "bookmark" &&
            websitePart.folder
        ) {
            const folderRow: dataFrame.DataFrameRow = {
                sourceRef,
                record: {
                    folderPath: websitePart.folder,
                    url: websitePart.url,
                    title: websitePart.title || "",
                    dateAdded:
                        websitePart.bookmarkDate || new Date().toISOString(),
                },
            };
            this.bookmarkFolders.addRows(folderRow);
        }

        const knowledge = websitePart.getKnowledge();
        if (knowledge) {
            const extractionDate = new Date().toISOString();

            if (this.knowledgeEntities && knowledge.entities) {
                for (const entity of knowledge.entities) {
                    const entityRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            url: websitePart.url,
                            domain: websitePart.domain || websitePart.url,
                            entityName: entity.name,
                            entityType: Array.isArray(entity.type)
                                ? entity.type.join(", ")
                                : entity.type || "unknown",
                            confidence: 0.8,
                            extractionDate,
                        },
                    };
                    this.knowledgeEntities.addRows(entityRow);
                }
            }

            if (this.knowledgeTopics && knowledge.topics) {
                for (const topic of knowledge.topics) {
                    const topicRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            url: websitePart.url,
                            domain: websitePart.domain || websitePart.url,
                            topic: topic,
                            confidence: 0.8,
                            extractionDate,
                        },
                    };
                    this.knowledgeTopics.addRows(topicRow);
                }
            }

            if (this.actionKnowledgeCorrelations && knowledge.actions) {
                for (const action of knowledge.actions) {
                    const actionRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            url: websitePart.url,
                            domain: websitePart.domain || websitePart.url,
                            actionSubject:
                                action.subjectEntityName || "unknown",
                            actionVerb: action.verbs?.join(", ") || "unknown",
                            actionObject: action.objectEntityName || "unknown",
                            confidence: 0.8,
                            extractionDate,
                        },
                    };
                    this.actionKnowledgeCorrelations.addRows(actionRow);
                }
            }
        }
    }

    public override async serialize(): Promise<WebsiteCollectionData> {
        const baseData = await super.serialize();
        return {
            ...baseData,
            // The base serialization already handles messages, semanticRefs, etc.
        } as WebsiteCollectionData;
    }

    public async deserialize(data: WebsiteCollectionData): Promise<void> {
        // Convert messages back to WebsiteDocPart instances
        const websiteDocParts = data.messages.map((m) => {
            // Reconstruct WebsiteMeta from the serialized message metadata
            const metadataObj = (m.metadata as any).websiteMeta || m.metadata;
            
            // Create a proper WebsiteMeta instance from the serialized data
            const websiteMeta = new WebsiteMeta({
                url: metadataObj.url,
                title: metadataObj.title,
                domain: metadataObj.domain,
                visitDate: metadataObj.visitDate,
                bookmarkDate: metadataObj.bookmarkDate,
                source: metadataObj.websiteSource || metadataObj.source || "bookmark",
                folder: metadataObj.folder,
                pageType: metadataObj.pageType,
                keywords: metadataObj.keywords,
                description: metadataObj.description,
                favicon: metadataObj.favicon,
                visitCount: metadataObj.visitCount,
                lastVisitTime: metadataObj.lastVisitTime,
                typedCount: metadataObj.typedCount,
            });
            
            // Restore enhanced properties if they exist
            if (metadataObj.pageContent) websiteMeta.pageContent = metadataObj.pageContent;
            if (metadataObj.metaTags) websiteMeta.metaTags = metadataObj.metaTags;
            if (metadataObj.structuredData) websiteMeta.structuredData = metadataObj.structuredData;
            if (metadataObj.extractedActions) websiteMeta.extractedActions = metadataObj.extractedActions;
            if (metadataObj.contentSummary) websiteMeta.contentSummary = metadataObj.contentSummary;
            if (metadataObj.detectedActions) websiteMeta.detectedActions = metadataObj.detectedActions;
            if (metadataObj.actionSummary) websiteMeta.actionSummary = metadataObj.actionSummary;
            
            return new WebsiteDocPart(
                websiteMeta,
                m.textChunks,
                m.tags,
                m.timestamp,
                m.knowledge,
                m.deletionInfo,
            );
        });

        this.messages = new MessageCollection<WebsiteDocPart>(websiteDocParts);
        this.semanticRefs = new SemanticRefCollection(data.semanticRefs);
        this.tags = data.tags || [];
        this.nameTag = data.nameTag || "";

        if (data.semanticIndexData) {
            this.semanticRefIndex = new (
                await import("knowpro")
            ).ConversationIndex(data.semanticIndexData);
        }
        if (data.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        if (data.messageIndexData) {
            const kp = await import("knowpro");
            this.secondaryIndexes.messageIndex = new kp.MessageTextIndex(
                this.settings.conversationSettings.messageTextIndexSettings,
            );
            this.secondaryIndexes.messageIndex.deserialize(
                data.messageIndexData,
            );
        }

        // Rebuild transient secondary indexes
        await buildTransientSecondaryIndexes(
            this,
            this.settings.conversationSettings,
        );
    }

    /**
     * Writes the index & dataframes to disk
     */
    public override async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        console.log(`[WebsiteCollection] writeToFile called: ${dirPath}/${baseFileName} (${this.messages.length} messages)`);
        
         console.trace("Call stack to [WebsiteCollection] writeToFile");
         
        const data = await this.serialize();
        
        // Create model metadata with correct embedding size to prevent size 0 issue
        const embeddingSize = this.settings.conversationSettings
            .relatedTermIndexSettings.embeddingIndexSettings?.embeddingSize || 1536;
        const modelMetadata = {
            embeddingSize,
            modelName: "text-embedding-ada-002"
        };
        
        await writeConversationDataToFile(data, dirPath, baseFileName, modelMetadata);

        // if we have an in-memory database we need to write it out to disk
        if (this.dbPath.length === 0 || this.dbPath === ":memory:") {
            const dbFile = `${path.join(dirPath, baseFileName)}_dataFrames.sqlite`;

            if (fs.existsSync(dbFile)) {
                fs.unlinkSync(dbFile);
            }

            this.db?.exec(`vacuum main into '${dbFile}'`);
        }
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<WebsiteCollection | undefined> {
        const websiteCollection = new WebsiteCollection();
        try {
            const data = await readConversationDataFromFile(
                dirPath,
                baseFileName,
                websiteCollection.settings.conversationSettings
                    .relatedTermIndexSettings.embeddingIndexSettings
                    ?.embeddingSize,
            );
            if (data) {
                await websiteCollection.deserialize(data);
            }
        } catch (error: any) {
            console.warn(`Website collection loading failed: ${error.message}`);
        }
        return websiteCollection;
    }

    public static async fromBuffer(
        jsonData: string,
        embeddingsBuffer: Buffer,
    ): Promise<WebsiteCollection> {
        const websiteCollection = new WebsiteCollection();

        const data = await readConversationDataFromBuffer(
            jsonData,
            embeddingsBuffer,
            websiteCollection.settings.conversationSettings
                .relatedTermIndexSettings.embeddingIndexSettings?.embeddingSize,
        );

        if (data) {
            await websiteCollection.deserialize(data);
        }

        return websiteCollection;
    }

    /**
     * Get the most visited domains
     */
    public getMostVisitedDomains(limit: number = 10): any[] {
        if (this.visitFrequency instanceof VisitFrequencyTable) {
            return this.visitFrequency.getTopDomainsByVisits(limit);
        }
        return [];
    }

    /**
     * Get websites by category
     */
    public getWebsitesByCategory(category: string): any[] {
        if (this.websiteCategories instanceof WebsiteCategoryTable) {
            return this.websiteCategories.getDomainsByCategory(category);
        }
        return [];
    }

    /**
     * Get bookmarks by folder
     */
    public getBookmarksByFolder(folderPath: string): any[] {
        if (this.bookmarkFolders instanceof BookmarkFolderTable) {
            return this.bookmarkFolders.getBookmarksByFolder(folderPath);
        }
        return [];
    }

    /**
     * Knowledge-enhanced search methods
     */
    public async searchByEntities(
        entities: string[],
    ): Promise<WebsiteDocPart[]> {
        const results: WebsiteDocPart[] = [];

        for (const docPart of this.messages.getAll()) {
            const websitePart = docPart as WebsiteDocPart;
            const knowledge = websitePart.getKnowledge();

            if (knowledge && knowledge.entities) {
                const entityNames = knowledge.entities.map((e) =>
                    e.name.toLowerCase(),
                );
                const hasMatchingEntity = entities.some((searchEntity) =>
                    entityNames.some(
                        (entityName) =>
                            entityName.includes(searchEntity.toLowerCase()) ||
                            searchEntity.toLowerCase().includes(entityName),
                    ),
                );

                if (hasMatchingEntity) {
                    results.push(websitePart);
                }
            }
        }

        return results;
    }

    public async searchByTopics(topics: string[]): Promise<WebsiteDocPart[]> {
        const results: WebsiteDocPart[] = [];

        for (const docPart of this.messages.getAll()) {
            const websitePart = docPart as WebsiteDocPart;
            const knowledge = websitePart.getKnowledge();

            if (knowledge && knowledge.topics) {
                const hasMatchingTopic = topics.some((searchTopic) =>
                    knowledge.topics.some(
                        (topic) =>
                            topic
                                .toLowerCase()
                                .includes(searchTopic.toLowerCase()) ||
                            searchTopic
                                .toLowerCase()
                                .includes(topic.toLowerCase()),
                    ),
                );

                if (hasMatchingTopic) {
                    results.push(websitePart);
                }
            }
        }

        return results;
    }

    public async searchByActions(
        actionTypes: string[],
    ): Promise<WebsiteDocPart[]> {
        const results: WebsiteDocPart[] = [];

        for (const docPart of this.messages.getAll()) {
            const websitePart = docPart as WebsiteDocPart;

            // Check detected actions
            if (websitePart.metadata.detectedActions) {
                const hasMatchingAction = actionTypes.some((searchAction) =>
                    websitePart.metadata.detectedActions!.some(
                        (action) =>
                            action.actionType
                                .toLowerCase()
                                .includes(searchAction.toLowerCase()) ||
                            action.name
                                ?.toLowerCase()
                                .includes(searchAction.toLowerCase()),
                    ),
                );

                if (hasMatchingAction) {
                    results.push(websitePart);
                }
            }

            // Also check knowledge actions
            const knowledge = websitePart.getKnowledge();
            if (knowledge && knowledge.actions) {
                const hasKnowledgeAction = actionTypes.some((searchAction) =>
                    knowledge.actions.some((action) =>
                        action.verbs.some((verb) =>
                            verb
                                .toLowerCase()
                                .includes(searchAction.toLowerCase()),
                        ),
                    ),
                );

                if (hasKnowledgeAction) {
                    results.push(websitePart);
                }
            }
        }

        return results;
    }

    public async hybridSearch(query: string): Promise<WebsiteSearchResult[]> {
        const searchTerms = query.toLowerCase().split(/\s+/);
        const results: Map<string, WebsiteSearchResult> = new Map();

        for (const docPart of this.messages.getAll()) {
            const websitePart = docPart as WebsiteDocPart;
            const knowledge = websitePart.getKnowledge();
            let relevanceScore = 0;
            const matchedElements: string[] = [];

            // Search in titles and URLs
            if (
                websitePart.title &&
                searchTerms.some((term) =>
                    websitePart.title!.toLowerCase().includes(term),
                )
            ) {
                relevanceScore += 0.3;
                matchedElements.push("title");
            }

            if (
                searchTerms.some((term) =>
                    websitePart.url.toLowerCase().includes(term),
                )
            ) {
                relevanceScore += 0.2;
                matchedElements.push("url");
            }

            // Search in knowledge topics
            if (knowledge && knowledge.topics) {
                const topicMatches = knowledge.topics.filter((topic) =>
                    searchTerms.some((term) =>
                        topic.toLowerCase().includes(term),
                    ),
                );
                if (topicMatches.length > 0) {
                    relevanceScore += Math.min(topicMatches.length * 0.1, 0.3);
                    matchedElements.push("topics");
                }
            }

            // Search in knowledge entities
            if (knowledge && knowledge.entities) {
                const entityMatches = knowledge.entities.filter((entity) =>
                    searchTerms.some((term) =>
                        entity.name.toLowerCase().includes(term),
                    ),
                );
                if (entityMatches.length > 0) {
                    relevanceScore += Math.min(entityMatches.length * 0.1, 0.2);
                    matchedElements.push("entities");
                }
            }

            // Search in text content
            const textContent = websitePart.textChunks.join(" ").toLowerCase();
            const textMatches = searchTerms.filter((term) =>
                textContent.includes(term),
            );
            if (textMatches.length > 0) {
                relevanceScore += Math.min(textMatches.length * 0.05, 0.2);
                matchedElements.push("content");
            }

            if (relevanceScore > 0) {
                results.set(websitePart.url, {
                    website: websitePart,
                    relevanceScore,
                    matchedElements,
                    knowledgeContext: knowledge
                        ? {
                              entityCount: knowledge.entities.length,
                              topicCount: knowledge.topics.length,
                              actionCount: knowledge.actions.length,
                          }
                        : undefined,
                });
            }
        }

        // Sort by relevance score and return top results
        return Array.from(results.values())
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 50);
    }

    /**
     * Get knowledge insights for analytics
     */
    public getKnowledgeInsights(timeframe?: string): KnowledgeInsights {
        const websites = this.getWebsiteDocParts();
        const insights: KnowledgeInsights = {
            totalSites: websites.length,
            sitesWithKnowledge: 0,
            topEntities: new Map(),
            topTopics: new Map(),
            actionTypes: new Map(),
            averageKnowledgeRichness: 0,
            timeframe: timeframe || "all",
        };

        let totalKnowledgeScore = 0;

        for (const website of websites) {
            const knowledge = website.getKnowledge();
            if (
                knowledge &&
                (knowledge.entities.length > 0 || knowledge.topics.length > 0)
            ) {
                insights.sitesWithKnowledge++;

                // Calculate knowledge richness score
                const richness =
                    knowledge.entities.length +
                    knowledge.topics.length +
                    knowledge.actions.length;
                totalKnowledgeScore += richness;

                // Count entities
                knowledge.entities.forEach((entity) => {
                    const current = insights.topEntities.get(entity.name) || 0;
                    insights.topEntities.set(entity.name, current + 1);
                });

                // Count topics
                knowledge.topics.forEach((topic) => {
                    const current = insights.topTopics.get(topic) || 0;
                    insights.topTopics.set(topic, current + 1);
                });

                // Count action types
                knowledge.actions.forEach((action) => {
                    action.verbs.forEach((verb) => {
                        const current = insights.actionTypes.get(verb) || 0;
                        insights.actionTypes.set(verb, current + 1);
                    });
                });
            }

            // Also count detected action types
            if (website.metadata.detectedActions) {
                website.metadata.detectedActions.forEach((action) => {
                    const actionType = action.actionType;
                    const current = insights.actionTypes.get(actionType) || 0;
                    insights.actionTypes.set(actionType, current + 1);
                });
            }
        }

        insights.averageKnowledgeRichness =
            insights.sitesWithKnowledge > 0
                ? totalKnowledgeScore / insights.sitesWithKnowledge
                : 0;

        return insights;
    }

    /**
     * Get top entities by domain using knowledge analytics
     */
    public getTopEntitiesByDomain(domain: string): any[] {
        if (this.knowledgeEntities instanceof KnowledgeEntityTable) {
            return this.knowledgeEntities.getEntitiesByDomain(domain);
        }
        return [];
    }

    /**
     * Get action-knowledge correlations for analysis
     */
    public getActionKnowledgeCorrelations(): any[] {
        if (
            this.actionKnowledgeCorrelations instanceof
            ActionKnowledgeCorrelationTable
        ) {
            return this.actionKnowledgeCorrelations.getActionTopicMatrix();
        }
        return [];
    }

    /**
     * Get knowledge growth insights over time
     */
    public getKnowledgeGrowthInsights(): {
        entityGrowth: Map<string, number>;
        topicGrowth: Map<string, number>;
        knowledgeRichnessTrend: Array<{ date: string; richness: number }>;
    } {
        const insights = {
            entityGrowth: new Map<string, number>(),
            topicGrowth: new Map<string, number>(),
            knowledgeRichnessTrend: [] as Array<{
                date: string;
                richness: number;
            }>,
        };

        const websites = this.getWebsiteDocParts();
        const dailyRichness = new Map<string, number>();

        for (const website of websites) {
            const knowledge = website.getKnowledge();
            if (knowledge) {
                // Track entity growth
                knowledge.entities.forEach((entity) => {
                    const count = insights.entityGrowth.get(entity.name) || 0;
                    insights.entityGrowth.set(entity.name, count + 1);
                });

                // Track topic growth
                knowledge.topics.forEach((topic) => {
                    const count = insights.topicGrowth.get(topic) || 0;
                    insights.topicGrowth.set(topic, count + 1);
                });

                // Track knowledge richness over time
                const date = website.visitDate || website.bookmarkDate;
                if (date) {
                    const dayKey = date.split("T")[0]; // Get YYYY-MM-DD
                    const richness =
                        knowledge.entities.length +
                        knowledge.topics.length +
                        knowledge.actions.length;
                    const existing = dailyRichness.get(dayKey) || 0;
                    dailyRichness.set(dayKey, existing + richness);
                }
            }
        }

        // Convert daily richness to sorted array
        insights.knowledgeRichnessTrend = Array.from(dailyRichness.entries())
            .map(([date, richness]) => ({ date, richness }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return insights;
    }
}
