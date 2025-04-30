
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
    hybrid
} from "knowpro";
import {
    createEmbeddingCache,
} from "knowledge-processor";
import { openai, TextEmbeddingModel } from "aiclient";
//import registerDebug from "debug";
import sqlite from "better-sqlite3";
import * as ms from "memory-storage";
import { ExposureTable, GeoTable } from "./tables.js";
import { Image, ImageMeta } from "./imageMeta.js";
import path from "node:path";

//const debug = registerDebug("typeagent:image-memory");

export interface ImageCollectionData
    extends IConversationDataWithIndexes<Image> {}

export class ImageCollection implements IConversation, hybrid.IConversationHybrid {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: ConversationSecondaryIndexes;

    // Data frames for typed image meta data
    public dataFrames: hybrid.DataFrameCollection;
    public locations: hybrid.IDataFrame;
    public exposure: hybrid.IDataFrame;

    constructor(
        public nameTag: string = "",
        public messages: Image[] = [],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
        public dbPath: string = "",
        private db: sqlite.Database | undefined = undefined,
    ) {
        const [model, embeddingSize] = this.createEmbeddingModel();
        this.settings = createConversationSettings(model, embeddingSize);
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new ConversationSecondaryIndexes(this.settings);

        // create dataFrames (tables)
        if (!dbPath) {
            dbPath = ":memory:"
        }
        this.db = ms.sqlite.createDatabase(dbPath, true);
        this.locations = new GeoTable(this.db);
        this.exposure = new ExposureTable(this.db);

        // create dataFrames collection
        // TODO: select other Facets/meta data fields
        this.dataFrames = new Map<string, hybrid.IDataFrame>([
            [this.locations.name, this.locations],
            [this.exposure.name, this.exposure]
        ]);
    }

    get conversation(): IConversation<IMessage> {
        return this;
    }

    public addMetadataToIndex() {
        if (this.semanticRefIndex) {
            addMessageKnowledgeToSemanticRefIndex(
                this,
                0,
            );
        }
    }

    /*
    * Enumerates the messages and adds them to the data frame.
    */
    public addMetadataToDataFrames() {

        if (this.semanticRefIndex) {
            this.messages.forEach(
                (img: Image, index: number) => {

                    // add image location to dataframe
                    const latlong = img.metadata.getGeo();
                    if (this.locations && latlong) {

                        const sourceRef: hybrid.RowSourceRef =  { 
                            range: { 
                                start: { 
                                    messageOrdinal: index, 
                                    chunkOrdinal: 0 
                                } 
                            }
                        }

                        this.locations.addRows({ sourceRef, record: latlong});
                    } 

                    // // add exposure to dataframe
                    // const exposure = img.metadata.dataFrames[this.exposure.name];
                    // if (this.exposure && exposure) {
                    //     this.exposure.addRows(exposure);
                    // } 

                    // TODO: add additional meta data tables
                }
            )
        }
    }

    public async buildIndex(
        eventHandler?: IndexingEventHandlers,
    ): Promise<IndexingResults> {
        //const result = await buildConversationIndex(this, eventHandler);
        this.semanticRefIndex = new ConversationIndex();
        if (this.semanticRefs === undefined) {
            this.semanticRefs = [];
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
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
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
        this.messages = messages;
        this.semanticRefs = data.semanticRefs;
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
            this.db?.exec(`vacuum main into '${path.join(dirPath, baseFileName)}_dataFrames.sqlite'`);
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