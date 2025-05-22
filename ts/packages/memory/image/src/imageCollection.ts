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
//import registerDebug from "debug";
import sqlite from "better-sqlite3";
import * as ms from "memory-storage";
import { ExposureTable, GeoTable } from "./tables.js";
import { Image, ImageMeta } from "./imageMeta.js";
import path from "node:path";
import fs from "node:fs";

//const debug = registerDebug("typeagent:image-memory");

export interface ImageCollectionData
    extends IConversationDataWithIndexes<Image> {}

export class ImageCollection
    implements IConversation, dataFrame.IConversationWithDataFrame
{
    public messages: MessageCollection<Image>;
    public semanticRefs: SemanticRefCollection;
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: ConversationSecondaryIndexes;

    // Data frames for typed image meta data
    public dataFrames: dataFrame.DataFrameCollection;
    public locations: dataFrame.IDataFrame;
    public exposure: dataFrame.IDataFrame;

    constructor(
        public nameTag: string = "",
        messages: Image[] = [],
        public tags: string[] = [],
        semanticRefs: SemanticRef[] = [],
        public dbPath: string = "",
        private db: sqlite.Database | undefined = undefined,
    ) {
        this.messages = new MessageCollection<Image>(messages);
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
        this.locations = new GeoTable(this.db);
        this.exposure = new ExposureTable(this.db);

        // create dataFrames collection
        // TODO: select other Facets/meta data fields
        // TODO: put everything in a single table?
        this.dataFrames = new Map<string, dataFrame.IDataFrame>([
            [this.locations.name, this.locations],
            [this.exposure.name, this.exposure],
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
            let index = 0;
            for (const img of this.messages) {
                const sourceRef: dataFrame.RowSourceRef = {
                    range: {
                        start: {
                            messageOrdinal: index,
                            chunkOrdinal: 0,
                        },
                    },
                };

                // add image location to dataframe
                const latlong = img.metadata.getGeo();
                if (this.locations && latlong) {
                    this.locations.addRows({ sourceRef, record: latlong });
                }

                // add camera settings to dataframe
                if (this.exposure) {
                    // this.exposure.addRows({ sourceRef, record: {
                    //     ISO: img.metadata.dataFrameValues.ISO,
                    //     aperature: img.metadata.dataFrameValues.aperature,
                    //     shutter: img.metadata.dataFrameValues.shutter
                    // }})
                }

                // // add exposure to dataframe
                // const exposure = img.metadata.dataFrames[this.exposure.name];
                // if (this.exposure && exposure) {
                //     this.exposure.addRows(exposure);
                // }

                // TODO: add additional meta data tables
                index++;
            }
        }
    }

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        //const result = await buildConversationIndex(this, eventHandler);
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

    public async serialize(): Promise<ImageCollectionData> {
        const conversationData: ImageCollectionData = {
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

    public async deserialize(data: ImageCollectionData): Promise<void> {
        this.nameTag = data.nameTag;
        const messages = data.messages.map((m) => {
            const image = new Image(
                m.textChunks,
                new ImageMeta(m.metadata.fileName, m.metadata.img),
                m.tags,
            );
            image.timestamp = m.timestamp;
            return image;
        });
        this.messages = new MessageCollection<Image>(messages);
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
    ): Promise<ImageCollection | undefined> {
        const imageCollection = new ImageCollection();
        const data = await readConversationDataFromFile(
            dirPath,
            baseFileName,
            imageCollection.settings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        );
        if (data) {
            imageCollection.deserialize(data);
        }
        return imageCollection;
    }

    public static async fromBuffer(
        jsonData: string,
        embeddingsBuffer: Buffer,
    ): Promise<ImageCollection> {
        const imageCollection = new ImageCollection();

        const data = await readConversationDataFromBuffer(
            jsonData,
            embeddingsBuffer,
            imageCollection.settings.relatedTermIndexSettings
                .embeddingIndexSettings?.embeddingSize,
        );

        if (data) {
            imageCollection.deserialize(data);
        }

        return imageCollection;
    }

    /**
     * Our index already has embeddings for every term in the podcast
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
}
