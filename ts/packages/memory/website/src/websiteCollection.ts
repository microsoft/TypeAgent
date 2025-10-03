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
    RelationshipTable,
    CommunityTable,
    Relationship,
    HierarchicalTopicTable,
    TopicEntityRelationTable,
} from "./tables.js";
import { Website, WebsiteMeta } from "./websiteMeta.js";
import { WebsiteDocPart } from "./websiteDocPart.js";
import path from "node:path";
import fs from "node:fs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:memory:websiteCollection");

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
    public relationships!: RelationshipTable;
    public communities!: CommunityTable;
    public hierarchicalTopics!: HierarchicalTopicTable;
    public topicEntityRelations!: TopicEntityRelationTable;

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
        this.relationships = new RelationshipTable(this.db);
        this.communities = new CommunityTable(this.db);
        this.hierarchicalTopics = new HierarchicalTopicTable(this.db);
        this.topicEntityRelations = new TopicEntityRelationTable(this.db);

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
            [this.relationships.name, this.relationships],
            [this.communities.name, this.communities],
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
        options?: any,
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
     * Check if knowledge graph has been built
     */
    public async hasGraph(): Promise<boolean> {
        try {
            const stmt = this.db!.prepare(
                "SELECT COUNT(*) as count FROM relationships LIMIT 1",
            );
            const result = stmt.get() as { count: number };
            return result.count > 0;
        } catch {
            return false;
        }
    }

    /**
     * Build knowledge graph from existing website data
     */
    public async buildGraph(options?: { urlLimit?: number }): Promise<void> {
        const urlLimit = options?.urlLimit;
        const isMinimalMode = urlLimit !== undefined;

        debug(
            `[Knowledge Graph] Starting graph build${isMinimalMode ? ` (minimal mode: ${urlLimit} URLs)` : " (full mode)"}`,
        );
        const startTime = Date.now();

        // Extract entities from websites (limited in minimal mode)
        const entities = await this.extractEntities(urlLimit);
        debug(
            `[Knowledge Graph] Extracted ${entities.length} unique entities in ${Date.now() - startTime}ms`,
        );

        // Store entities in knowledge entities table
        await this.storeEntitiesInDatabase(entities, urlLimit);
        debug(`[Knowledge Graph] Stored entities in database`);

        // Build relationships between entities
        const relationshipStartTime = Date.now();
        await this.buildRelationships(entities, urlLimit);
        debug(
            `[Knowledge Graph] Built relationships in ${Date.now() - relationshipStartTime}ms`,
        );

        // Detect communities
        const communityStartTime = Date.now();
        await this.detectCommunities(entities);
        debug(
            `[Knowledge Graph] Detected communities in ${Date.now() - communityStartTime}ms`,
        );

        // Build hierarchical topics from flat topics
        const topicStartTime = Date.now();
        await this.buildHierarchicalTopics(urlLimit);
        debug(
            `[Knowledge Graph] Built hierarchical topics in ${Date.now() - topicStartTime}ms`,
        );

        const totalTime = Date.now() - startTime;
        debug(
            `[Knowledge Graph] Graph build completed in ${totalTime}ms with ${entities.length} entities`,
        );
    }

    /**
     * Update graph when new websites are added
     */
    public async updateGraph(newWebsites: Website[]): Promise<void> {
        debug(
            `Updating knowledge graph with ${newWebsites.length} new websites`,
        );

        for (const website of newWebsites) {
            if (website.knowledge?.entities) {
                await this.processWebsite(website);
            }
        }

        const entityCount = await this.getEntityCount();
        if (this.shouldRecomputeCommunities(entityCount)) {
            await this.recomputeCommunities();
        }

        // Update hierarchical topics with new website topics
        await this.updateHierarchicalTopics(newWebsites);
    }

    /**
     * Extract all unique entities from the website collection
     */
    private async extractEntities(urlLimit?: number): Promise<string[]> {
        const entities = new Set<string>();

        // Get websites to process (limited in minimal mode)
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        debug(
            `[Knowledge Graph] Extracting entities from ${websitesToProcess.length} of ${websites.length} websites`,
        );

        let processedCount = 0;
        for (const website of websitesToProcess) {
            processedCount++;
            if (
                processedCount % 20 === 0 ||
                processedCount === websitesToProcess.length
            ) {
                debug(
                    `[Knowledge Graph] Entity extraction progress: ${processedCount}/${websitesToProcess.length} websites`,
                );
            }

            if (website.knowledge?.entities) {
                for (const entity of website.knowledge.entities) {
                    entities.add(entity.name);
                }
            }
        }

        debug(`[Knowledge Graph] Found ${entities.size} unique entities`);
        return Array.from(entities);
    }

    /**
     * Store entities and topics in database tables
     */
    private async storeEntitiesInDatabase(
        entities: string[],
        urlLimit?: number,
    ): Promise<void> {
        debug(`[Knowledge Graph] Storing entities and topics in database...`);

        // Get websites to process (same limitation as entity extraction)
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        const extractionDate = new Date().toISOString();
        let entityCount = 0;
        let topicCount = 0;

        for (const website of websitesToProcess) {
            if (!website.knowledge) continue;

            // Store entities
            if (website.knowledge.entities) {
                for (const entity of website.knowledge.entities) {
                    const sourceRef = {
                        range: {
                            start: { messageOrdinal: 0, chunkOrdinal: 0 },
                            end: { messageOrdinal: 0, chunkOrdinal: 0 },
                        },
                    };

                    const entityRow = {
                        sourceRef,
                        record: {
                            url: website.metadata.url,
                            domain: website.metadata.domain,
                            entityName: entity.name,
                            entityType: Array.isArray(entity.type)
                                ? entity.type.join(",")
                                : entity.type || "unknown",
                            confidence: 0.8, // Use default confidence since entity.confidence doesn't exist
                            extractionDate,
                        },
                    };

                    await this.knowledgeEntities.addRows(entityRow);
                    entityCount++;
                }
            }

            // Store topics
            if (website.knowledge.topics) {
                for (const topic of website.knowledge.topics) {
                    const topicName =
                        typeof topic === "string" ? topic : (topic as any).name;
                    const relevance =
                        typeof topic === "string"
                            ? 0.8
                            : (topic as any).relevance || 0.8;

                    if (topicName) {
                        const sourceRef = {
                            range: {
                                start: { messageOrdinal: 0, chunkOrdinal: 0 },
                                end: { messageOrdinal: 0, chunkOrdinal: 0 },
                            },
                        };

                        const topicRow = {
                            sourceRef,
                            record: {
                                url: website.metadata.url,
                                domain: website.metadata.domain,
                                topic: topicName,
                                relevance,
                                extractionDate,
                            },
                        };

                        await this.knowledgeTopics.addRows(topicRow);
                        topicCount++;
                    }
                }
            }
        }

        debug(
            `[Knowledge Graph] Stored ${entityCount} entity records and ${topicCount} topic records`,
        );
    }

    /**
     * Build entity relationships based on co-occurrence
     */
    private async buildRelationships(
        entities: string[],
        urlLimit?: number,
    ): Promise<void> {
        const relationships = new Map<string, Relationship>();

        // Get websites to process (limited in minimal mode)
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        debug(
            `[Knowledge Graph] Building relationships from ${websitesToProcess.length} websites`,
        );

        let processedCount = 0;
        let relationshipCount = 0;

        // Find entity co-occurrences in websites
        for (const website of websitesToProcess) {
            processedCount++;
            if (
                processedCount % 20 === 0 ||
                processedCount === websitesToProcess.length
            ) {
                debug(
                    `[Knowledge Graph] Relationship building progress: ${processedCount}/${websitesToProcess.length} websites, ${relationshipCount} relationships found`,
                );
            }
            if (!website.knowledge?.entities) continue;

            const websiteEntities = website.knowledge.entities.map(
                (e) => e.name,
            );

            // Build pairs of co-occurring entities
            for (let i = 0; i < websiteEntities.length; i++) {
                for (let j = i + 1; j < websiteEntities.length; j++) {
                    const entityA = websiteEntities[i];
                    const entityB = websiteEntities[j];
                    const key = `${entityA}|${entityB}`;

                    if (!relationships.has(key)) {
                        relationships.set(key, {
                            fromEntity: entityA,
                            toEntity: entityB,
                            relationshipType: "co_occurs",
                            confidence: 0,
                            sources: JSON.stringify([]),
                            count: 0,
                            updated: new Date().toISOString(),
                        });
                        relationshipCount++;
                    }

                    const rel = relationships.get(key)!;
                    rel.count++;
                    const existingSources = new Set(
                        JSON.parse(rel.sources || "[]"),
                    );
                    existingSources.add(website.metadata.url);
                    rel.sources = JSON.stringify(Array.from(existingSources));
                }
            }
        }

        debug(
            `[Knowledge Graph] Found ${relationships.size} unique relationships from ${processedCount} websites`,
        );

        // Calculate confidence scores and store relationships
        debug(`[Knowledge Graph] Storing relationships in database...`);
        let storedCount = 0;
        for (const [, rel] of relationships) {
            rel.confidence = Math.min(rel.count / 10, 1.0); // Normalize to 0-1
            storedCount++;

            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };
            const relationshipRow: dataFrame.DataFrameRow = {
                sourceRef,
                record: rel as any,
            };
            await this.relationships.addRows(relationshipRow);

            if (storedCount % 100 === 0 || storedCount === relationships.size) {
                debug(
                    `[Knowledge Graph] Stored ${storedCount}/${relationships.size} relationships`,
                );
            }
        }
        debug(
            `[Knowledge Graph] Finished storing ${storedCount} relationships`,
        );
    }

    /**
     * Detect and store communities using simple clustering
     */
    private async detectCommunities(entities: string[]): Promise<void> {
        debug(
            `[Knowledge Graph] Starting community detection for ${entities.length} entities`,
        );

        // Simple community detection based on relationship density
        // For now, group entities that appear together frequently
        const communities = await this.runCommunityDetection(entities);

        debug(`[Knowledge Graph] Detected ${communities.length} communities`);

        let storedCount = 0;
        for (const community of communities) {
            storedCount++;
            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };
            const communityRow: dataFrame.DataFrameRow = {
                sourceRef,
                record: {
                    id: community.id,
                    entities: JSON.stringify(community.entities),
                    topics: JSON.stringify(community.topics),
                    size: community.entities.length,
                    density: community.density,
                    updated: new Date().toISOString(),
                } as any,
            };
            await this.communities.addRows(communityRow);

            if (storedCount % 10 === 0 || storedCount === communities.length) {
                debug(
                    `[Knowledge Graph] Stored ${storedCount}/${communities.length} communities`,
                );
            }
        }
        debug(`[Knowledge Graph] Finished storing ${storedCount} communities`);
    }

    /**
     * Simple community detection algorithm
     */
    private async runCommunityDetection(entities: string[]): Promise<
        Array<{
            id: string;
            entities: string[];
            topics: string[];
            density: number;
        }>
    > {
        debug(`[Knowledge Graph] Running community detection algorithm...`);

        // For now, implement a simple clustering based on co-occurrence strength
        const communities: Array<{
            id: string;
            entities: string[];
            topics: string[];
            density: number;
        }> = [];

        // Group entities that have strong relationships (confidence > 0.5)
        const strongRelationships = await this.getStrongRelationships();
        debug(
            `[Knowledge Graph] Found ${strongRelationships.length} strong relationships for clustering`,
        );

        const processed = new Set<string>();
        let communityId = 0;

        for (const entity of entities) {
            if (processed.has(entity)) continue;

            const community = {
                id: `community_${communityId++}`,
                entities: [entity],
                topics: await this.getTopicsForEntity(entity),
                density: 0,
            };

            // Find strongly connected entities
            const connected = this.findConnectedEntities(
                entity,
                strongRelationships,
            );
            for (const connectedEntity of connected) {
                if (!processed.has(connectedEntity)) {
                    community.entities.push(connectedEntity);
                    processed.add(connectedEntity);
                }
            }

            processed.add(entity);
            community.density = this.calculateCommunityDensity(
                community.entities,
                strongRelationships,
            );

            if (community.entities.length > 1) {
                // Only add communities with multiple entities
                communities.push(community);
            }
        }

        return communities;
    }

    /**
     * Get relationships with high confidence scores
     */
    private async getStrongRelationships(): Promise<Relationship[]> {
        const stmt = this.db!.prepare(`
            SELECT * FROM relationships 
            WHERE confidence > 0.5
            ORDER BY confidence DESC
        `);
        return stmt.all() as Relationship[];
    }

    /**
     * Find entities connected to a given entity
     */
    private findConnectedEntities(
        entity: string,
        relationships: Relationship[],
    ): string[] {
        const connected = new Set<string>();

        for (const rel of relationships) {
            if (rel.fromEntity === entity) {
                connected.add(rel.toEntity);
            } else if (rel.toEntity === entity) {
                connected.add(rel.fromEntity);
            }
        }

        return Array.from(connected);
    }

    /**
     * Calculate community density
     */
    private calculateCommunityDensity(
        entities: string[],
        relationships: Relationship[],
    ): number {
        if (entities.length < 2) return 0;

        const maxPossibleEdges = (entities.length * (entities.length - 1)) / 2;
        let actualEdges = 0;

        for (const rel of relationships) {
            if (
                entities.includes(rel.fromEntity) &&
                entities.includes(rel.toEntity)
            ) {
                actualEdges++;
            }
        }

        return actualEdges / maxPossibleEdges;
    }

    /**
     * Get topics associated with an entity
     */
    private async getTopicsForEntity(entity: string): Promise<string[]> {
        const topics = new Set<string>();

        for (const website of this.getWebsites()) {
            if (website.knowledge?.entities?.some((e) => e.name === entity)) {
                if (website.knowledge.topics) {
                    for (const topic of website.knowledge.topics) {
                        const topicName =
                            typeof topic === "string"
                                ? topic
                                : (topic as any).name;
                        if (topicName) {
                            topics.add(topicName);
                        }
                    }
                }
            }
        }

        return Array.from(topics);
    }

    /**
     * Process a single website for graph updates
     */
    private async processWebsite(website: Website): Promise<void> {
        if (!website.knowledge?.entities) return;

        const entities = website.knowledge.entities.map((e) => e.name);

        // Add new relationships for this website
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                await this.addOrUpdateRelationship(
                    entities[i],
                    entities[j],
                    website.metadata.url,
                );
            }
        }
    }

    /**
     * Add or update a relationship between two entities
     */
    private async addOrUpdateRelationship(
        entityA: string,
        entityB: string,
        sourceUrl: string,
    ): Promise<void> {
        // Check if relationship already exists
        const existing = await this.relationships
            .getNeighbors(entityA)
            .find(
                (rel) =>
                    (rel.fromEntity === entityA && rel.toEntity === entityB) ||
                    (rel.fromEntity === entityB && rel.toEntity === entityA),
            );

        if (existing) {
            // Update existing relationship
            existing.count++;
            const existingSources = new Set(
                JSON.parse(existing.sources || "[]"),
            );
            existingSources.add(sourceUrl);
            existing.sources = JSON.stringify(Array.from(existingSources));
            existing.confidence = Math.min(existing.count / 10, 1.0);
            existing.updated = new Date().toISOString();

            // Update in database
            const stmt = this.db!.prepare(`
                UPDATE relationships 
                SET count = ?, sources = ?, confidence = ?, updated = ?
                WHERE (fromEntity = ? AND toEntity = ?) OR (fromEntity = ? AND toEntity = ?)
            `);
            stmt.run(
                existing.count,
                existing.sources,
                existing.confidence,
                existing.updated,
                entityA,
                entityB,
                entityB,
                entityA,
            );
        } else {
            // Create new relationship
            const newRel: Relationship = {
                fromEntity: entityA,
                toEntity: entityB,
                relationshipType: "co_occurs",
                confidence: 0.1, // Starting confidence
                sources: JSON.stringify([sourceUrl]),
                count: 1,
                updated: new Date().toISOString(),
            };

            const sourceRef: dataFrame.RowSourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };
            const newRelRow: dataFrame.DataFrameRow = {
                sourceRef,
                record: newRel as any,
            };
            await this.relationships.addRows(newRelRow);
        }
    }

    /**
     * Get current entity count
     */
    private async getEntityCount(): Promise<number> {
        const entities = await this.extractEntities(undefined);
        return entities.length;
    }

    /**
     * Determine if communities should be recomputed
     */
    private shouldRecomputeCommunities(entityCount: number): boolean {
        // Recompute if we've added more than 20% new entities
        // This is a simple heuristic - could be made more sophisticated
        return entityCount % 20 === 0; // Recompute every 20 entities for simplicity
    }

    /**
     * Recompute all communities
     */
    private async recomputeCommunities(): Promise<void> {
        // Clear existing communities
        const clearStmt = this.db!.prepare("DELETE FROM communities");
        clearStmt.run();

        // Rebuild communities
        const entities = await this.extractEntities(undefined);
        await this.detectCommunities(entities);
    }

    /**
     * Build hierarchical topics from flat topics using mergeTopics
     * Follows the same pattern as buildRelationships
     */
    private async buildHierarchicalTopics(urlLimit?: number): Promise<void> {
        debug(`[Knowledge Graph] Building hierarchical topics...`);
        const startTime = Date.now();

        try {
            // Extract all unique topics from websites
            const flatTopics = await this.extractFlatTopics(urlLimit);
            debug(
                `[Knowledge Graph] Extracted ${flatTopics.length} unique topics`,
            );

            if (flatTopics.length === 0) {
                debug(`[Knowledge Graph] No topics found to build hierarchy`);
                return;
            }

            // Clear existing hierarchical topics for rebuild
            if (this.hierarchicalTopics) {
                const clearStmt = this.db!.prepare(
                    "DELETE FROM hierarchicalTopics",
                );
                clearStmt.run();
                debug(`[Knowledge Graph] Cleared existing hierarchical topics`);
            }

            // Create topic extractor if available
            const kpLib = await import("knowledge-processor");
            const ai = await import("aiclient");

            let topicExtractor: any;
            try {
                // Try to create AI model for topic merging
                const apiSettings = ai.openai.azureApiSettingsFromEnv(
                    ai.openai.ModelType.Chat,
                    undefined,
                    "GPT_4_O_MINI",
                );
                const languageModel = ai.openai.createChatModel(apiSettings);
                topicExtractor =
                    kpLib.conversation.createTopicExtractor(languageModel);
            } catch (error) {
                debug(
                    `[Knowledge Graph] AI model not available for topic merging: ${error}`,
                );
                // Fall back to simple hierarchical grouping
                await this.buildSimpleTopicHierarchy(flatTopics, urlLimit);
                return;
            }

            // Use AI to merge topics into higher-level topics
            const mergeResult = await topicExtractor.mergeTopics(
                flatTopics,
                undefined, // No past topics for initial build
                "comprehensive, hierarchical",
            );

            if (mergeResult && mergeResult.status === "Success") {
                // Store the merged topic as root
                const rootTopicId = this.generateTopicId(mergeResult.topic, 0);
                await this.storeHierarchicalTopic(
                    {
                        topicId: rootTopicId,
                        topicName: mergeResult.topic,
                        level: 0,
                        confidence: 0.9,
                        keywords: [mergeResult.topic],
                    },
                    urlLimit,
                );

                // Organize flat topics under the root
                await this.organizeTopicsUnderRoot(
                    flatTopics,
                    rootTopicId,
                    urlLimit,
                );
            } else {
                // Fall back to simple hierarchy if merging fails
                debug(
                    `[Knowledge Graph] Topic merging failed, using simple hierarchy`,
                );
                await this.buildSimpleTopicHierarchy(flatTopics, urlLimit);
            }

            debug(
                `[Knowledge Graph] Hierarchical topics built in ${Date.now() - startTime}ms`,
            );
        } catch (error) {
            debug(
                `[Knowledge Graph] Error building hierarchical topics: ${error}`,
            );
            // Continue without failing the entire graph build
        }
    }

    /**
     * Update hierarchical topics when new websites are added
     */
    private async updateHierarchicalTopics(
        newWebsites: Website[],
    ): Promise<void> {
        debug(
            `[Knowledge Graph] Updating hierarchical topics with ${newWebsites.length} new websites`,
        );

        // Extract topics from new websites
        const newTopics: string[] = [];
        for (const website of newWebsites) {
            if (website.knowledge?.topics) {
                for (const topic of website.knowledge.topics) {
                    const topicName =
                        typeof topic === "string" ? topic : (topic as any).name;
                    if (topicName && !newTopics.includes(topicName)) {
                        newTopics.push(topicName);
                    }
                }
            }
        }

        if (newTopics.length === 0) {
            return;
        }

        debug(
            `[Knowledge Graph] Found ${newTopics.length} new topics to integrate`,
        );

        // Try to integrate new topics into existing hierarchy
        try {
            const kpLib = await import("knowledge-processor");
            const ai = await import("aiclient");

            const apiSettings = ai.openai.azureApiSettingsFromEnv(
                ai.openai.ModelType.Chat,
                undefined,
                "GPT_4_O_MINI",
            );
            const languageModel = ai.openai.createChatModel(apiSettings);
            const topicExtractor =
                kpLib.conversation.createTopicExtractor(languageModel);

            // Get existing root topics
            const rootTopics = this.hierarchicalTopics.getRootTopics();
            const existingTopicNames = rootTopics.map((t) => t.topicName);

            // Merge new topics with existing
            const mergeResult = await topicExtractor.mergeTopics(
                newTopics,
                existingTopicNames as any, // Past topics - facets parameter is optional
            );

            if (mergeResult && mergeResult.status === "Success") {
                // Find or create appropriate parent
                let parentId: string | undefined;
                for (const rootTopic of rootTopics) {
                    if (
                        this.topicsRelated(
                            rootTopic.topicName,
                            mergeResult.topic,
                        )
                    ) {
                        parentId = rootTopic.topicId;
                        break;
                    }
                }

                if (!parentId) {
                    // Create new root if no suitable parent found
                    parentId = this.generateTopicId(mergeResult.topic, 0);
                    await this.storeHierarchicalTopic({
                        topicId: parentId,
                        topicName: mergeResult.topic,
                        level: 0,
                        confidence: 0.8,
                        keywords: [mergeResult.topic],
                    });
                }

                // Add new topics as children
                for (const topic of newTopics) {
                    const childId = this.generateTopicId(topic, 1);
                    await this.storeHierarchicalTopic({
                        topicId: childId,
                        topicName: topic,
                        level: 1,
                        parentTopicId: parentId,
                        confidence: 0.7,
                        keywords: [topic],
                    });
                }
            }
        } catch (error) {
            debug(
                `[Knowledge Graph] Error updating hierarchical topics: ${error}`,
            );
        }
    }

    /**
     * Update knowledge graph incrementally with new websites
     */
    public async updateGraphIncremental(newWebsites: Website[]): Promise<void> {
        if (newWebsites.length === 0) return;

        debug(
            `[Knowledge Graph] Updating graph incrementally with ${newWebsites.length} new websites`,
        );
        const startTime = Date.now();

        try {
            const newEntities =
                await this.extractEntitiesFromWebsites(newWebsites);

            if (newEntities.length > 0) {
                await this.updateRelationships(newEntities);
            }

            await this.updateHierarchicalTopics(newWebsites);

            const totalEntityCount = (await this.extractEntities()).length;
            if (this.shouldRecomputeCommunities(totalEntityCount)) {
                await this.recomputeCommunities();
            }

            debug(
                `[Knowledge Graph] Incremental update completed in ${Date.now() - startTime}ms`,
            );
        } catch (error) {
            debug(`[Knowledge Graph] Error in incremental update: ${error}`);
        }
    }

    /**
     * Extract entities from specific websites
     */
    private async extractEntitiesFromWebsites(
        websites: Website[],
    ): Promise<string[]> {
        const entities = new Set<string>();

        for (const website of websites) {
            if (website.knowledge?.entities) {
                for (const entity of website.knowledge.entities) {
                    entities.add(entity.name);
                }
            }
        }

        return Array.from(entities);
    }

    /**
     * Update entity relationships for new entities
     */
    private async updateRelationships(newEntities: string[]): Promise<void> {
        if (!this.relationships || newEntities.length === 0) return;

        debug(
            `[Knowledge Graph] Updating relationships for ${newEntities.length} new entities`,
        );

        const websites = this.getWebsites();
        const coOccurrences = new Map<string, Map<string, number>>();

        for (const website of websites) {
            if (!website.knowledge?.entities) continue;

            const pageEntities = website.knowledge.entities
                .map((e) => e.name)
                .filter(
                    (name) =>
                        newEntities.includes(name) ||
                        this.hasExistingEntity(name),
                );

            for (let i = 0; i < pageEntities.length; i++) {
                for (let j = i + 1; j < pageEntities.length; j++) {
                    const entity1 = pageEntities[i];
                    const entity2 = pageEntities[j];

                    if (!coOccurrences.has(entity1)) {
                        coOccurrences.set(entity1, new Map());
                    }
                    const entity1Map = coOccurrences.get(entity1)!;
                    entity1Map.set(entity2, (entity1Map.get(entity2) || 0) + 1);

                    if (!coOccurrences.has(entity2)) {
                        coOccurrences.set(entity2, new Map());
                    }
                    const entity2Map = coOccurrences.get(entity2)!;
                    entity2Map.set(entity1, (entity2Map.get(entity1) || 0) + 1);
                }
            }
        }

        for (const [entity1, relationMap] of coOccurrences) {
            for (const [entity2, count] of relationMap) {
                if (count >= 2) {
                    const strength = Math.min(count / 10, 1.0);
                    await this.storeRelationship(entity1, entity2, strength);
                }
            }
        }
    }

    /**
     * Check if entity exists in current relationships
     */
    private hasExistingEntity(entityName: string): boolean {
        if (!this.relationships) return false;

        try {
            const checkStmt = this.db!.prepare(
                "SELECT COUNT(*) as count FROM relationships WHERE sourceEntity = ? OR targetEntity = ? LIMIT 1",
            );
            const result = checkStmt.get(entityName, entityName) as {
                count: number;
            };
            return result.count > 0;
        } catch (error) {
            debug(
                `[Knowledge Graph] Error checking entity existence: ${error}`,
            );
            return false;
        }
    }

    /**
     * Store a relationship in the database
     */
    private async storeRelationship(
        entity1: string,
        entity2: string,
        strength: number,
    ): Promise<void> {
        if (!this.relationships) return;

        try {
            const sourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };

            const relationshipRow = {
                sourceRef,
                record: {
                    sourceEntity: entity1,
                    targetEntity: entity2,
                    relationshipType: "co-occurrence",
                    strength: strength,
                    extractionDate: new Date().toISOString(),
                },
            };

            await this.relationships.addRows(relationshipRow);
        } catch (error) {
            debug(`[Knowledge Graph] Error storing relationship: ${error}`);
        }
    }

    /**
     * Extract flat topics from websites
     */
    private async extractFlatTopics(urlLimit?: number): Promise<string[]> {
        const topics = new Set<string>();

        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        for (const website of websitesToProcess) {
            if (website.knowledge?.topics) {
                for (const topic of website.knowledge.topics) {
                    const topicName =
                        typeof topic === "string" ? topic : (topic as any).name;
                    if (topicName) {
                        topics.add(topicName);
                    }
                }
            }
        }

        return Array.from(topics);
    }

    /**
     * Build a simple topic hierarchy when AI is not available
     */
    private async buildSimpleTopicHierarchy(
        topics: string[],
        urlLimit?: number,
    ): Promise<void> {
        debug(
            `[Knowledge Graph] Building simple topic hierarchy for ${topics.length} topics`,
        );

        // Group topics by common prefixes or similarity
        const topicGroups = this.groupTopicsBySimpleSimilarity(topics);

        // Create root topics for each group
        let groupIndex = 0;
        for (const [groupName, groupTopics] of topicGroups.entries()) {
            const rootId = this.generateTopicId(groupName, 0);

            // Store root topic
            await this.storeHierarchicalTopic(
                {
                    topicId: rootId,
                    topicName: groupName,
                    level: 0,
                    confidence: 0.7,
                    keywords: [groupName],
                },
                urlLimit,
            );

            // Store child topics
            for (const topic of groupTopics) {
                const childId = this.generateTopicId(topic, 1);
                await this.storeHierarchicalTopic(
                    {
                        topicId: childId,
                        topicName: topic,
                        level: 1,
                        parentTopicId: rootId,
                        confidence: 0.6,
                        keywords: [topic],
                    },
                    urlLimit,
                );
            }

            groupIndex++;
        }
    }

    /**
     * Organize flat topics under a root topic
     */
    private async organizeTopicsUnderRoot(
        topics: string[],
        rootTopicId: string,
        urlLimit?: number,
    ): Promise<void> {
        // Group similar topics
        const groups = this.groupTopicsBySimpleSimilarity(topics);

        // Create intermediate level if there are many groups
        if (groups.size > 5) {
            // Create intermediate categories
            for (const [groupName, groupTopics] of groups.entries()) {
                const intermediateId = this.generateTopicId(groupName, 1);

                // Store intermediate topic
                await this.storeHierarchicalTopic(
                    {
                        topicId: intermediateId,
                        topicName: groupName,
                        level: 1,
                        parentTopicId: rootTopicId,
                        confidence: 0.7,
                        keywords: [groupName],
                    },
                    urlLimit,
                );

                // Store leaf topics
                for (const topic of groupTopics) {
                    const leafId = this.generateTopicId(topic, 2);
                    await this.storeHierarchicalTopic(
                        {
                            topicId: leafId,
                            topicName: topic,
                            level: 2,
                            parentTopicId: intermediateId,
                            confidence: 0.6,
                            keywords: [topic],
                        },
                        urlLimit,
                    );
                }
            }
        } else {
            // Add all topics directly under root
            for (const topic of topics) {
                const childId = this.generateTopicId(topic, 1);
                await this.storeHierarchicalTopic(
                    {
                        topicId: childId,
                        topicName: topic,
                        level: 1,
                        parentTopicId: rootTopicId,
                        confidence: 0.6,
                        keywords: [topic],
                    },
                    urlLimit,
                );
            }
        }
    }

    /**
     * Store a hierarchical topic in the database
     */
    private async storeHierarchicalTopic(
        topic: {
            topicId: string;
            topicName: string;
            level: number;
            parentTopicId?: string;
            confidence: number;
            keywords: string[];
        },
        urlLimit?: number,
    ): Promise<void> {
        // Get a sample URL and domain from processed websites
        const websites = this.getWebsites();
        const websitesToProcess = urlLimit
            ? websites.slice(0, urlLimit)
            : websites;

        const sampleWebsite = websitesToProcess[0];
        const url = sampleWebsite?.metadata?.url || "unknown";
        const domain = sampleWebsite?.metadata?.domain || "unknown";

        const sourceRef: dataFrame.RowSourceRef = {
            range: {
                start: { messageOrdinal: 0, chunkOrdinal: 0 },
                end: { messageOrdinal: 0, chunkOrdinal: 0 },
            },
        };

        const topicRow = {
            sourceRef,
            record: {
                url,
                domain,
                topicId: topic.topicId,
                topicName: topic.topicName,
                level: topic.level,
                parentTopicId: topic.parentTopicId,
                confidence: topic.confidence,
                keywords: JSON.stringify(topic.keywords),
                extractionDate: new Date().toISOString(),
            },
        };

        await this.hierarchicalTopics.addRows(topicRow);
    }

    /**
     * Group topics by simple similarity (prefix matching, common words)
     */
    private groupTopicsBySimpleSimilarity(
        topics: string[],
    ): Map<string, string[]> {
        const groups = new Map<string, string[]>();

        // Simple grouping by first word or common patterns
        for (const topic of topics) {
            const words = topic.split(/\s+/);
            const firstWord = words[0]?.toLowerCase() || "general";

            // Use first word as group key, or create general group
            let groupKey = firstWord.length > 3 ? firstWord : "general";

            // Special grouping for common categories
            if (
                topic.toLowerCase().includes("technology") ||
                topic.toLowerCase().includes("tech")
            ) {
                groupKey = "technology";
            } else if (
                topic.toLowerCase().includes("business") ||
                topic.toLowerCase().includes("company")
            ) {
                groupKey = "business";
            } else if (
                topic.toLowerCase().includes("science") ||
                topic.toLowerCase().includes("research")
            ) {
                groupKey = "science";
            } else if (
                topic.toLowerCase().includes("product") ||
                topic.toLowerCase().includes("service")
            ) {
                groupKey = "products";
            }

            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            groups.get(groupKey)!.push(topic);
        }

        return groups;
    }

    /**
     * Generate a unique topic ID
     */
    private generateTopicId(topicName: string, level: number): string {
        const cleanName = topicName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .substring(0, 30);
        return `topic_${cleanName}_${level}_${Date.now()}`;
    }

    /**
     * Check if two topics are related (simple heuristic)
     */
    private topicsRelated(topic1: string, topic2: string): boolean {
        const t1Lower = topic1.toLowerCase();
        const t2Lower = topic2.toLowerCase();

        // Check if one contains the other
        if (t1Lower.includes(t2Lower) || t2Lower.includes(t1Lower)) {
            return true;
        }

        // Check for common significant words
        const t1Words = t1Lower.split(/\s+/).filter((w) => w.length > 3);
        const t2Words = t2Lower.split(/\s+/).filter((w) => w.length > 3);

        const commonWords = t1Words.filter((w) => t2Words.includes(w));
        return commonWords.length > 0;
    }
}
