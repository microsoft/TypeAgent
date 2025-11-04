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
    HierarchicalTopicRecord,
    TopicEntityRelationTable,
    TopicRelationshipTable,
    TopicMetricsTable,
} from "./tables.js";
import { Website, WebsiteMeta } from "./websiteMeta.js";
import { WebsiteDocPart } from "./websiteDocPart.js";
import { TopicGraphBuilder, CooccurrenceData } from "./graph/topicGraphBuilder.js";
import type { GraphJsonStorageManager } from "./storage/graphJsonStorage.js";
import path from "node:path";
import fs from "node:fs";
import registerDebug from "debug";
import { createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

const debug = registerDebug("typeagent:memory:websiteCollection");

interface PairwiseTopicRelationship {
    action: "keep_root" | "make_child" | "merge";
    confidence: number;
    reasoning: string;
}

const pairwiseTopicRelationshipSchema = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Schema for LLM-based pairwise topic relationship analysis
 * Used with TypeChat for analyzing semantic relationships between two topics
 */

/**
 * Relationship actions for organizing topic hierarchies:
 *
 * - "keep_root": Topic should remain independent (no relationship to the other topic)
 *   Use when: The two topics are unrelated or equally broad
 *   Example: "Machine Learning" and "Web Development" should both remain roots
 *
 * - "make_child": The first topic should become a child of the second topic
 *   Use when: The first topic is more specific than the second and represents a subset
 *
 * - "merge": The first topic should be merged into the second topic
 *   Use when: Topics are synonyms, abbreviations, or duplicates
 */
type RelationshipAction = "keep_root" | "make_child" | "merge";

interface PairwiseTopicRelationship {
    action: RelationshipAction;
    confidence: number;
    reasoning: string;
}
`;

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
    public topicRelationships!: TopicRelationshipTable;
    public topicMetrics!: TopicMetricsTable;

    private db: sqlite.Database | undefined = undefined;
    private dbPath: string = "";
    private graphStateManager: any = null;
    private graphJsonStorage?: { manager: GraphJsonStorageManager };

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
        this.topicRelationships = new TopicRelationshipTable(this.db);
        this.topicMetrics = new TopicMetricsTable(this.db);

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

    /**
     * Set the JSON graph storage manager for topic persistence
     */
    public setGraphJsonStorage(storage: { manager: GraphJsonStorageManager }): void {
        this.graphJsonStorage = storage;
        debug("[WebsiteCollection] JSON graph storage configured");
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

        // Store entities in knowledge entities table
        await this.storeEntitiesInDatabase(cacheManager, websitesToProcess);
        debug(`[Knowledge Graph] Stored entities in database`);

        // Build relationships between entities using cache-based approach
        const relationshipStartTime = Date.now();
        await this.buildRelationships(cacheManager);
        const relationshipCount =
            cacheManager.getAllEntityRelationships().length;
        debug(
            `[Knowledge Graph] Built ${relationshipCount} relationships in ${Date.now() - relationshipStartTime}ms`,
        );

        // Detect communities using algorithms
        const communityStartTime = Date.now();
        await this.detectCommunities(entities, algorithms);
        const communities = (await this.communities?.getAllCommunities()) || [];
        debug(
            `[Knowledge Graph] Detected ${communities.length} communities in ${Date.now() - communityStartTime}ms`,
        );

        // Build hierarchical topics from flat topics
        const topicStartTime = Date.now();
        await this.buildHierarchicalTopics(urlLimit);
        debug(
            `[Knowledge Graph] Built hierarchical topics in ${Date.now() - topicStartTime}ms`,
        );

        // Build topic relationships and metrics using Graphology-based graph builder
        const topicGraphStart = Date.now();
        const { buildTopicGraphWithGraphology } = await import(
            "./buildTopicGraphWithGraphology.js"
        );
        const allHierarchicalTopics =
            this.hierarchicalTopics?.getTopicHierarchy() || [];
        await buildTopicGraphWithGraphology(
            allHierarchicalTopics,
            cacheManager,
            this.topicRelationships,
            this.topicMetrics,
        );
        debug(
            `[Knowledge Graph] Completed topic graph build in ${Date.now() - topicGraphStart}ms`,
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

        // Update topic graph incrementally
        await this.updateTopicGraphIncremental(newWebsites);
    }

    private async updateTopicGraphIncremental(
        newWebsites: Website[],
    ): Promise<void> {
        debug(
            `[Knowledge Graph] Updating topic graph incrementally for ${newWebsites.length} websites`,
        );

        if (!this.graphStateManager) {
            const { GraphStateManager } = await import(
                "./graph/graphStateManager.js"
            );
            this.graphStateManager = new GraphStateManager();
        }

        const allHierarchicalTopics =
            this.hierarchicalTopics?.getTopicHierarchy() || [];

        const { GraphBuildingCacheManager } = await import(
            "./utils/graphBuildingCacheManager.mjs"
        );
        const cacheManager = new GraphBuildingCacheManager();
        const websites = this.getWebsites();
        await cacheManager.initializeCache(websites);

        const cooccurrences = cacheManager
            .getAllTopicRelationships()
            .map((rel: any) => ({
                fromTopic: rel.fromTopic,
                toTopic: rel.toTopic,
                count: rel.count,
                urls: rel.sources || [],
            }));

        await this.graphStateManager.ensureGraphsInitialized(
            allHierarchicalTopics,
            cooccurrences,
        );

        for (const website of newWebsites) {
            const knowledge = website.knowledge as any;
            if (!knowledge?.topicHierarchy) continue;

            const topicMap =
                knowledge.topicHierarchy.topicMap instanceof Map
                    ? knowledge.topicHierarchy.topicMap
                    : new Map(
                          Object.entries(
                              knowledge.topicHierarchy.topicMap || {},
                          ),
                      );

            const hierarchicalTopics: any[] = [];
            for (const [topicId, topic] of topicMap) {
                hierarchicalTopics.push({
                    url: website.metadata.url,
                    domain: website.metadata.domain,
                    topicId: topicId,
                    topicName: (topic as any).name,
                    level: (topic as any).level || 0,
                    parentTopicId: (topic as any).parentId,
                    confidence: (topic as any).confidence || 0.5,
                    sourceTopicNames: JSON.stringify(
                        (topic as any).sourceTopicNames || [],
                    ),
                    extractionDate: new Date().toISOString(),
                });
            }

            const websiteCooccurrences: any[] = [];

            const result = await this.graphStateManager.addWebpage({
                url: website.metadata.url,
                domain: website.metadata.domain,
                hierarchicalTopics,
                cooccurrences: websiteCooccurrences,
            });

            debug(
                `[Knowledge Graph] Added ${website.metadata.url}: ${result.addedTopics} topics, ${result.addedRelationships} relationships in ${result.durationMs}ms`,
            );
        }

        const relationships = this.graphStateManager.exportRelationships();
        for (const rel of relationships) {
            this.topicRelationships?.upsertRelationship(rel);
        }

        const metricsCalculator = await import("./graph/metricsCalculator.js");
        const calc = new metricsCalculator.MetricsCalculator();
        const topicCounts = calc.calculateTopicCounts(
            allHierarchicalTopics.map((t: any) => ({
                topicId: t.topicId,
                url: t.url,
                domain: t.domain,
            })),
        );

        const { topicMetrics } =
            await this.graphStateManager.recomputeMetrics(topicCounts);
        for (const [, metrics] of topicMetrics) {
            this.topicMetrics?.upsertMetrics(metrics);
        }

        debug(`[Knowledge Graph] Incremental update complete`);
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

        // Initialize algorithms for community detection
        const { OptimizedGraphAlgorithms } = await import(
            "./utils/optimizedGraphAlgorithms.mjs"
        );
        const algorithms = new OptimizedGraphAlgorithms();

        await this.detectCommunities(entities, algorithms);
    }

    /**
     * Build hierarchical topics from flat topics using mergeTopics
     * Follows the same pattern as buildRelationships
     */
    private async buildHierarchicalTopics(urlLimit?: number): Promise<void> {
        debug(`[Knowledge Graph] Building hierarchical topics...`);
        const startTime = Date.now();

        try {
            // First, check if websites already have rich hierarchies from extraction
            const websites = this.getWebsites();
            debug(`[Knowledge Graph] Total websites: ${websites.length}`);
            const websitesToProcess = urlLimit
                ? websites.slice(0, urlLimit)
                : websites;
            debug(
                `[Knowledge Graph] Processing ${websitesToProcess.length} websites for hierarchies`,
            );

            const websitesWithHierarchies = websitesToProcess.filter(
                (w) => (w.knowledge as any)?.topicHierarchy,
            );
            debug(
                `[Knowledge Graph] Found ${websitesWithHierarchies.length} websites with existing hierarchies`,
            );

            if (websitesWithHierarchies.length > 0) {
                // Clear existing hierarchical topics before rebuilding
                if (this.hierarchicalTopics) {
                    const clearStmt = this.db!.prepare(
                        "DELETE FROM hierarchicalTopics",
                    );
                    clearStmt.run();
                    debug(
                        `[Knowledge Graph] Cleared existing hierarchical topics`,
                    );
                }

                // Use existing rich hierarchies from websites
                debug(
                    `[Knowledge Graph] Using rich hierarchies from ${websitesWithHierarchies.length} websites`,
                );
                await this.updateHierarchicalTopics(websitesWithHierarchies);
                return;
            }

            // No existing hierarchies, fall back to building from flat topics
            debug(
                `[Knowledge Graph] No websites with hierarchies, extracting flat topics...`,
            );
            const flatTopics = await this.extractFlatTopics(urlLimit);
            debug(
                `[Knowledge Graph] Extracted ${flatTopics.length} flat topics`,
            );

            if (flatTopics.length === 0) {
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
                debug(
                    `[Knowledge Graph] Creating AI model for topic extraction...`,
                );
                const apiSettings = ai.openai.azureApiSettingsFromEnv(
                    ai.openai.ModelType.Chat,
                    undefined,
                    "GPT_4_O_MINI",
                );
                const languageModel = ai.openai.createChatModel(apiSettings);
                topicExtractor =
                    kpLib.conversation.createTopicExtractor(languageModel);
                debug(`[Knowledge Graph] AI model created successfully`);
            } catch (error) {
                debug(
                    `[Knowledge Graph] AI model not available for topic merging: ${error}`,
                );
                // Fall back to simple hierarchical grouping
                debug(
                    `[Knowledge Graph] Using simple hierarchical grouping for ${flatTopics.length} topics`,
                );
                await this.buildSimpleTopicHierarchy(flatTopics);
                debug(`[Knowledge Graph] Simple hierarchy built`);
                return;
            }

            // Use AI to merge topics into higher-level topics
            debug(
                `[Knowledge Graph] Merging ${flatTopics.length} topics into hierarchy...`,
            );
            const mergeResult = await topicExtractor.mergeTopics(
                flatTopics,
                undefined, // No past topics for initial build
                "comprehensive, hierarchical",
            );

            if (mergeResult && mergeResult.status === "Success") {
                debug(
                    `[Knowledge Graph] Topic merge successful: ${mergeResult.topic}`,
                );
                // Store the merged topic as root
                const rootTopicId = this.generateTopicId(mergeResult.topic, 0);
                debug(`[Knowledge Graph] Storing root topic: ${rootTopicId}`);
                await this.storeHierarchicalTopic(
                    {
                        topicId: rootTopicId,
                        topicName: mergeResult.topic,
                        level: 0,
                        confidence: 0.9,
                        keywords: [mergeResult.topic],
                    },
                    "aggregated:multiple-sources",
                    "aggregated",
                );

                // Organize flat topics under the root
                debug(
                    `[Knowledge Graph] Organizing ${flatTopics.length} topics under root`,
                );
                await this.organizeTopicsUnderRoot(flatTopics, rootTopicId);
                debug(`[Knowledge Graph] Topics organized successfully`);
            } else {
                // Fall back to simple hierarchy if merging fails
                debug(
                    `[Knowledge Graph] Topic merging failed (status: ${mergeResult?.status}), using simple hierarchy`,
                );
                await this.buildSimpleTopicHierarchy(flatTopics);
                debug(`[Knowledge Graph] Simple hierarchy built`);
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
    /**
     * Convert topic hierarchy to HierarchicalTopicRecord format for TopicGraphBuilder
     */
    private convertTopicHierarchyToRecords(
        globalHierarchy: any,
        websiteUrlMap: Map<string, { url: string; domain: string }>
    ): HierarchicalTopicRecord[] {
        const records: HierarchicalTopicRecord[] = [];
        
        const processTopicRecursive = (topic: any) => {
            const urlInfo = websiteUrlMap.get(topic.id) || { url: "unknown", domain: "unknown" };
            
            const record: HierarchicalTopicRecord = {
                url: urlInfo.url,
                domain: urlInfo.domain,
                topicId: topic.id,
                topicName: topic.name,
                level: topic.level,
                parentTopicId: topic.parentId,
                confidence: topic.confidence || 0.5,
                keywords: JSON.stringify(topic.keywords || []),
                sourceTopicNames: JSON.stringify(topic.sourceTopicNames || []),
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

        debug(`[WebsiteCollection] Converted ${records.length} topics to HierarchicalTopicRecord format`);
        return records;
    }

    /**
     * Build cooccurrence data from flat topic relationships
     */
    private buildCooccurrenceData(
        topicMap: Map<string, any>,
        websiteUrlMap: Map<string, { url: string; domain: string }>
    ): CooccurrenceData[] {
        const cooccurrences: CooccurrenceData[] = [];
        const urlTopicMap = new Map<string, string[]>();

        // Group topics by URL
        for (const [topicId, topic] of topicMap) {
            const urlInfo = websiteUrlMap.get(topicId);
            if (urlInfo) {
                const url = urlInfo.url;
                if (!urlTopicMap.has(url)) {
                    urlTopicMap.set(url, []);
                }
                urlTopicMap.get(url)!.push(topic.name);
            }
        }

        // Generate cooccurrences for topics that appear on the same URL
        for (const [url, topicNames] of urlTopicMap) {
            for (let i = 0; i < topicNames.length; i++) {
                for (let j = i + 1; j < topicNames.length; j++) {
                    const fromTopic = topicNames[i];
                    const toTopic = topicNames[j];
                    
                    // Find existing cooccurrence or create new one
                    let cooccurrence = cooccurrences.find(
                        c => (c.fromTopic === fromTopic && c.toTopic === toTopic) ||
                             (c.fromTopic === toTopic && c.toTopic === fromTopic)
                    );
                    
                    if (cooccurrence) {
                        cooccurrence.count++;
                        if (!cooccurrence.urls.includes(url)) {
                            cooccurrence.urls.push(url);
                        }
                    } else {
                        cooccurrences.push({
                            fromTopic,
                            toTopic,
                            count: 1,
                            urls: [url]
                        });
                    }
                }
            }
        }

        debug(`[WebsiteCollection] Built ${cooccurrences.length} cooccurrence relationships`);
        return cooccurrences;
    }

    public async updateHierarchicalTopics(
        newWebsites: Website[],
    ): Promise<void> {
        debug(
            `[Knowledge Graph] Updating hierarchical topics with ${newWebsites.length} new websites`,
        );

        let globalHierarchy: any | undefined;
        const websiteUrlMap = new Map<
            string,
            { url: string; domain: string }
        >();

        // Extract and merge topic hierarchies from websites (existing logic)
        for (const website of newWebsites) {
            const docHierarchy = (website.knowledge as any)?.topicHierarchy as
                | any
                | undefined;

            if (!docHierarchy) {
                continue;
            }

            let topicMap: Map<string, any>;

            if (docHierarchy.topicMap instanceof Map) {
                topicMap = docHierarchy.topicMap;
            } else if (
                typeof docHierarchy.topicMap === "object" &&
                docHierarchy.topicMap !== null
            ) {
                topicMap = new Map(Object.entries(docHierarchy.topicMap));
            } else {
                topicMap = new Map();
            }

            // Track which website each topic came from
            const websiteUrl = website.metadata.url || "unknown";
            const websiteDomain = website.metadata.domain || "unknown";
            for (const [topicId] of topicMap) {
                if (!websiteUrlMap.has(topicId)) {
                    websiteUrlMap.set(topicId, {
                        url: websiteUrl,
                        domain: websiteDomain,
                    });
                }
            }

            const hierarchyWithMap = {
                ...docHierarchy,
                topicMap: topicMap,
            };

            if (!globalHierarchy) {
                globalHierarchy = hierarchyWithMap;
            } else {
                globalHierarchy = this.mergeHierarchies(
                    globalHierarchy,
                    hierarchyWithMap,
                    websiteUrl,
                );
            }
        }

        if (!globalHierarchy) {
            debug("[Knowledge Graph] No topic hierarchies found in websites");
            return;
        }

        try {
            // NEW: Use TopicGraphBuilder with JSON storage instead of SQLite
            if (this.graphJsonStorage?.manager) {
                debug("[Knowledge Graph] Using JSON storage for topic persistence");
                
                // Convert to format expected by TopicGraphBuilder
                const hierarchicalTopics = this.convertTopicHierarchyToRecords(globalHierarchy, websiteUrlMap);
                const cooccurrences = this.buildCooccurrenceData(globalHierarchy.topicMap, websiteUrlMap);
                
                // Build graphs using TopicGraphBuilder
                const builder = new TopicGraphBuilder();
                builder.buildFromTopicHierarchy(hierarchicalTopics, cooccurrences);
                
                // TODO: Add entity relations if available
                // This would integrate with entity extraction from the same websites
                
                // Save to JSON storage
                await builder.saveToJsonStorage(this.graphJsonStorage.manager);
                
                debug("[Knowledge Graph] Topic hierarchy saved to JSON storage successfully");
            } else {
                // FALLBACK: Use existing SQLite storage (backward compatibility)
                debug("[Knowledge Graph] JSON storage not available, falling back to SQLite");
                
                for (const rootTopic of globalHierarchy.rootTopics) {
                    await this.storeTopicHierarchyRecursive(
                        rootTopic,
                        globalHierarchy.topicMap,
                        websiteUrlMap,
                    );
                }
            }
        } catch (error) {
            debug(
                `[Knowledge Graph] Error updating hierarchical topics: ${error}`,
            );
        }
    }

    private mergeHierarchies(
        existing: any,
        newHierarchy: any,
        newWebsiteUrl: string,
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

        // Calculate sibling relationships
        const siblingRels = this.calculateSiblingRelationships(
            mergedTopicMap as Map<string, any>,
        );
        for (const rel of siblingRels) {
            this.topicRelationships?.upsertRelationship(rel);
        }

        return {
            rootTopics: mergedRootTopics,
            topicMap: mergedTopicMap,
            maxDepth: Math.max(existing.maxDepth, newHierarchy.maxDepth),
            totalTopics: mergedTopicMap.size,
        };
    }

    private async storeTopicHierarchyRecursive(
        topic: any,
        topicMap: Map<string, any>,
        websiteUrlMap: Map<string, { url: string; domain: string }>,
    ): Promise<void> {
        const existing = this.hierarchicalTopics.getTopicByName(
            topic.name,
            topic.level,
        );

        if (!existing) {
            let parentTopicId: string | undefined = undefined;
            if (topic.parentId) {
                const parentTopic = topicMap.get(topic.parentId);
                if (parentTopic) {
                    parentTopicId = this.hierarchicalTopics.getTopicByName(
                        parentTopic.name,
                        topic.level - 1,
                    )?.topicId;
                }
            }

            // Get URL from the first website that contributed this topic
            const urlInfo = websiteUrlMap.get(topic.id) || {
                url: "unknown",
                domain: "unknown",
            };

            await this.storeHierarchicalTopic(
                {
                    topicId: topic.id,
                    topicName: topic.name,
                    level: topic.level,
                    ...(parentTopicId ? { parentTopicId } : {}),
                    confidence: topic.confidence,
                    keywords: topic.keywords,
                    sourceTopicNames: topic.sourceTopicNames,
                },
                urlInfo.url,
                urlInfo.domain,
            );
        }

        for (const childId of topic.childIds) {
            const childTopic = topicMap.get(childId);
            if (childTopic) {
                await this.storeTopicHierarchyRecursive(
                    childTopic,
                    topicMap,
                    websiteUrlMap,
                );
            }
        }
    }

    private async analyzeSemanticRelationship(
        topic: string,
        candidateParent: string,
    ): Promise<{
        action: "keep_root" | "make_child" | "merge";
        confidence: number;
        reasoning: string;
    }> {
        const topicLower = topic.toLowerCase();
        const parentLower = candidateParent.toLowerCase();

        if (topicLower === parentLower) {
            return {
                action: "merge",
                confidence: 1.0,
                reasoning: "Exact match (case-insensitive)",
            };
        }

        try {
            const { openai: ai } = await import("aiclient");
            const apiSettings = ai.azureApiSettingsFromEnv(
                ai.ModelType.Chat,
                undefined,
                "GPT_4_O_MINI",
            );
            const model = ai.createChatModel(apiSettings);

            const validator =
                createTypeScriptJsonValidator<PairwiseTopicRelationship>(
                    pairwiseTopicRelationshipSchema,
                    "PairwiseTopicRelationship",
                );
            const translator = createJsonTranslator(model, validator);

            const prompt = `Analyze the semantic relationship between these two topics:

Topic 1: "${topic}"
Topic 2: "${candidateParent}"

Determine the appropriate relationship action based on the PairwiseTopicRelationship schema.`;

            const response = await translator.translate(prompt);

            if (!response.success) {
                console.warn(
                    `[LLM Pairwise] Failed to analyze "${topic}" vs "${candidateParent}": ${response.message}`,
                );
                return {
                    action: "keep_root",
                    confidence: 0.0,
                    reasoning: "LLM analysis failed",
                };
            }

            const result = response.data;
            return {
                action: result.action || "keep_root",
                confidence: result.confidence || 0.5,
                reasoning: result.reasoning || "LLM pairwise analysis",
            };
        } catch (error) {
            console.error(
                `[LLM Pairwise] Error analyzing "${topic}" vs "${candidateParent}":`,
                error,
            );
            return {
                action: "keep_root",
                confidence: 0.0,
                reasoning: "Analysis error",
            };
        }
    }

    public async testMergeTopicHierarchies(
        llmAnalyzer?: (topicNames: string[]) => Promise<
            Map<
                string,
                {
                    action: "keep_root" | "make_child" | "merge";
                    targetTopic?: string;
                    confidence: number;
                    reasoning: string;
                }
            >
        >,
    ): Promise<{
        mergeCount: number;
        changes: Array<{
            action: string;
            sourceTopic: string;
            targetTopic?: string;
        }>;
    }> {
        console.log(
            "[Topic Merge] Testing topic hierarchy merge (preview mode)",
        );

        const allTopics = this.hierarchicalTopics.getTopicHierarchy();
        const rootTopics = allTopics.filter((t) => t.level === 0);

        console.log(`[Topic Merge] Analyzing ${rootTopics.length} root topics`);

        const changes: Array<{
            action: string;
            sourceTopic: string;
            targetTopic?: string;
        }> = [];

        const topicsByName = new Map<string, HierarchicalTopicRecord[]>();
        for (const topic of rootTopics) {
            if (!topicsByName.has(topic.topicName)) {
                topicsByName.set(topic.topicName, []);
            }
            topicsByName.get(topic.topicName)!.push(topic);
        }

        for (const [, topics] of topicsByName) {
            if (topics.length > 1) {
                const primaryTopic = topics.reduce((best, current) =>
                    current.confidence > best.confidence ? current : best,
                );

                for (const topic of topics) {
                    if (topic.url !== primaryTopic.url) {
                        changes.push({
                            action: "merge_duplicate",
                            sourceTopic: `${topic.topicName} (${topic.url})`,
                            targetTopic: `${primaryTopic.topicName} (${primaryTopic.url})`,
                        });
                    }
                }
            }
        }

        const uniqueRootNames = Array.from(
            new Set(rootTopics.map((t) => t.topicName)),
        );

        if (llmAnalyzer) {
            console.log("[Topic Merge] Using LLM-based semantic analysis");
            const llmAnalysis = await llmAnalyzer(uniqueRootNames);

            let loggedSamples = 0;
            const maxSamples = 10;

            for (const [topicName, analysis] of llmAnalysis) {
                if (analysis.action === "make_child" && analysis.targetTopic) {
                    changes.push({
                        action: "make_child",
                        sourceTopic: topicName,
                        targetTopic: analysis.targetTopic,
                    });
                    if (loggedSamples < maxSamples) {
                        console.log(
                            `[Topic Merge Sample] "${topicName}" → child of "${analysis.targetTopic}"`,
                        );
                        console.log(`  Reasoning: ${analysis.reasoning}`);
                        console.log(
                            `  Confidence: ${analysis.confidence.toFixed(2)}`,
                        );
                        loggedSamples++;
                    }
                } else if (
                    analysis.action === "merge" &&
                    analysis.targetTopic
                ) {
                    changes.push({
                        action: "merge_semantic",
                        sourceTopic: topicName,
                        targetTopic: analysis.targetTopic,
                    });
                    if (loggedSamples < maxSamples) {
                        console.log(
                            `[Topic Merge Sample] "${topicName}" → merge into "${analysis.targetTopic}"`,
                        );
                        console.log(`  Reasoning: ${analysis.reasoning}`);
                        console.log(
                            `  Confidence: ${analysis.confidence.toFixed(2)}`,
                        );
                        loggedSamples++;
                    }
                }
            }

            console.log(
                `[Topic Merge] Logged ${loggedSamples} sample merge actions (showing up to ${maxSamples})`,
            );
        } else {
            console.log(
                "[Topic Merge] Using LLM-based pairwise semantic analysis",
            );
            let pairwiseCount = 0;
            for (let i = 0; i < uniqueRootNames.length; i++) {
                const topicName = uniqueRootNames[i];

                for (let j = 0; j < uniqueRootNames.length; j++) {
                    if (i === j) continue;

                    const candidateParent = uniqueRootNames[j];
                    pairwiseCount++;

                    if (pairwiseCount % 10 === 0) {
                        console.log(
                            `[Topic Merge] Analyzed ${pairwiseCount} topic pairs...`,
                        );
                    }

                    const relationship = await this.analyzeSemanticRelationship(
                        topicName,
                        candidateParent,
                    );

                    if (
                        relationship.action === "make_child" &&
                        relationship.confidence >= 0.7
                    ) {
                        changes.push({
                            action: "make_child",
                            sourceTopic: topicName,
                            targetTopic: candidateParent,
                        });
                    } else if (
                        relationship.action === "merge" &&
                        relationship.confidence >= 0.9
                    ) {
                        changes.push({
                            action: "merge_semantic",
                            sourceTopic: topicName,
                            targetTopic: candidateParent,
                        });
                    }
                }
            }
            console.log(
                `[Topic Merge] Completed ${pairwiseCount} pairwise LLM comparisons`,
            );
        }

        const mergeCount = changes.length;

        const actionCounts = changes.reduce(
            (acc, change) => {
                acc[change.action] = (acc[change.action] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>,
        );

        console.log(`[Topic Merge] Preview Summary:`);
        console.log(`  Total changes: ${mergeCount}`);
        Object.entries(actionCounts).forEach(([action, count]) => {
            console.log(`  - ${action}: ${count}`);
        });

        if (changes.length > 0) {
            console.log(
                `\n[Topic Merge] ===== Sample of 10 Merge Actions ===== `,
            );
            changes.slice(0, 10).forEach((change, i) => {
                const actionLabel =
                    change.action === "make_child"
                        ? "MAKE CHILD"
                        : change.action === "merge_semantic"
                          ? "MERGE"
                          : change.action === "merge_duplicate"
                            ? "DEDUPE"
                            : change.action;

                if (change.targetTopic) {
                    console.log(
                        `  ${i + 1}. [${actionLabel}] "${change.sourceTopic}" → "${change.targetTopic}"`,
                    );
                } else {
                    console.log(
                        `  ${i + 1}. [${actionLabel}] "${change.sourceTopic}"`,
                    );
                }
            });
            console.log(
                `[Topic Merge] =====================================\n`,
            );
        }

        return {
            mergeCount,
            changes,
        };
    }

    public async mergeTopicHierarchiesWithLLM(
        llmAnalyzer?: (topicNames: string[]) => Promise<
            Map<
                string,
                {
                    action: "keep_root" | "make_child" | "merge";
                    targetTopic?: string;
                    confidence: number;
                    reasoning: string;
                }
            >
        >,
    ): Promise<{
        mergeCount: number;
    }> {
        console.log(
            "[Topic Merge] Merging topic hierarchies with semantic analysis",
        );

        const allTopics = this.hierarchicalTopics.getTopicHierarchy();
        const rootTopics = allTopics.filter((t) => t.level === 0);

        let mergeCount = 0;

        const topicsByName = new Map<string, HierarchicalTopicRecord[]>();
        for (const topic of rootTopics) {
            if (!topicsByName.has(topic.topicName)) {
                topicsByName.set(topic.topicName, []);
            }
            topicsByName.get(topic.topicName)!.push(topic);
        }

        for (const [, topics] of topicsByName) {
            if (topics.length > 1) {
                const primaryTopic = topics.reduce((best, current) =>
                    current.confidence > best.confidence ? current : best,
                );

                for (const topic of topics) {
                    if (topic.url !== primaryTopic.url) {
                        const stmt = this.db!.prepare(`
                            DELETE FROM hierarchicalTopics
                            WHERE url = ? AND topicId = ? AND topicName = ? AND level = ?
                        `);
                        stmt.run(
                            topic.url,
                            topic.topicId,
                            topic.topicName,
                            topic.level,
                        );
                        mergeCount++;

                        console.log(
                            `[Topic Merge] Merged duplicate "${topic.topicName}" from ${topic.url}`,
                        );
                    }
                }
            }
        }

        const uniqueRootNames = Array.from(
            new Set(rootTopics.map((t) => t.topicName)),
        );
        const rootTopicMap = new Map<string, HierarchicalTopicRecord>();
        for (const topic of rootTopics) {
            if (!rootTopicMap.has(topic.topicName)) {
                rootTopicMap.set(topic.topicName, topic);
            } else {
                const existing = rootTopicMap.get(topic.topicName)!;
                if (topic.confidence > existing.confidence) {
                    rootTopicMap.set(topic.topicName, topic);
                }
            }
        }

        if (llmAnalyzer) {
            console.log("[Topic Merge] Using LLM-based semantic analysis");
            const llmAnalysis = await llmAnalyzer(uniqueRootNames);

            for (const [topicName, analysis] of llmAnalysis) {
                if (analysis.action === "make_child" && analysis.targetTopic) {
                    const childTopic = rootTopicMap.get(topicName);
                    const parentTopic = rootTopicMap.get(analysis.targetTopic);

                    if (childTopic && parentTopic) {
                        const stmt = this.db!.prepare(`
                            UPDATE hierarchicalTopics
                            SET parentTopicId = ?, level = 1
                            WHERE topicName = ? AND level = 0
                        `);
                        const result = stmt.run(
                            parentTopic.topicId,
                            childTopic.topicName,
                        );
                        mergeCount += result.changes;

                        console.log(
                            `[Topic Merge] LLM: Made "${topicName}" a child of "${analysis.targetTopic}" (${analysis.reasoning})`,
                        );
                    }
                } else if (
                    analysis.action === "merge" &&
                    analysis.targetTopic
                ) {
                    const sourceTopic = rootTopicMap.get(topicName);
                    const targetTopic = rootTopicMap.get(analysis.targetTopic);

                    if (sourceTopic && targetTopic) {
                        const stmt = this.db!.prepare(`
                            DELETE FROM hierarchicalTopics
                            WHERE topicName = ? AND level = 0
                        `);
                        const result = stmt.run(sourceTopic.topicName);
                        mergeCount += result.changes;

                        console.log(
                            `[Topic Merge] LLM: Merged "${topicName}" into "${analysis.targetTopic}" - deleted ${result.changes} records (${analysis.reasoning})`,
                        );
                    }
                }
            }
        } else {
            console.log(
                "[Topic Merge] Using LLM-based pairwise semantic analysis",
            );
            let pairwiseCount = 0;
            for (let i = 0; i < uniqueRootNames.length; i++) {
                const topicName = uniqueRootNames[i];

                for (let j = 0; j < uniqueRootNames.length; j++) {
                    if (i === j) continue;

                    const candidateParent = uniqueRootNames[j];
                    pairwiseCount++;

                    if (pairwiseCount % 10 === 0) {
                        console.log(
                            `[Topic Merge] Analyzed ${pairwiseCount} topic pairs...`,
                        );
                    }

                    const relationship = await this.analyzeSemanticRelationship(
                        topicName,
                        candidateParent,
                    );

                    if (
                        relationship.action === "make_child" &&
                        relationship.confidence >= 0.7
                    ) {
                        const childTopic = rootTopicMap.get(topicName);
                        const parentTopic = rootTopicMap.get(candidateParent);

                        if (childTopic && parentTopic) {
                            const stmt = this.db!.prepare(`
                                UPDATE hierarchicalTopics
                                SET parentTopicId = ?, level = 1
                                WHERE topicId = ? AND topicName = ? AND level = 0
                            `);
                            stmt.run(
                                parentTopic.topicId,
                                childTopic.topicId,
                                childTopic.topicName,
                            );
                            mergeCount++;

                            console.log(
                                `[Topic Merge] Made "${topicName}" a child of "${candidateParent}" (${relationship.reasoning})`,
                            );
                        }
                    } else if (
                        relationship.action === "merge" &&
                        relationship.confidence >= 0.9
                    ) {
                        const sourceTopic = rootTopicMap.get(topicName);
                        const targetTopic = rootTopicMap.get(candidateParent);

                        if (
                            sourceTopic &&
                            targetTopic &&
                            sourceTopic.url !== targetTopic.url
                        ) {
                            const stmt = this.db!.prepare(`
                                DELETE FROM hierarchicalTopics
                                WHERE topicId = ? AND topicName = ? AND level = 0
                            `);
                            stmt.run(
                                sourceTopic.topicId,
                                sourceTopic.topicName,
                            );
                            mergeCount++;

                            console.log(
                                `[Topic Merge] Merged "${topicName}" into "${candidateParent}" (${relationship.reasoning})`,
                            );
                        }
                    }
                }
            }
            console.log(
                `[Topic Merge] Completed ${pairwiseCount} pairwise LLM comparisons`,
            );
        }

        this.consolidateDuplicateTopicRecords();
        const orphanedCount = this.fixOrphanedChildren();
        if (orphanedCount > 0) {
            this.consolidateDuplicateTopicRecords();
        }

        console.log(
            `[Topic Merge] Successfully completed ${mergeCount} merge operations`,
        );

        return {
            mergeCount,
        };
    }

    /**
     * Consolidate duplicate topic records - keep only the highest confidence record per (topicName, level) pair
     */
    private consolidateDuplicateTopicRecords(): number {
        const allTopics = this.hierarchicalTopics.getTopicHierarchy();
        const topicsByNameAndLevel = new Map<
            string,
            HierarchicalTopicRecord[]
        >();

        for (const topic of allTopics) {
            const key = `${topic.topicName}|${topic.level}`;
            if (!topicsByNameAndLevel.has(key)) {
                topicsByNameAndLevel.set(key, []);
            }
            topicsByNameAndLevel.get(key)!.push(topic);
        }

        let deletedCount = 0;
        for (const [, topics] of topicsByNameAndLevel) {
            if (topics.length > 1) {
                const canonical = topics.reduce((best, current) =>
                    current.confidence > best.confidence ? current : best,
                );

                for (const topic of topics) {
                    if (topic.topicId !== canonical.topicId) {
                        const stmt = this.db!.prepare(`
                            DELETE FROM hierarchicalTopics
                            WHERE topicId = ?
                        `);
                        stmt.run(topic.topicId);
                        deletedCount++;
                    }
                }
            }
        }

        return deletedCount;
    }

    private fixOrphanedChildren(): number {
        const stmt = this.db!.prepare(`
            UPDATE hierarchicalTopics
            SET level = 0
            WHERE level > 0 AND parentTopicId IS NULL
        `);

        const result = stmt.run();
        return result.changes;
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
                "SELECT COUNT(*) as count FROM relationships WHERE fromEntity = ? OR toEntity = ? LIMIT 1",
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
                    fromEntity: entity1,
                    toEntity: entity2,
                    relationshipType: "co-occurrence",
                    confidence: strength,
                    sources: JSON.stringify([]), // Empty sources array initially
                    count: 1,
                    updated: new Date().toISOString(),
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
    private async buildSimpleTopicHierarchy(topics: string[]): Promise<void> {
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
                "aggregated:multiple-sources",
                "aggregated",
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
                    "aggregated:multiple-sources",
                    "aggregated",
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
                    "aggregated:multiple-sources",
                    "aggregated",
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
                        "aggregated:multiple-sources",
                        "aggregated",
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
                    "aggregated:multiple-sources",
                    "aggregated",
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
            sourceTopicNames?: string[];
        },
        websiteUrl: string,
        websiteDomain: string,
    ): Promise<void> {
        const sourceRef: dataFrame.RowSourceRef = {
            range: {
                start: { messageOrdinal: 0, chunkOrdinal: 0 },
                end: { messageOrdinal: 0, chunkOrdinal: 0 },
            },
        };

        const topicRow = {
            sourceRef,
            record: {
                url: websiteUrl,
                domain: websiteDomain,
                topicId: topic.topicId,
                topicName: topic.topicName,
                level: topic.level,
                parentTopicId: topic.parentTopicId,
                confidence: topic.confidence,
                keywords: JSON.stringify(topic.keywords),
                sourceTopicNames: topic.sourceTopicNames
                    ? JSON.stringify(topic.sourceTopicNames)
                    : undefined,
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
     * Generate a deterministic topic ID (aligned with knowledgeProcessor)
     */
    private generateTopicId(topicName: string, level: number): string {
        const cleanName = topicName
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "_")
            .substring(0, 30);
        return `topic_${cleanName}_${level}`;
    }

    /**
     * Store entities and topics in database using cache manager
     */
    private async storeEntitiesInDatabase(
        cacheManager: any,
        websitesToProcess: Website[],
    ): Promise<void> {
        debug(`[Knowledge Graph] Storing entities and topics in database...`);

        const extractionDate = new Date().toISOString();
        let entityCount = 0;
        let topicCount = 0;

        // Use cache manager for efficient access to entities and topics
        for (const website of websitesToProcess) {
            if (!website.knowledge) continue;
            const url = website.metadata.url;

            // Get entities from cache
            const entities = cacheManager.getEntitiesForWebsite(url);
            for (const entityName of entities) {
                const sourceRef = {
                    range: {
                        start: { messageOrdinal: 0, chunkOrdinal: 0 },
                        end: { messageOrdinal: 0, chunkOrdinal: 0 },
                    },
                };

                const entityRow = {
                    sourceRef,
                    record: {
                        url,
                        domain: website.metadata.domain,
                        entityName,
                        entityType: "unknown", // Will be determined from original entity data if needed
                        confidence: 0.8,
                        extractionDate,
                    },
                };

                await this.knowledgeEntities.addRows(entityRow);
                entityCount++;
            }

            // Get topics from cache
            const topics = cacheManager.getTopicsForWebsite(url);
            for (const topicName of topics) {
                const sourceRef = {
                    range: {
                        start: { messageOrdinal: 0, chunkOrdinal: 0 },
                        end: { messageOrdinal: 0, chunkOrdinal: 0 },
                    },
                };

                const topicRow = {
                    sourceRef,
                    record: {
                        url,
                        domain: website.metadata.domain,
                        topic: topicName,
                        relevance: 0.8,
                        extractionDate,
                    },
                };

                await this.knowledgeTopics.addRows(topicRow);
                topicCount++;
            }
        }

        debug(
            `[Knowledge Graph] Stored ${entityCount} entity records and ${topicCount} topic records`,
        );
    }

    /**
     * Build entity relationships using cache manager
     */
    private async buildRelationships(cacheManager: any): Promise<void> {
        debug(`[Knowledge Graph] Building relationships using cache approach`);

        // Get all relationships from cache manager (pre-computed co-occurrences)
        const cachedRelationships = cacheManager.getAllEntityRelationships();
        debug(
            `[Knowledge Graph] Found ${cachedRelationships.length} cached relationships`,
        );

        let storedCount = 0;
        for (const cachedRel of cachedRelationships) {
            const confidence = Math.min(cachedRel.count / 10, 1.0); // Normalize to 0-1

            const relationship = {
                fromEntity: cachedRel.fromEntity,
                toEntity: cachedRel.toEntity,
                relationshipType: "co_occurs",
                confidence,
                sources: JSON.stringify(cachedRel.sources),
                count: cachedRel.count,
                updated: new Date().toISOString(),
            };

            const sourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };

            const relationshipRow = {
                sourceRef,
                record: relationship,
            };

            await this.relationships.addRows(relationshipRow);
            storedCount++;

            if (
                storedCount % 100 === 0 ||
                storedCount === cachedRelationships.length
            ) {
                debug(
                    `[Knowledge Graph] Stored ${storedCount}/${cachedRelationships.length} relationships`,
                );
            }
        }

        debug(
            `[Knowledge Graph] Finished storing ${storedCount} relationships`,
        );
    }

    /**
     * Community detection using advanced algorithms
     */
    private async detectCommunities(
        entities: string[],
        algorithms: any,
    ): Promise<void> {
        debug(
            `[Knowledge Graph] Starting community detection for ${entities.length} entities`,
        );

        // Get relationships for algorithm input
        const relationships =
            (await this.relationships?.getAllRelationships()) || [];

        // Use graph algorithms for community detection
        const graphMetrics = algorithms.calculateAllMetrics(
            entities,
            relationships,
        );
        const communities = graphMetrics.communities;

        debug(
            `[Knowledge Graph] Detected ${communities.length} communities using algorithms`,
        );

        let storedCount = 0;
        for (const community of communities) {
            const sourceRef = {
                range: {
                    start: { messageOrdinal: 0, chunkOrdinal: 0 },
                    end: { messageOrdinal: 0, chunkOrdinal: 0 },
                },
            };

            const communityRow = {
                sourceRef,
                record: {
                    id: community.id,
                    entities: JSON.stringify(community.nodes),
                    topics: JSON.stringify([]), // Will be filled later if needed
                    size: community.nodes.length,
                    density: community.density,
                    updated: new Date().toISOString(),
                },
            };

            await this.communities.addRows(communityRow);
            storedCount++;

            if (storedCount % 10 === 0 || storedCount === communities.length) {
                debug(
                    `[Knowledge Graph] Stored ${storedCount}/${communities.length} communities`,
                );
            }
        }

        debug(`[Knowledge Graph] Finished storing ${storedCount} communities`);
    }

    private calculateSiblingRelationships(topicMap: Map<string, any>): any[] {
        const relationships: any[] = [];
        const parentToChildren = new Map<string, string[]>();

        // Group children by parent
        for (const [topicId, topic] of topicMap) {
            if (topic.parentId) {
                if (!parentToChildren.has(topic.parentId)) {
                    parentToChildren.set(topic.parentId, []);
                }
                parentToChildren.get(topic.parentId)!.push(topicId);
            }
        }

        // Create sibling relationships
        for (const [parentId, children] of parentToChildren) {
            for (let i = 0; i < children.length; i++) {
                for (let j = i + 1; j < children.length; j++) {
                    const parent = topicMap.get(parentId);
                    relationships.push({
                        fromTopic: children[i],
                        toTopic: children[j],
                        relationshipType: "SIBLING",
                        strength: 0.8,
                        metadata: JSON.stringify({
                            parentTopic: parent?.name,
                            sharedParentId: parentId,
                        }),
                        updated: new Date().toISOString(),
                    });
                }
            }
        }

        return relationships;
    }
}
