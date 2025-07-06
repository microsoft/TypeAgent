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
import { DocMemory, DocMemorySettings, createTextMemorySettings } from "conversation-memory";
import sqlite from "better-sqlite3";
import * as ms from "memory-storage";
import {
    VisitFrequencyTable,
    WebsiteCategoryTable,
    BookmarkFolderTable,
} from "./tables.js";
import { Website } from "./websiteMeta.js";
import { WebsiteDocPart } from "./websiteDocPart.js";
import path from "node:path";
import fs from "node:fs";

export interface WebsiteCollectionData
    extends IConversationDataWithIndexes<WebsiteDocPart> {}

export class WebsiteCollection
    extends DocMemory
    implements dataFrame.IConversationWithDataFrame
{
    public dataFrames!: dataFrame.DataFrameCollection;
    public visitFrequency!: dataFrame.IDataFrame;
    public websiteCategories!: dataFrame.IDataFrame;
    public bookmarkFolders!: dataFrame.IDataFrame;

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
        const docParts = websites.map(website => WebsiteDocPart.fromWebsite(website));
        
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

        // Create dataFrames collection
        this.dataFrames = new Map<string, dataFrame.IDataFrame>([
            [this.visitFrequency.name, this.visitFrequency],
            [this.websiteCategories.name, this.websiteCategories],
            [this.bookmarkFolders.name, this.bookmarkFolders],
        ]);
    }

    /**
     * Add websites to the collection
     */
    public addWebsites(websites: Website[]): void {
        for (const website of websites) {
            const docPart = WebsiteDocPart.fromWebsite(website);
            this.messages.append(docPart);
        }
    }

    /**
     * Add a single website to the collection
     */
    public addWebsite(website: Website): void {
        const docPart = WebsiteDocPart.fromWebsite(website);
        this.messages.append(docPart);
    }

    /**
     * Get websites in the legacy format for backward compatibility
     */
    public getWebsites(): Website[] {
        return this.messages.getAll().map(docPart => 
            (docPart as WebsiteDocPart).toWebsite()
        );
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
        // Call the base class buildIndex first
        const result = await super.buildIndex(eventHandler);
        
        // Add our website-specific metadata processing
        this.addMetadataToIndex();
        this.addMetadataToDataFrames();

        return result;
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
            const websiteMeta = (m.metadata as any).websiteMeta || m.metadata;
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
            this.semanticRefIndex = new (await import("knowpro")).ConversationIndex(
                data.semanticIndexData,
            );
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
        await writeConversationDataToFile(data, dirPath, baseFileName);

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
                    .relatedTermIndexSettings
                    .embeddingIndexSettings?.embeddingSize,
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
                .relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
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
}
