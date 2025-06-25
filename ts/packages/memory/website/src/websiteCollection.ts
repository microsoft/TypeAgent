// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IMessage,
    SemanticRef,
    ConversationIndex,
    IndexingResults,
    ConversationSettings,
    createConversationSettings,
    addMessageKnowledgeToSemanticRefIndex,
    buildSecondaryIndexes,
    ConversationSecondaryIndexes,
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
import { createEmbeddingCache } from "knowledge-processor";
import { openai, TextEmbeddingModel } from "aiclient";
import sqlite from "better-sqlite3";
import * as ms from "memory-storage";
import {
    VisitFrequencyTable,
    WebsiteCategoryTable,
    BookmarkFolderTable,
} from "./tables.js";
import { Website } from "./websiteMeta.js";
import path from "node:path";
import fs from "node:fs";

export interface WebsiteCollectionData
    extends IConversationDataWithIndexes<Website> {}

export class WebsiteCollection
    implements IConversation, dataFrame.IConversationWithDataFrame
{
    public messages: MessageCollection<Website>;
    public semanticRefs: SemanticRefCollection;
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: ConversationSecondaryIndexes;

    // Data frames for typed website meta data
    public dataFrames: dataFrame.DataFrameCollection;
    public visitFrequency: dataFrame.IDataFrame;
    public websiteCategories: dataFrame.IDataFrame;
    public bookmarkFolders: dataFrame.IDataFrame;

    constructor(
        public nameTag: string = "",
        messages: Website[] = [],
        public tags: string[] = [],
        semanticRefs: SemanticRef[] = [],
        public dbPath: string = "",
        private db: sqlite.Database | undefined = undefined,
    ) {
        this.messages = new MessageCollection<Website>(messages);
        this.semanticRefs = new SemanticRefCollection(semanticRefs);
        const [model, embeddingSize] = this.createEmbeddingModel();
        this.settings = createConversationSettings(model, embeddingSize);
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new ConversationSecondaryIndexes(this.settings);

        // create dataFrames (tables)
        if (!dbPath) {
            dbPath = ":memory:";
        }
        this.db = ms.sqlite.createDatabase(dbPath, true);
        this.visitFrequency = new VisitFrequencyTable(this.db);
        this.websiteCategories = new WebsiteCategoryTable(this.db);
        this.bookmarkFolders = new BookmarkFolderTable(this.db);

        // create dataFrames collection
        this.dataFrames = new Map<string, dataFrame.IDataFrame>([
            [this.visitFrequency.name, this.visitFrequency],
            [this.websiteCategories.name, this.websiteCategories],
            [this.bookmarkFolders.name, this.bookmarkFolders],
        ]);
    }

    get conversation(): IConversation<IMessage> {
        return this;
    }

    public addMetadataToIndex() {
        if (this.semanticRefIndex) {
            addMessageKnowledgeToSemanticRefIndex(this, 0);
        }
    }

    /*
     * Enumerates the messages and adds them to the data frame.
     */
    public addMetadataToDataFrames() {
        if (this.semanticRefIndex) {
            const domainVisits = new Map<
                string,
                { count: number; lastVisit: string }
            >();

            let index = 0;
            for (const website of this.messages) {
                const sourceRef: dataFrame.RowSourceRef = {
                    range: {
                        start: {
                            messageOrdinal: index,
                            chunkOrdinal: 0,
                        },
                    },
                };

                // Track visit frequency
                if (website.metadata.domain) {
                    const existing = domainVisits.get(website.metadata.domain);
                    const visitCount = website.metadata.visitCount || 1;
                    const lastVisit =
                        website.metadata.visitDate ||
                        website.metadata.bookmarkDate ||
                        new Date().toISOString();

                    if (existing) {
                        existing.count += visitCount;
                        if (lastVisit > existing.lastVisit) {
                            existing.lastVisit = lastVisit;
                        }
                    } else {
                        domainVisits.set(website.metadata.domain, {
                            count: visitCount,
                            lastVisit: lastVisit,
                        });
                    }
                }

                // Add website categories
                if (this.websiteCategories && website.metadata.pageType) {
                    const categoryRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            domain:
                                website.metadata.domain || website.metadata.url,
                            category: website.metadata.pageType,
                            confidence: 0.8, // Default confidence
                        },
                    };
                    this.websiteCategories.addRows(categoryRow);
                }

                // Add bookmark folder information
                if (
                    this.bookmarkFolders &&
                    website.metadata.websiteSource === "bookmark" &&
                    website.metadata.folder
                ) {
                    const folderRow: dataFrame.DataFrameRow = {
                        sourceRef,
                        record: {
                            folderPath: website.metadata.folder,
                            url: website.metadata.url,
                            title: website.metadata.title || "",
                            dateAdded:
                                website.metadata.bookmarkDate ||
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

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        this.semanticRefIndex = new ConversationIndex();
        if (this.semanticRefs === undefined) {
            this.semanticRefs = new SemanticRefCollection();
        }

        this.addMetadataToIndex();
        this.addMetadataToDataFrames();

        const indexingResult: IndexingResults = {
            semanticRefs: {
                completedUpto: { messageOrdinal: this.messages.length - 1 },
            },
        };

        indexingResult.secondaryIndexResults = await buildSecondaryIndexes(
            this,
            this.settings,
            eventHandler,
        );

        return indexingResult;
    }

    public async serialize(): Promise<WebsiteCollectionData> {
        const conversationData: WebsiteCollectionData = {
            nameTag: this.nameTag,
            messages: this.messages.getAll(),
            tags: this.tags,
            semanticRefs: this.semanticRefs.getAll(),
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData:
                this.secondaryIndexes.termToRelatedTermsIndex.serialize(),
        };
        return conversationData;
    }

    public async deserialize(data: WebsiteCollectionData): Promise<void> {
        this.nameTag = data.nameTag;
        const messages = data.messages.map((m) => {
            const website = new Website(
                m.metadata,
                m.textChunks,
                m.tags,
                m.knowledge,
                m.deletionInfo,
                false, // isNew = false since we're deserializing
            );
            website.timestamp = m.timestamp;
            return website;
        });
        this.messages = new MessageCollection<Website>(messages);
        this.semanticRefs = new SemanticRefCollection(data.semanticRefs);
        this.tags = data.tags;
        if (data.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermsIndexData) {
            this.secondaryIndexes.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        await buildTransientSecondaryIndexes(this, this.settings);
    }

    /*
     * Writes the index & dataframes to disk
     */
    public async writeToFile(
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
                websiteCollection.settings.relatedTermIndexSettings
                    .embeddingIndexSettings?.embeddingSize,
            );
            if (data) {
                websiteCollection.deserialize(data);
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
            websiteCollection.settings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        );

        if (data) {
            websiteCollection.deserialize(data);
        }

        return websiteCollection;
    }

    /**
     * Our index already has embeddings for every term in the website collection
     * Create an embedding model that can just leverage those embeddings
     * @returns embedding model, size of embedding
     */
    private createEmbeddingModel(): [TextEmbeddingModel, number] {
        return [
            createEmbeddingCache(
                openai.createEmbeddingModel(),
                64,
                () => this.secondaryIndexes.termToRelatedTermsIndex.fuzzyIndex,
            ),
            1536,
        ];
    }

    /**
     * Add websites to the collection
     */
    public addWebsites(websites: Website[]): void {
        for (const website of websites) {
            this.messages.append(website);
        }
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
