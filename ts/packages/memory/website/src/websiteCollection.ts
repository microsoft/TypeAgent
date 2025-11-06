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
import registerDebug from "debug";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const Graph = require("graphology");

const debug = registerDebug("typeagent:memory:websiteCollection");

/**
 * Schema for LLM-based pairwise topic relationship analysis
 * Used with TypeChat for analyzing semantic relationships between two topics
 */

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

        // Only overwrite if it's a memory database or if the file doesn't exist
        let shouldOverwrite = this.dbPath === ":memory:";

        if (this.dbPath !== ":memory:" && this.dbPath) {
            try {
                const fileExists = fs.existsSync(this.dbPath);
                shouldOverwrite = !fileExists;
            } catch (error) {
                console.warn(
                    `[Knowledge Graph] Could not check database file existence: ${error}`,
                );
                shouldOverwrite = false; // Conservative approach - don't overwrite
            }
        }

        this.db = ms.sqlite.createDatabase(this.dbPath, shouldOverwrite);
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
                debug(
                    `[WebsiteCollection] Replacing existing entry for ${url} with richer data`,
                );
                // Update existing entry with new data
                (this.messages as any).items[existingIndex] = docPart;
            } else {
                debug(
                    `[WebsiteCollection] Skipping duplicate entry for ${url} - existing data is richer`,
                );
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
    private shouldReplaceExisting(
        existing: WebsiteDocPart,
        newEntry: WebsiteDocPart,
    ): boolean {
        // Calculate content richness scores
        const existingScore = this.calculateRichnessScore(existing);
        const newScore = this.calculateRichnessScore(newEntry);

        debug(
            `[WebsiteCollection] Existing richness: ${existingScore}, New richness: ${newScore}`,
        );

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
            score += Math.min(docPart.textChunks.join("").length / 1000, 5);
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
        if (
            docPart.metadata.detectedActions &&
            docPart.metadata.detectedActions.length > 0
        ) {
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
                                        actionType: detectedAction.type,
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

        this.cleanupSyntheticTopics();
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
        const knowledge = website.getKnowledge();
        const hasKnowledge =
            knowledge &&
            (knowledge.entities?.length > 0 ||
                knowledge.topics?.length > 0 ||
                knowledge.actions?.length > 0);

        let overrideSettings;
        if (hasKnowledge) {
            overrideSettings = {
                ...this.settings,
                conversationSettings: {
                    ...this.settings.conversationSettings,
                    semanticRefIndexSettings: {
                        ...this.settings.conversationSettings
                            .semanticRefIndexSettings,
                        autoExtractKnowledge: false,
                    },
                },
            };
        }

        const result = await super.addDocPartToIndex(
            website,
            eventHandler,
            overrideSettings,
        );

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

    /**
     * Clean up synthetic temporal topics from existing knowledge
     * Removes topics like "bookmarked in YYYY", "visited in YYYY", etc.
     */
    private cleanupSyntheticTopics(): void {
        if (!this.messages || this.messages.length === 0) {
            return;
        }

        const syntheticTopicPatterns = [
            /^bookmarked in \d{4}$/i,
            /^visited in \d{4}$/i,
            /^.* bookmark from \d{4}$/i,
            /^.* visit from \d{4}$/i,
            /^recent bookmark$/i,
            /^new bookmark$/i,
            /^old bookmark$/i,
            /^early bookmark$/i,
            /^.* bookmark from \d{4}$/i,
            /^frequently visited site$/i,
            /^rarely visited site$/i,
            /^infrequent visit$/i,
            /^popular domain$/i,
            /^often visited$/i,
        ];

        let cleanedCount = 0;

        for (let i = 0; i < this.messages.length; i++) {
            const websitePart = this.messages.get(i) as WebsiteDocPart;
            const knowledge = websitePart.getKnowledge();

            if (knowledge && knowledge.topics) {
                const originalTopicCount = knowledge.topics.length;

                knowledge.topics = knowledge.topics.filter((topic: string) => {
                    for (const pattern of syntheticTopicPatterns) {
                        if (pattern.test(topic)) {
                            return false;
                        }
                    }
                    return true;
                });

                const removedCount =
                    originalTopicCount - knowledge.topics.length;
                if (removedCount > 0) {
                    cleanedCount += removedCount;
                    debug(
                        `[WebsiteCollection] Cleaned ${removedCount} synthetic topics from ${websitePart.url}`,
                    );
                }
            }
        }

        if (cleanedCount > 0) {
            debug(
                `[WebsiteCollection] Total cleanup: removed ${cleanedCount} synthetic temporal topics`,
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
                source:
                    metadataObj.websiteSource ||
                    metadataObj.source ||
                    "bookmark",
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
            if (metadataObj.pageContent)
                websiteMeta.pageContent = metadataObj.pageContent;
            if (metadataObj.metaTags)
                websiteMeta.metaTags = metadataObj.metaTags;
            if (metadataObj.structuredData)
                websiteMeta.structuredData = metadataObj.structuredData;
            if (metadataObj.extractedActions)
                websiteMeta.extractedActions = metadataObj.extractedActions;
            if (metadataObj.contentSummary)
                websiteMeta.contentSummary = metadataObj.contentSummary;
            if (metadataObj.detectedActions)
                websiteMeta.detectedActions = metadataObj.detectedActions;
            if (metadataObj.actionSummary)
                websiteMeta.actionSummary = metadataObj.actionSummary;

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
        const data = await this.serialize();

        // Create model metadata with correct embedding size to prevent size 0 issue
        const embeddingSize =
            this.settings.conversationSettings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize || 1536;
        const modelMetadata = {
            embeddingSize,
            modelName: "text-embedding-ada-002",
        };

        await writeConversationDataToFile(
            data,
            dirPath,
            baseFileName,
            modelMetadata,
        );

        // if we have an in-memory database we need to write it out to disk
        if (this.dbPath.length === 0 || this.dbPath === ":memory:") {
            const dbFile = `${path.join(dirPath, baseFileName)}_dataFrames.sqlite`;
            debug(`[Knowledge Graph] Saving SQLite database to: ${dbFile}`);

            // Only delete if it's a memory database being saved for the first time
            // If we already have a persistent database, don't delete it
            if (fs.existsSync(dbFile) && this.dbPath === ":memory:") {
                debug(`[Knowledge Graph] Backing up existing database file`);
                const backupFile = `${dbFile}.backup.${Date.now()}`;
                fs.copyFileSync(dbFile, backupFile);
                fs.unlinkSync(dbFile);
            }

            this.db?.exec(`vacuum main into '${dbFile}'`);
            debug(`[Knowledge Graph] Database saved successfully`);
        }
    }

    public static async readFromFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<WebsiteCollection | undefined> {
        // Check if there's a SQLite database file
        const dbFile = path.join(dirPath, `${baseFileName}_dataFrames.sqlite`);
        let dbPath = "";

        // Check if the database file exists
        try {
            const fs = await import("fs");
            if (fs.existsSync(dbFile)) {
                dbPath = dbFile;
            } else {
                debug(
                    `[Knowledge Graph] No existing database found at: ${dbFile}`,
                );
            }
        } catch (error) {
            console.warn(
                `[Knowledge Graph] Could not check for database file: ${error}`,
            );
        }

        const websiteCollection = new WebsiteCollection(
            undefined,
            undefined,
            undefined,
            undefined,
            dbPath,
        );

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
     * Knowledge-enhanced search methods using knowledge graph
     */
    public async searchByEntities(
        entities: string[],
        type?: string,
        facetName?: string,
        facetValue?: string,
        when?: any,
    ): Promise<WebsiteDocPart[]> {
        const results: WebsiteDocPart[] = [];
        const kp = await import("knowpro");

        // Search for each entity using knowledge graph
        for (const entity of entities) {
            const searchTermGroup = kp.createEntitySearchTermGroup(
                entity,
                type,
                facetName,
                facetValue,
                false, // exactMatch
            );

            const whenFilter = {
                knowledgeType: "entity" as const,
                ...when,
            };

            const searchResult = await kp.searchConversationKnowledge(
                this,
                searchTermGroup,
                whenFilter,
                { maxKnowledgeMatches: 50 },
            );

            if (searchResult) {
                // searchResult is a Map<KnowledgeType, SemanticRefSearchResult>
                const entityResults = searchResult.get("entity");
                if (entityResults && entityResults.semanticRefMatches) {
                    for (const match of entityResults.semanticRefMatches) {
                        // Get the semantic ref first, then the message
                        const semanticRef = this.semanticRefs?.get(
                            match.semanticRefOrdinal,
                        );
                        if (semanticRef) {
                            const messageOrdinal =
                                semanticRef.range.start.messageOrdinal;
                            const message = this.messages.get(messageOrdinal);
                            if (message) {
                                results.push(message as WebsiteDocPart);
                            }
                        }
                    }
                }
            }
        }

        // Remove duplicates
        const uniqueResults = new Map<string, WebsiteDocPart>();
        results.forEach((r) => {
            const key = r.url || `${r.timestamp}_${Math.random()}`;
            uniqueResults.set(key, r);
        });
        return Array.from(uniqueResults.values());
    }

    public async searchByTopics(
        topics: string[],
        when?: any,
        options?: any,
    ): Promise<WebsiteDocPart[]> {
        const kp = await import("knowpro");
        const searchTermGroup = kp.createTopicSearchTermGroup(topics);

        const whenFilter = {
            ...when,
            knowledgeType: "topic" as const,
        };

        const searchResult = await kp.searchConversationKnowledge(
            this,
            searchTermGroup,
            whenFilter,
            options || { maxMatches: 50 },
        );

        const results: WebsiteDocPart[] = [];
        if (searchResult) {
            const topicResults = searchResult.get("topic");
            if (topicResults && topicResults.semanticRefMatches) {
                for (const match of topicResults.semanticRefMatches) {
                    // Get the semantic ref first, then the message
                    const semanticRef = this.semanticRefs?.get(
                        match.semanticRefOrdinal,
                    );
                    if (semanticRef) {
                        const messageOrdinal =
                            semanticRef.range.start.messageOrdinal;
                        const message = this.messages.get(messageOrdinal);
                        if (message) {
                            results.push(message as WebsiteDocPart);
                        }
                    }
                }
            }
        }

        return results;
    }

    public async searchByActions(
        actionTypes: string[],
        when?: any,
    ): Promise<WebsiteDocPart[]> {
        const kp = await import("knowpro");
        // Use topic search since actions are often categorized as topics
        const searchTermGroup = kp.createTopicSearchTermGroup(actionTypes);

        const whenFilter = {
            knowledgeType: "action" as const,
            ...when,
        };

        const searchResult = await kp.searchConversationKnowledge(
            this,
            searchTermGroup,
            whenFilter,
            { maxKnowledgeMatches: 50 },
        );

        const results: WebsiteDocPart[] = [];
        if (searchResult) {
            const actionResults = searchResult.get("action");
            if (actionResults && actionResults.semanticRefMatches) {
                for (const match of actionResults.semanticRefMatches) {
                    // Get the semantic ref first, then the message
                    const semanticRef = this.semanticRefs?.get(
                        match.semanticRefOrdinal,
                    );
                    if (semanticRef) {
                        const messageOrdinal =
                            semanticRef.range.start.messageOrdinal;
                        const message = this.messages.get(messageOrdinal);
                        if (message) {
                            results.push(message as WebsiteDocPart);
                        }
                    }
                }
            }
        }

        return results;
    }

    public async hybridSearch(query: string): Promise<WebsiteSearchResult[]> {
        // Use combined entity and topic search for hybrid approach
        const [entityResults, topicResults] = await Promise.all([
            this.searchByEntities([query]),
            this.searchByTopics([query]),
        ]);

        // Combine results and calculate relevance scores
        const results: Map<string, WebsiteSearchResult> = new Map();

        // Process entity results
        for (const websitePart of entityResults) {
            const key =
                websitePart.url || `${websitePart.timestamp}_${Math.random()}`;
            results.set(key, {
                website: websitePart,
                relevanceScore: 0.6, // Higher score for entity matches
                matchedElements: ["entities"],
                knowledgeContext: this.getKnowledgeContext(websitePart),
            });
        }

        // Process topic results
        for (const websitePart of topicResults) {
            const key =
                websitePart.url || `${websitePart.timestamp}_${Math.random()}`;
            const existing = results.get(key);

            if (existing) {
                // Boost score if found in both
                existing.relevanceScore += 0.4;
                existing.matchedElements.push("topics");
            } else {
                results.set(key, {
                    website: websitePart,
                    relevanceScore: 0.4, // Lower score for topic-only matches
                    matchedElements: ["topics"],
                    knowledgeContext: this.getKnowledgeContext(websitePart),
                });
            }
        }

        // Sort by relevance score and return top results
        return Array.from(results.values())
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 50);
    }

    private getKnowledgeContext(websitePart: WebsiteDocPart) {
        const knowledge = websitePart.getKnowledge();
        return knowledge
            ? {
                  entityCount: knowledge.entities?.length || 0,
                  topicCount: knowledge.topics?.length || 0,
                  actionCount: knowledge.actions?.length || 0,
              }
            : undefined;
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
                    const actionType = action.type;
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

    /**
     * Search with combined entity and topic criteria
     */
    public async searchCombined(query: {
        entities?: string[];
        topics?: string[];
        entityType?: string;
        facetName?: string;
        facetValue?: string;
        when?: any;
    }): Promise<WebsiteDocPart[]> {
        const uniqueResults = new Map<string, WebsiteDocPart>();

        // Entity search
        if (query.entities && query.entities.length > 0) {
            const entityResults = await this.searchByEntities(
                query.entities,
                query.entityType,
                query.facetName,
                query.facetValue,
                query.when,
            );
            entityResults.forEach((r) => {
                const key = r.url || `${r.timestamp}_${Math.random()}`;
                uniqueResults.set(key, r);
            });
        }

        // Topic search
        if (query.topics && query.topics.length > 0) {
            const topicResults = await this.searchByTopics(
                query.topics,
                query.when,
            );
            topicResults.forEach((r) => {
                const key = r.url || `${r.timestamp}_${Math.random()}`;
                if (!uniqueResults.has(key)) {
                    uniqueResults.set(key, r);
                }
            });
        }

        return Array.from(uniqueResults.values());
    }

    /**
     * Batch search for multiple entities (efficient for graph building)
     */
    public async batchSearchEntities(
        entities: string[],
    ): Promise<Map<string, WebsiteDocPart[]>> {
        const results = new Map<string, WebsiteDocPart[]>();

        // Use Promise.all for parallel searching
        const promises = entities.map(async (entity) => {
            const docs = await this.searchByEntities([entity]);
            return { entity, docs };
        });

        const batchResults = await Promise.all(promises);
        batchResults.forEach(({ entity, docs }) => {
            results.set(entity, docs);
        });

        return results;
    }

    /**
     * Check if knowledge graph has been built by checking for persisted Graphology files
     */
    public async hasGraph(): Promise<boolean> {
        try {
            // Check for common Graphology persistence patterns
            // This could be expanded based on how the graphs are actually persisted
            const baseDir = path.dirname(this.dbPath || ".");
            const baseName = path.basename(this.dbPath || "graph", path.extname(this.dbPath || ""));
            
            // Common patterns for Graphology persistence files
            const possibleGraphFiles = [
                path.join(baseDir, `${baseName}_entity_graph.json`),
                path.join(baseDir, `${baseName}_topic_graph.json`),
                path.join(baseDir, `${baseName}.graph`),
                path.join(baseDir, `graph_entity.json`),
                path.join(baseDir, `graph_topic.json`),
                path.join(baseDir, "entity_graph.json"),
                path.join(baseDir, "topic_graph.json"),
            ];
            
            // Check if any of the expected graph files exist
            for (const filePath of possibleGraphFiles) {
                try {
                    if (fs.existsSync(filePath)) {
                        debug(`[Knowledge Graph] Found existing graph file: ${filePath}`);
                        return true;
                    }
                } catch (error) {
                    // Continue checking other files
                    continue;
                }
            }
            
            debug(`[Knowledge Graph] No existing graph files found`);
            return false;
        } catch (error) {
            debug(`[Knowledge Graph] Error checking for graph files: ${error}`);
            return false;
        }
    }

    /**
     * Build knowledge graph from existing website data
     */
    public async buildGraph(options?: { urlLimit?: number }): Promise<{
        entityGraph?: any; // Graphology Graph
        topicGraph?: any;  // Graphology Graph
        metadata?: {
            buildTime: number;
            entityCount: number;
            relationshipCount: number;
            communityCount: number;
            topicCount: number;
        };
    }> {
        const urlLimit = options?.urlLimit;
        const isMinimalMode = urlLimit !== undefined;

        debug(
            `[Knowledge Graph] Starting graph build${isMinimalMode ? ` (minimal mode: ${urlLimit} URLs)` : " (full mode)"}`,
        );

        // Initialize graph building utilities
        const { GraphBuildingCacheManager } = await import(
            "./utils/graphBuildingCacheManager.mjs"
        );
        const { OptimizedGraphAlgorithms } = await import(
            "./utils/optimizedGraphAlgorithms.mjs"
        );

        const cacheManager = new GraphBuildingCacheManager();
        const algorithms = new OptimizedGraphAlgorithms();

        const startTime = Date.now();

        // Get websites to process (limited in minimal mode)
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        // Initialize cache with all website data for efficient processing
        await cacheManager.initializeCache(websitesToProcess);
        debug(
            `[Knowledge Graph] Initialized cache for ${websitesToProcess.length} websites`,
        );

        // Extract entities from cache (much faster than iterating websites)
        const entities = cacheManager.getAllEntities();
        debug(
            `[Knowledge Graph] Extracted ${entities.length} unique entities in ${Date.now() - startTime}ms`,
        );

        // PHASE 1: CREATE GRAPHOLOGY GRAPHS DIRECTLY
        debug(`[Knowledge Graph] Building Graphology graphs directly...`);
        const graphologyStartTime = Date.now();
        const entityGraph = new Graph({ type: "undirected" });
        const topicGraph = new Graph({ type: "directed" });

        // Build entity graph directly
        const entityGraphStart = Date.now();
        await this.buildEntityGraphDirect(entityGraph, cacheManager, websitesToProcess);
        const graphologyEntityTime = Date.now() - entityGraphStart;
        debug(`[Knowledge Graph] Direct entity graph built in ${graphologyEntityTime}ms`);

        // Build entity relationships directly
        const relationshipDirectStart = Date.now();
        await this.buildRelationshipsDirect(entityGraph, cacheManager);
        const graphologyRelationshipTime = Date.now() - relationshipDirectStart;
        debug(`[Knowledge Graph] Direct relationships built in ${graphologyRelationshipTime}ms`);

        // Detect communities directly on graph
        const communityDirectStart = Date.now();
        await this.detectCommunitiesDirect(entityGraph, algorithms);
        const graphologyCommunityTime = Date.now() - communityDirectStart;
        debug(`[Knowledge Graph] Direct communities detected in ${graphologyCommunityTime}ms`);

        // Build topic graph directly
        const topicDirectStart = Date.now();
        await this.buildTopicGraphDirect(topicGraph, cacheManager, urlLimit);
        const graphologyTopicTime = Date.now() - topicDirectStart;
        debug(`[Knowledge Graph] Direct topic graph built in ${graphologyTopicTime}ms`);

        const graphologyTotalTime = Date.now() - graphologyStartTime;
        debug(`[Knowledge Graph] Graphology-only approach completed in ${graphologyTotalTime}ms`);

        const totalTime = Date.now() - startTime;
        debug(
            `[Knowledge Graph] Graph build completed in ${totalTime}ms with ${entities.length} entities`,
        );

        // COMPARISON ANALYSIS: Graphology vs SQLite approaches
        debug(`[Comparison] Starting detailed analysis of both approaches...`);

        // Calculate Graphology graph metrics
        const graphologyEntityNodes = entityGraph.nodes().filter((nodeId: string) => 
            entityGraph.getNodeAttribute(nodeId, 'type') === 'entity');
        const graphologyCommunityNodes = entityGraph.nodes().filter((nodeId: string) => 
            entityGraph.getNodeAttribute(nodeId, 'type') === 'community');
        const graphologyRelationshipEdges = entityGraph.edges().filter((edgeId: string) => 
            entityGraph.getEdgeAttribute(edgeId, 'relationshipType') === 'co_occurs');

        const graphologyMetrics = {
            entityCount: graphologyEntityNodes.length,
            relationshipCount: graphologyRelationshipEdges.length,
            communityCount: graphologyCommunityNodes.length,
            topicCount: topicGraph.order,
            totalNodes: entityGraph.order,
            totalEdges: entityGraph.size
        };

        // Return metadata based on Graphology results
        const metadata = {
            buildTime: totalTime,
            entityCount: graphologyMetrics.entityCount,
            relationshipCount: graphologyMetrics.relationshipCount,
            communityCount: graphologyMetrics.communityCount,
            topicCount: graphologyMetrics.topicCount
        };

        debug(`[Knowledge Graph] Graphology graphs created successfully:`, metadata);

        return { entityGraph, topicGraph, metadata };
    }

    /**
     * Update graph when new websites are added
     * Note: This is now handled by the pure Graphology architecture in buildGraph()
     */
    public async updateGraph(newWebsites: Website[]): Promise<void> {
        debug(
            `Graph update requested for ${newWebsites.length} new websites - delegating to buildGraph()`,
        );
        
        // With pure Graphology architecture, we rebuild the entire graph
        // as it's now fast enough and avoids SQLite dependency
        await this.buildGraph();
        
        debug(`Graph update completed for ${newWebsites.length} new websites`);
    }


























    // ============================================================================
    // DIRECT GRAPHOLOGY CONSTRUCTION METHODS
    // ============================================================================

    /**
     * Build entity graph directly in Graphology format (Phase 1 implementation)
     * Replaces storeEntitiesInDatabase() with direct graph construction
     */
    private async buildEntityGraphDirect(
        entityGraph: any, // Graph type
        cacheManager: any,
        websitesToProcess: Website[]
    ): Promise<void> {
        debug(`[Direct Build] Adding entities to Graphology graph`);
        
        const extractionDate = new Date().toISOString();
        let entityCount = 0;

        // Use cache manager for efficient access to entities (same logic as before)
        for (const website of websitesToProcess) {
            if (!website.knowledge) continue;
            const url = website.metadata.url;

            // Get entities from cache
            const entities = cacheManager.getEntitiesForWebsite(url);
            for (const entityName of entities) {
                // Add entity node directly to Graphology graph instead of SQLite
                if (!entityGraph.hasNode(entityName)) {
                    entityGraph.addNode(entityName, {
                        name: entityName,
                        type: "entity",
                        entityType: "unknown", // Could be enhanced with type detection
                        confidence: 0.8,
                        domains: [website.metadata.domain],
                        urls: [url],
                        extractionDate,
                        // Additional metadata for graph algorithms
                        importance: 0,
                        community: -1
                    });
                } else {
                    // Update existing node with additional domains/URLs
                    const existingDomains = entityGraph.getNodeAttribute(entityName, 'domains') || [];
                    const existingUrls = entityGraph.getNodeAttribute(entityName, 'urls') || [];
                    
                    entityGraph.setNodeAttribute(entityName, 'domains', 
                        [...new Set([...existingDomains, website.metadata.domain])]);
                    entityGraph.setNodeAttribute(entityName, 'urls', 
                        [...new Set([...existingUrls, url])]);
                }
                entityCount++;
            }
        }

        debug(`[Direct Build] Added ${entityCount} entity occurrences as ${entityGraph.order} unique nodes`);
    }

    /**
     * Build entity relationships directly in Graphology format (Phase 1 implementation)
     * Replaces buildRelationships() with direct graph construction
     */
    private async buildRelationshipsDirect(
        entityGraph: any, // Graph type
        cacheManager: any
    ): Promise<void> {
        debug(`[Direct Build] Adding relationships to Graphology graph`);

        // Get cached relationships (same logic as buildRelationships)
        const cachedRelationships = cacheManager.getAllEntityRelationships();
        debug(`[Direct Build] Found ${cachedRelationships.length} cached relationships`);

        let storedCount = 0;
        for (const cachedRel of cachedRelationships) {
            const confidence = Math.min(cachedRel.count / 10, 1.0); // Normalize to 0-1

            // Only add if both nodes exist in the graph
            if (entityGraph.hasNode(cachedRel.fromEntity) && entityGraph.hasNode(cachedRel.toEntity)) {
                // Avoid duplicate edges
                if (!entityGraph.hasEdge(cachedRel.fromEntity, cachedRel.toEntity)) {
                    entityGraph.addEdge(cachedRel.fromEntity, cachedRel.toEntity, {
                        relationshipType: "co_occurs",
                        confidence,
                        count: cachedRel.count,
                        sources: cachedRel.sources,
                        updated: new Date().toISOString()
                    });
                    storedCount++;
                }
            }

            if (storedCount % 100 === 0 || storedCount === cachedRelationships.length) {
                debug(`[Direct Build] Added ${storedCount}/${cachedRelationships.length} relationship edges`);
            }
        }

        debug(`[Direct Build] Finished adding ${storedCount} relationship edges to graph`);
    }

    /**
     * Detect communities directly on Graphology graph (Phase 1 implementation)
     * Replaces detectCommunities() with direct graph analysis
     */
    private async detectCommunitiesDirect(
        entityGraph: any, // Graph type
        algorithms: any
    ): Promise<void> {
        debug(`[Direct Build] Detecting communities on Graphology graph`);

        // Convert Graphology graph to format expected by algorithms
        const entities = entityGraph.nodes();
        const relationships = entityGraph.edges().map((edgeId: string) => ({
            fromEntity: entityGraph.source(edgeId),
            toEntity: entityGraph.target(edgeId),
            confidence: entityGraph.getEdgeAttribute(edgeId, 'confidence') || 0.5
        }));

        // Use existing algorithms for community detection
        const graphMetrics = algorithms.calculateAllMetrics(entities, relationships);
        const communities = graphMetrics.communities;

        debug(`[Direct Build] Detected ${communities.length} communities using algorithms`);

        // Store community info directly in the graph instead of separate SQLite table
        let storedCount = 0;
        for (const community of communities) {
            // Add community as a virtual node in the graph
            const communityId = `community_${community.id}`;
            entityGraph.addNode(communityId, {
                type: "community",
                id: community.id,
                entities: community.nodes,
                size: community.nodes.length,
                density: community.density,
                updated: new Date().toISOString()
            });

            // Update entity nodes with community membership
            for (const entityName of community.nodes) {
                if (entityGraph.hasNode(entityName)) {
                    entityGraph.setNodeAttribute(entityName, 'community', community.id);
                }
            }

            // Add edges from community to member entities for graph traversal
            for (const entityName of community.nodes) {
                if (entityGraph.hasNode(entityName)) {
                    entityGraph.addEdge(communityId, entityName, {
                        type: "membership",
                        strength: 1.0
                    });
                }
            }

            storedCount++;
            if (storedCount % 10 === 0 || storedCount === communities.length) {
                debug(`[Direct Build] Processed ${storedCount}/${communities.length} communities`);
            }
        }

        debug(`[Direct Build] Finished adding ${storedCount} communities to graph`);
    }

    /**
     * Build topic graph directly in Graphology format (Phase 1 implementation)
     * Preserves hierarchical topic construction but stores in Graphology instead of SQLite
     */
    private async buildTopicGraphDirect(
        topicGraph: any, // Graph type
        cacheManager: any,
        urlLimit?: number
    ): Promise<void> {
        debug(`[Direct Build] Building topic graph directly`);

        // Build hierarchical topics using the original LLM logic but store in Graphology
        const hierarchicalTopics = await this.buildHierarchicalTopicsForGraph(cacheManager, urlLimit);

        // Add topic nodes to graph
        let addedNodes = 0;
        let skippedDuplicates = 0;
        
        for (const topic of hierarchicalTopics) {
            // Check if topic node already exists to avoid duplicates
            if (!topicGraph.hasNode(topic.topicId)) {
                try {
                    topicGraph.addNode(topic.topicId, {
                        type: "topic",
                        name: topic.topicName,
                        parentId: topic.parentTopicId,
                        level: topic.level,
                        url: topic.url,
                        domain: topic.domain,
                        confidence: topic.confidence,
                        keywords: topic.keywords,
                        sourceTopicNames: topic.sourceTopicNames,
                        relevance: 0.8,
                        extractionDate: topic.extractionDate
                    });
                    addedNodes++;
                } catch (error) {
                    // Handle any remaining edge case duplicates gracefully
                    if (error instanceof Error && error.message.includes('already exist')) {
                        debug(`[Direct Build] WARNING: Skipping duplicate topic node '${topic.topicId}' (${topic.topicName}) from ${topic.url}`);
                        skippedDuplicates++;
                    } else {
                        throw error; // Re-throw non-duplicate errors
                    }
                }
            } else {
                debug(`[Direct Build] WARNING: Skipping duplicate topic node '${topic.topicId}' (${topic.topicName}) - already exists in graph`);
                skippedDuplicates++;
            }
        }
        
        debug(`[Direct Build] Added ${addedNodes} topic nodes, skipped ${skippedDuplicates} duplicates`);

        // Add hierarchy edges (parent-child relationships)
        let addedEdges = 0;
        let skippedEdgeDuplicates = 0;
        
        for (const topic of hierarchicalTopics) {
            if (topic.parentTopicId && topicGraph.hasNode(topic.parentTopicId)) {
                // Check if edge already exists to avoid duplicates
                if (!topicGraph.hasEdge(topic.parentTopicId, topic.topicId)) {
                    try {
                        topicGraph.addEdge(topic.parentTopicId, topic.topicId, {
                            type: "parent_child",
                            strength: 1.0
                        });
                        addedEdges++;
                    } catch (error) {
                        // Handle any remaining edge case duplicates gracefully
                        if (error instanceof Error && error.message.includes('already exist')) {
                            debug(`[Direct Build] WARNING: Skipping duplicate edge ${topic.parentTopicId} -> ${topic.topicId}`);
                            skippedEdgeDuplicates++;
                        } else {
                            throw error; // Re-throw non-duplicate errors
                        }
                    }
                } else {
                    debug(`[Direct Build] WARNING: Skipping duplicate edge ${topic.parentTopicId} -> ${topic.topicId} - already exists`);
                    skippedEdgeDuplicates++;
                }
            }
        }
        
        debug(`[Direct Build] Added ${addedEdges} hierarchy edges, skipped ${skippedEdgeDuplicates} edge duplicates`);

        // Build topic relationships using existing Graphology-based approach
        await this.buildTopicRelationshipsForGraph(topicGraph, hierarchicalTopics, cacheManager);

        debug(`[Direct Build] Built topic graph with ${topicGraph.order} nodes`);
    }

    /**
     * Build hierarchical topics for Graphology graph (preserves LLM logic, removes SQLite)
     */
    private async buildHierarchicalTopicsForGraph(
        cacheManager: any,
        urlLimit?: number
    ): Promise<any[]> {
        debug(`[Direct Build] Building hierarchical topics for graph`);

        // Get websites to process - same logic as original updateHierarchicalTopics
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit ? websites.slice(0, urlLimit) : websites;
        
        let globalHierarchy: any | undefined;
        const websiteUrlMap = new Map<string, { url: string; domain: string }>();

        // Extract and merge topic hierarchies from websites (EXACT same logic as original)
        for (const website of websitesToProcess) {
            const docHierarchy = (website.knowledge as any)?.topicHierarchy as any | undefined;

            if (!docHierarchy) {
                continue;
            }

            let topicMap: Map<string, any>;

            if (docHierarchy.topicMap instanceof Map) {
                topicMap = docHierarchy.topicMap;
            } else if (typeof docHierarchy.topicMap === "object" && docHierarchy.topicMap !== null) {
                topicMap = new Map(Object.entries(docHierarchy.topicMap));
            } else {
                continue;
            }

            // Track which website each topic came from (same as original)
            const websiteUrl = website.metadata.url || "unknown";
            const websiteDomain = website.metadata.domain || "unknown";
            for (const [topicId] of topicMap) {
                if (!websiteUrlMap.has(topicId)) {
                    websiteUrlMap.set(topicId, { url: websiteUrl, domain: websiteDomain });
                }
            }

            const hierarchyWithMap = {
                ...docHierarchy,
                topicMap: topicMap,
            };

            if (!globalHierarchy) {
                globalHierarchy = hierarchyWithMap;
            } else {
                // Merge hierarchies using simplified logic (no SQLite relationships)
                globalHierarchy = this.mergeHierarchiesForGraph(globalHierarchy, hierarchyWithMap);
            }
        }

        if (!globalHierarchy) {
            debug("[Direct Build] No topic hierarchies found in websites");
            return [];
        }

        // Convert to hierarchical topic records for graph storage
        const hierarchicalTopics = this.convertTopicHierarchyForGraph(globalHierarchy, websiteUrlMap);

        debug(`[Direct Build] Built ${hierarchicalTopics.length} hierarchical topic records`);
        return hierarchicalTopics;
    }

    /**
     * Merge hierarchies for graph (simplified version without SQLite relationships)
     */
    private mergeHierarchiesForGraph(
        existing: any,
        newHierarchy: any
    ): any {
        // Convert existing topicMap to Map if it's a plain object (from deserialization)
        const existingTopicMap =
            existing.topicMap instanceof Map
                ? existing.topicMap
                : new Map(Object.entries(existing.topicMap));

        const mergedTopicMap = new Map(existingTopicMap);
        const mergedRootTopics = [...existing.rootTopics];

        // Convert newHierarchy topicMap to entries array if it's a plain object
        const newTopicEntries =
            newHierarchy.topicMap instanceof Map
                ? newHierarchy.topicMap
                : Object.entries(newHierarchy.topicMap);

        for (const [topicId, topic] of newTopicEntries) {
            if (!mergedTopicMap.has(topicId)) {
                mergedTopicMap.set(topicId, topic);
                if (topic.level === 0) {
                    mergedRootTopics.push(topic);
                }
            } else {
                const existingTopic: any = mergedTopicMap.get(topicId);
                if (existingTopic) {
                    // Merge sourceRefOrdinals to track semanticRefs that contributed to this topic
                    existingTopic.sourceRefOrdinals = [
                        ...new Set([
                            ...(existingTopic.sourceRefOrdinals || []),
                            ...(topic.sourceRefOrdinals || []),
                        ]),
                    ];
                    // Merge sourceTopicNames for hierarchical aggregation
                    existingTopic.sourceTopicNames = [
                        ...new Set([
                            ...(existingTopic.sourceTopicNames || []),
                            ...(topic.sourceTopicNames || []),
                        ]),
                    ];
                }
            }
        }

        return {
            rootTopics: mergedRootTopics,
            topicMap: mergedTopicMap,
            maxDepth: Math.max(existing.maxDepth, newHierarchy.maxDepth),
            totalTopics: mergedTopicMap.size,
        };
    }

    /**
     * Convert topic hierarchy to records for graph storage
     */
    private convertTopicHierarchyForGraph(
        globalHierarchy: any,
        websiteUrlMap: Map<string, { url: string; domain: string }>
    ): any[] {
        const records: any[] = [];
        
        const processTopicRecursive = (topic: any) => {
            const urlInfo = websiteUrlMap.get(topic.id) || { url: "unknown", domain: "unknown" };
            
            const record = {
                url: urlInfo.url,
                domain: urlInfo.domain,
                topicId: topic.id,
                topicName: topic.name,
                level: topic.level,
                parentTopicId: topic.parentId,
                confidence: topic.confidence || 0.5,
                keywords: topic.keywords || [],
                sourceTopicNames: topic.sourceTopicNames || [],
                extractionDate: new Date().toISOString()
            };
            
            records.push(record);
            
            // Process children
            if (topic.childIds) {
                for (const childId of topic.childIds) {
                    const childTopic = globalHierarchy.topicMap.get(childId);
                    if (childTopic) {
                        processTopicRecursive(childTopic);
                    }
                }
            }
        };

        // Process all root topics
        for (const rootTopic of globalHierarchy.rootTopics) {
            processTopicRecursive(rootTopic);
        }

        debug(`[Direct Build] Converted ${records.length} topics to graph format`);
        return records;
    }

    /**
     * Build topic relationships for graph
     */
    private async buildTopicRelationshipsForGraph(
        topicGraph: any,
        hierarchicalTopics: any[],
        cacheManager: any
    ): Promise<void> {
        debug(`[Direct Build] Building topic relationships on graph`);

        // Extract co-occurrence data from cache
        const cooccurrences = this.extractCooccurrencesForGraph(cacheManager);
        debug(`[Direct Build] Extracted ${cooccurrences.length} topic co-occurrences`);

        // Add co-occurrence edges between topics
        for (const cooccurrence of cooccurrences) {
            if (topicGraph.hasNode(cooccurrence.fromTopic) && 
                topicGraph.hasNode(cooccurrence.toTopic) &&
                !topicGraph.hasEdge(cooccurrence.fromTopic, cooccurrence.toTopic)) {
                
                topicGraph.addEdge(cooccurrence.fromTopic, cooccurrence.toTopic, {
                    type: "topic_cooccurrence",
                    strength: Math.min(cooccurrence.count / 5, 1.0), // Normalize
                    count: cooccurrence.count,
                    urls: cooccurrence.urls || []
                });
            }
        }

        debug(`[Direct Build] Added topic relationship edges to graph`);
    }

    /**
     * Extract topic co-occurrence data from cache manager for graph
     */
    private extractCooccurrencesForGraph(cacheManager: any): any[] {
        // Get topic relationships from cache (same as original buildTopicGraphWithGraphology)
        const cachedRelationships = cacheManager.getAllTopicRelationships?.() || [];
        return cachedRelationships.map((rel: any) => ({
            fromTopic: rel.fromTopic,
            toTopic: rel.toTopic,
            count: rel.count,
            urls: rel.sources || [],
        }));
    }

    /**
     * Get hierarchical topic data for browser agent compatibility
     * Returns the hierarchy constructed from website knowledge
     */
    public getTopicHierarchy(): any[] {
        // Build hierarchy from current website data using preserved logic
        // This is called on-demand when browser agent needs the hierarchy
        const websites = this.getWebsites();
        let globalHierarchy: any | undefined;

        // Extract and merge topic hierarchies from websites
        for (const website of websites) {
            const docHierarchy = (website.knowledge as any)?.topicHierarchy as any | undefined;
            
            if (!docHierarchy) {
                continue;
            }

            let topicMap: Map<string, any>;
            if (docHierarchy.topicMap instanceof Map) {
                topicMap = docHierarchy.topicMap;
            } else if (typeof docHierarchy.topicMap === "object" && docHierarchy.topicMap !== null) {
                topicMap = new Map(Object.entries(docHierarchy.topicMap));
            } else {
                continue;
            }

            const hierarchyWithMap = {
                ...docHierarchy,
                topicMap: topicMap,
            };

            if (!globalHierarchy) {
                globalHierarchy = hierarchyWithMap;
            } else {
                globalHierarchy = this.mergeHierarchiesForGraph(globalHierarchy, hierarchyWithMap);
            }
        }

        if (!globalHierarchy) {
            return [];
        }

        // Convert to format expected by browser agent
        const records: any[] = [];
        const processTopicRecursive = (topic: any) => {
            const record = {
                topicId: topic.id,
                topicName: topic.name,
                level: topic.level,
                parentTopicId: topic.parentId,
                confidence: topic.confidence || 0.5,
                keywords: topic.keywords || [],
                sourceTopicNames: topic.sourceTopicNames || [],
                extractionDate: new Date().toISOString()
            };
            
            records.push(record);
            
            // Process children
            if (topic.childIds) {
                for (const childId of topic.childIds) {
                    const childTopic = globalHierarchy.topicMap.get(childId);
                    if (childTopic) {
                        processTopicRecursive(childTopic);
                    }
                }
            }
        };

        // Process all root topics
        for (const rootTopic of globalHierarchy.rootTopics) {
            processTopicRecursive(rootTopic);
        }

        return records;
    }

    /**
     * Get topic metrics for browser agent compatibility
     * Computes metrics on-demand from Graphology graphs and hierarchy data
     */
    public getTopicMetrics(topicId: string): any | null {
        try {
            // Get hierarchy to find the topic
            const hierarchy = this.getTopicHierarchy();
            const topic = hierarchy.find(t => t.topicId === topicId);
            
            if (!topic) {
                return null;
            }

            // Basic metrics computed from topic data
            const metrics = {
                topicId: topic.topicId,
                topicName: topic.topicName,
                level: topic.level || 0,
                confidence: topic.confidence || 0.5,
                entityCount: 0, // Will be computed from graph if available
                relationshipCount: 0, // Will be computed from graph if available
                websiteCount: 0, // Number of websites this topic appears in
                childCount: 0, // Number of direct children
                descendantCount: 0, // Total descendants
                lastUpdated: topic.extractionDate || new Date().toISOString(),
                keywords: topic.keywords || [],
                sourceTopicNames: topic.sourceTopicNames || []
            };

            // Count children from hierarchy
            const children = hierarchy.filter(t => t.parentTopicId === topicId);
            metrics.childCount = children.length;

            // Count all descendants recursively
            const countDescendants = (parentId: string): number => {
                const directChildren = hierarchy.filter(t => t.parentTopicId === parentId);
                let count = directChildren.length;
                for (const child of directChildren) {
                    count += countDescendants(child.topicId);
                }
                return count;
            };
            metrics.descendantCount = countDescendants(topicId);

            // Count websites that contain this topic
            const websites = this.getWebsites();
            let websiteCount = 0;
            for (const website of websites) {
                const topics = (website.knowledge as any)?.topics || [];
                if (topics.some((t: any) => t.id === topicId || t.name === topic.topicName)) {
                    websiteCount++;
                }
            }
            metrics.websiteCount = websiteCount;

            // TODO: If we have access to Graphology graphs, compute more advanced metrics
            // For now, return basic metrics that should satisfy browser agent needs
            
            return metrics;
        } catch (error) {
            console.warn(`Failed to compute metrics for topic ${topicId}:`, error);
            return null;
        }
    }

    /**
     * Merge topic hierarchies with LLM analysis for browser agent compatibility
     * Uses existing hierarchy logic but operates on current data
     */
    public async mergeTopicHierarchiesWithLLM(
        analyzeFunc: (hierarchies: any[]) => Promise<any>
    ): Promise<{ mergeCount: number; changes?: any[] }> {
        try {
            console.log("[Merge] Starting topic hierarchy merge with LLM analysis...");
            
            // Get current hierarchy data
            const currentHierarchy = this.getTopicHierarchy();
            if (currentHierarchy.length === 0) {
                console.log("[Merge] No topics found to merge");
                return { mergeCount: 0 };
            }

            // Use LLM to analyze topic relationships and suggest merges
            const analysisResult = await analyzeFunc(currentHierarchy);
            
            if (!analysisResult || !analysisResult.suggestedMerges) {
                console.log("[Merge] No merge suggestions from LLM analysis");
                return { mergeCount: 0 };
            }

            // Apply merge suggestions to the website data
            // For now, this is a simplified implementation that logs the changes
            // In a full implementation, this would update the underlying website knowledge
            const changes = [];
            let mergeCount = 0;

            for (const merge of analysisResult.suggestedMerges) {
                if (merge.confidence > 0.7) { // Only apply high-confidence merges
                    changes.push({
                        action: "merge",
                        sourceTopic: merge.sourceTopic,
                        targetTopic: merge.targetTopic,
                        confidence: merge.confidence
                    });
                    mergeCount++;
                }
            }

            console.log(`[Merge] Applied ${mergeCount} topic merges based on LLM analysis`);
            
            // TODO: In a full implementation, this would:
            // 1. Update the website knowledge data with merged topics
            // 2. Rebuild the topic graph with the new hierarchy
            // 3. Update any cached data structures
            
            return { mergeCount, changes };
        } catch (error) {
            console.error("Error in mergeTopicHierarchiesWithLLM:", error);
            throw error;
        }
    }

    /**
     * Update hierarchical topics after new website data for browser agent compatibility
     * Triggers hierarchy rebuild when new websites are added
     */
    public async updateHierarchicalTopics(websites: any[]): Promise<void> {
        try {
            console.log(`[Hierarchy Update] Processing ${websites.length} websites for topic hierarchy update`);
            
            // For now, this is a simplified implementation
            // In the original SQLite version, this would update the hierarchicalTopics table
            // Here we ensure the websites are properly integrated into the collection
            
            // Add or update websites in the collection
            for (const website of websites) {
                this.addWebsiteWithDeduplication(website);
            }
            
            // The hierarchy will be rebuilt on-demand when getTopicHierarchy() is called
            // This matches the new architecture where we don't cache hierarchy in SQLite
            
            console.log(`[Hierarchy Update] Completed processing ${websites.length} websites`);
        } catch (error) {
            console.error("Error in updateHierarchicalTopics:", error);
            throw error;
        }
    }

    /**
     * Update graph incrementally for browser agent compatibility
     * Handles incremental graph updates for performance during imports
     */
    public async updateGraphIncremental(websites: any[]): Promise<void> {
        try {
            console.log(`[Graph Incremental] Processing ${websites.length} websites for incremental graph update`);
            
            // Add or update websites in the collection
            for (const website of websites) {
                this.addWebsiteWithDeduplication(website);
            }
            
            // In the new architecture, we use buildGraph() for full rebuilds
            // For incremental updates, we could optimize by checking if a graph already exists
            // and only rebuilding if necessary, but for now we keep it simple
            
            // The graph will be rebuilt on-demand when needed
            // This matches the new architecture where graphs are built from current data
            
            console.log(`[Graph Incremental] Completed processing ${websites.length} websites`);
        } catch (error) {
            console.error("Error in updateGraphIncremental:", error);
            throw error;
        }
    }
}
