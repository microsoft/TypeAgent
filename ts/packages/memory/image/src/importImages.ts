// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IKnowledgeSource,
    IMessage,
    SemanticRef,
    ConversationIndex,
    IndexingResults,
    createKnowledgeModel,
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
} from "knowpro";
import {
    conversation as kpLib,
    image,
    createEmbeddingCache,
} from "knowledge-processor";
import fs from "node:fs";
import path from "node:path";
import { isImageFileType } from "common-utils";
import { ChatModel, openai, TextEmbeddingModel } from "aiclient";
import { AddressOutput } from "@azure-rest/maps-search";
import { isDirectoryPath } from "typeagent";
import registerDebug from "debug";

const debug = registerDebug("typeagent:image-memory");

export interface ImageCollectionData
    extends IConversationDataWithIndexes<Image> {}

export class Image implements IMessage {
    public timestamp: string | undefined;
    constructor(
        public textChunks: string[],
        public metadata: ImageMeta,
        public tags: string[] = [],
    ) {
        this.timestamp = metadata.img.dateTaken;
    }
    getKnowledge(): kpLib.KnowledgeResponse {
        return this.metadata.getKnowledge();
    }
}

// metadata for images
export class ImageMeta implements IKnowledgeSource {
    constructor(
        public fileName: string,
        public img: image.Image,
    ) {}

    getKnowledge() {
        const imageEntity: kpLib.ConcreteEntity = {
            name: `${path.basename(this.img.fileName)} - ${this.img.title}`,
            type: ["file", "image"],
            facets: [
                { name: "File Name", value: this.img.fileName },
                //{ name: "Title", value: this.image.title },
                //{ name: "Caption", value: this.image.title },
            ],
        };

        // EXIF data are facets of this image
        for (let i = 0; i < this.img?.exifData.length; i++) {
            if (
                this.img?.exifData[i] !== undefined &&
                this.img?.exifData[i][1] !== undefined &&
                this.img?.exifData[i][1] !== null &&
                this.img?.exifData[i][1].length > 0
            ) {
                imageEntity.facets!.push({
                    name: this.img?.exifData[i][0],
                    value: this.img?.exifData[i][1],
                });
            }
        }

        // create the return values
        let entities: kpLib.ConcreteEntity[] = [];
        let actions: kpLib.Action[] = [];
        let inverseActions: kpLib.Action[] = [];
        let topics: kpLib.Topic[] = [];
        const timestampParam = [];

        if (this.img.dateTaken) {
            timestampParam.push({
                name: "Timestamp",
                value: this.img.dateTaken,
            });
        }

        // add the image entity
        entities.push(imageEntity);

        // if we have POI those are also entities
        if (this.img.nearbyPOI) {
            for (let i = 0; i < this.img.nearbyPOI.length; i++) {
                const poiEntity: kpLib.ConcreteEntity = {
                    name: this.img.nearbyPOI[i].name!,
                    type: [
                        ...this.img.nearbyPOI[i].categories!,
                        "PointOfInterest",
                    ],
                    facets: [],
                };

                if (this.img.nearbyPOI[i].freeFormAddress) {
                    poiEntity.facets?.push({
                        name: "address",
                        value: this.img.nearbyPOI[i].freeFormAddress!,
                    });
                }

                if (
                    this.img.nearbyPOI[i].position != undefined &&
                    this.img.nearbyPOI[i].position?.latitude != undefined &&
                    this.img.nearbyPOI[i].position?.longitude != undefined
                ) {
                    poiEntity.facets?.push({
                        name: "position",
                        value: JSON.stringify(this.img.nearbyPOI[i].position),
                    });
                    poiEntity.facets?.push({
                        name: "longitude",
                        value: this.img.nearbyPOI[
                            i
                        ].position!.longitude!.toString(),
                    });
                    poiEntity.facets?.push({
                        name: "latitude",
                        value: this.img.nearbyPOI[
                            i
                        ].position!.latitude!.toString(),
                    });
                }

                if (
                    this.img.nearbyPOI[i].categories !== undefined &&
                    this.img.nearbyPOI[i].categories!.length > 0
                ) {
                    poiEntity.facets?.push({
                        name: "category",
                        value: this.img.nearbyPOI[i].categories!.join(","),
                    });
                }

                entities.push(poiEntity);

                actions.push({
                    verbs: ["near"],
                    verbTense: "present",
                    subjectEntityName: this.img.fileName,
                    objectEntityName: this.img.nearbyPOI[i].name!,
                    indirectObjectEntityName: "ME", // TODO: image taker name
                });
            }
        }

        // reverse lookup addresses are also entities
        if (this.img.reverseGeocode) {
            for (let i = 0; i < this.img.reverseGeocode.length; i++) {
                // only put in high confidence items or the first one
                if (
                    (i == 0 ||
                        this.img.reverseGeocode[i].confidence == "High") &&
                    this.img.reverseGeocode[i].address !== undefined
                ) {
                    const addrOutput: AddressOutput =
                        this.img.reverseGeocode[i].address!;
                    const addrEntity: kpLib.ConcreteEntity = {
                        name:
                            this.img.reverseGeocode[i].address!
                                .formattedAddress ?? "",
                        type: ["address"],
                        facets: [],
                    };

                    // Add the address of the image as a facet to it's entity
                    if (i == 0 && addrOutput.formattedAddress) {
                        imageEntity.facets?.push({
                            name: "address",
                            value: addrOutput.formattedAddress,
                        });
                    }

                    // make the address an entity
                    entities.push(addrEntity);

                    // now make an entity for all of the different parts of the address
                    // and add them as facets to the address
                    if (addrOutput.addressLine) {
                        addrEntity.facets?.push({
                            name: "addressLine",
                            value: addrOutput.addressLine,
                        });
                        entities.push({
                            name: addrOutput.locality ?? "",
                            type: ["locality", "place"],
                        });
                    }
                    if (addrOutput.locality) {
                        addrEntity.facets?.push({
                            name: "locality",
                            value: addrOutput.locality,
                        });
                    }
                    if (addrOutput.neighborhood) {
                        addrEntity.facets?.push({
                            name: "neighborhood",
                            value: addrOutput.neighborhood,
                        });
                        entities.push({
                            name: addrOutput.neighborhood ?? "",
                            type: ["neighborhood", "place"],
                        });
                    }
                    if (addrOutput.adminDistricts) {
                        addrEntity.facets?.push({
                            name: "district",
                            value: JSON.stringify(addrOutput.adminDistricts),
                        });
                        for (
                            let i = 0;
                            i < addrOutput.adminDistricts.length;
                            i++
                        ) {
                            const e: kpLib.ConcreteEntity = {
                                name: addrOutput.adminDistricts[i].name ?? "",
                                type: ["district", "place"],
                                facets: [],
                            };

                            if (addrOutput.adminDistricts[i].shortName) {
                                e.facets?.push({
                                    name: "shortName",
                                    value: addrOutput.adminDistricts[i]
                                        .shortName!,
                                });
                            }

                            entities.push(e);
                        }
                    }
                    if (addrOutput.postalCode) {
                        addrEntity.facets?.push({
                            name: "postalCode",
                            value: addrOutput.postalCode,
                        });
                        entities.push({
                            name: addrOutput.postalCode ?? "",
                            type: ["postalCode", "place"],
                        });
                    }
                    if (addrOutput.countryRegion) {
                        if (
                            addrOutput.countryRegion.name !== undefined &&
                            addrOutput.countryRegion.name.length > 0
                        ) {
                            addrEntity.facets?.push({
                                name: "countryName",
                                value: addrOutput.countryRegion?.name!,
                            });
                        }
                        if (
                            addrOutput.countryRegion.ISO !== undefined &&
                            addrOutput.countryRegion.ISO.length > 0
                        ) {
                            addrEntity.facets?.push({
                                name: "countryISO",
                                value: addrOutput.countryRegion?.ISO!,
                            });
                        }
                        entities.push({
                            name: addrOutput.countryRegion.name ?? "",
                            type: ["country", "place"],
                            //facets: [ { name: "ISO", value: addrOutput.countryRegion.ISO ?? "" } ]
                        });
                    }
                    if (addrOutput.intersection) {
                        addrEntity.facets?.push({
                            name: "intersection",
                            value: JSON.stringify(addrOutput.intersection),
                        });
                        entities.push({
                            name: addrOutput.intersection.displayName ?? "",
                            type: ["intersection", "place"],
                        });
                    }

                    actions.push({
                        verbs: ["captured at"],
                        verbTense: "present",
                        subjectEntityName: imageEntity.name,
                        objectEntityName: addrEntity.name,
                        params: timestampParam,
                        indirectObjectEntityName: "none",
                    });
                }
            }
        }

        // add knowledge response items from ImageMeta to knowledge
        if (this.img.knowledge?.entities) {
            entities = entities.concat(this.img.knowledge?.entities);

            // each extracted entity "is in" the image
            // and all such entities are "contained by" the image
            for (let i = 0; i < this.img.knowledge?.entities.length; i++) {
                actions.push({
                    verbs: ["within"],
                    verbTense: "present",
                    subjectEntityName: this.img.knowledge?.entities[i].name,
                    objectEntityName: imageEntity.name,
                    indirectObjectEntityName: "none",
                    params: timestampParam,
                    subjectEntityFacet: undefined,
                });

                actions.push({
                    verbs: ["contains"],
                    verbTense: "present",
                    subjectEntityName: imageEntity.name,
                    objectEntityName: this.img.knowledge.entities[i].name,
                    indirectObjectEntityName: "none",
                    params: timestampParam,
                    subjectEntityFacet: undefined,
                });
            }
        }
        if (this.img.knowledge?.actions) {
            actions = actions.concat(this.img.knowledge?.actions);
        }
        if (this.img.knowledge?.inverseActions) {
            inverseActions = actions.concat(this.img.knowledge?.inverseActions);
        }
        if (this.img.knowledge?.topics) {
            topics = topics.concat(this.img.knowledge.topics);
        }

        return {
            entities,
            actions,
            inverseActions: inverseActions,
            topics: topics,
        };
    }
}

export class ImageCollection implements IConversation {
    public settings: ConversationSettings;
    public semanticRefIndex: ConversationIndex;
    public secondaryIndexes: ConversationSecondaryIndexes;
    constructor(
        public nameTag: string = "",
        public messages: Image[] = [],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
    ) {
        const [model, embeddingSize] = this.createEmbeddingModel();
        this.settings = createConversationSettings(model, embeddingSize);
        this.semanticRefIndex = new ConversationIndex();
        this.secondaryIndexes = new ConversationSecondaryIndexes(this.settings);
    }

    public addMetadataToIndex() {
        if (this.semanticRefIndex) {
            addMessageKnowledgeToSemanticRefIndex(
                this,
                0,
                (type, knowledge) => {
                    if (type === "entity") {
                        return !isDuplicateEntity(
                            knowledge as kpLib.ConcreteEntity,
                            this.semanticRefs,
                        );
                    }
                    return true;
                },
            );
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

    public async writeToFile(
        dirPath: string,
        baseFileName: string,
    ): Promise<void> {
        const data = await this.serialize();
        await writeConversationDataToFile(data, dirPath, baseFileName);
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

/**
 * Indexes the supplied image or images in the supplied folder.
 *
 * @param imagePath - The path to the image file or a folder containing images
 * @param cachePath - The root cache path, if not specified image path is used
 * @param cachePath - The root cache path, if not specified image path is used
 * @param recursive - A flag indicating if the search should include subfolders
 * @returns - The imported images as an image collection.
 */
export async function importImages(
    imagePath: string,
    cachePath: string | undefined,
    recursive: boolean = true,
    callback?: (text: string, count: number, max: number) => void,
): Promise<ImageCollection> {
    let isDir = isDirectoryPath(imagePath);

    if (!fs.existsSync(imagePath)) {
        throw Error(
            `The supplied file or folder '${imagePath}' does not exist.`,
        );
    }

    if (cachePath !== undefined) {
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath);
        }
    } else {
        cachePath = imagePath;
    }

    // create a model used to extract data from the images
    const chatModel = createKnowledgeModel();

    let images: Image[] = [];
    if (isDir) {
        images = await indexImages(
            imagePath,
            cachePath,
            recursive,
            chatModel,
            callback,
        );
    } else {
        const img = await indexImage(imagePath, cachePath, chatModel);
        if (img !== undefined) {
            images.push(img);
        }
    }

    return new ImageCollection(path.dirname(imagePath), images);
}

/**
 * Imports images from the supplied folder.
 *
 * @param sourcePath - The folder to import.
 * @param cachePath - The folder to cache the knowledge responses in
 * @param recursive - A flag indicating whether or not subfolders are imported.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported images from the supplied folder.
 */
async function indexImages(
    sourcePath: string,
    cachePath: string,
    recursive: boolean,
    chatModel: ChatModel,
    callback?: (text: string, count: number, max: number) => void,
): Promise<Image[]> {

    const retVal: Image[] = [];

    // load files from the supplied directory
    try {
        const fileNames = await fs.promises.readdir(sourcePath, {
            recursive: true,
        });

        // create the cache path if it doesn't exist
        if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath);
        }

        // index each image
        for (let i = 0; i < fileNames.length; i++) {
            // ignore thumbnail images
            if (fileNames[i].toLocaleLowerCase().endsWith(".thumbnail.jpg")) {
                console.log(`ignoring '${fileNames[i]}'`);
                continue;
            }

            const fullFilePath: string = path.join(sourcePath, fileNames[i]);

            if (isDirectoryPath(fullFilePath)) {
                retVal.push(
                    ...(await indexImages(
                        fullFilePath,
                        path.join(cachePath, fileNames[i]),
                        true,
                        chatModel,
                        callback,
                    )),
                );
            } else {
                // index the image
                const img = await indexImage(fullFilePath, cachePath, chatModel);

                if (callback && img) {
                    callback(fileNames[i], i, fileNames.length);
                }

                if (img !== undefined) {
                    retVal.push(img);
                }
            }
        }
    } catch (error) {
        debug(error);
    }

    return retVal;
}

/**
 * Imports the supplied image file (if it's an image)
 *
 * @param fileName - The file to import
 * @param cachePath - The folder to cache the knowledge response in.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported image.
 */
async function indexImage(
    fileName: string,
    cachePath: string,
    chatModel: ChatModel,
): Promise<Image | undefined> {
    if (!fs.existsSync(fileName)) {
        console.log(`Could not find part of the file path '${fileName}'`);
        return;
    } else if (!isImageFileType(path.extname(fileName))) {
        //console.log(`Skipping '${fileName}', not a known image file.`);
        return;
    }

    const img: image.Image | undefined = await image.loadImageWithKnowledge(
        fileName,
        cachePath,
        chatModel,
    );

    if (img !== undefined) {
        return new Image([img.fileName], new ImageMeta(fileName, img!));
    }

    return undefined;
}

/**
 *
 * @param entity The entity to match
 * @param semanticRefs The semantic references in the index
 * @returns True if there's a duplicate, false otherwise
 */
function isDuplicateEntity(
    entity: kpLib.ConcreteEntity,
    semanticRefs: SemanticRef[],
) {
    for (let i = 0; i < semanticRefs.length; i++) {
        if (
            semanticRefs[i].knowledgeType == "entity" &&
            entity.name ==
                (semanticRefs[i].knowledge as kpLib.ConcreteEntity).name
        ) {
            if (
                JSON.stringify(entity) ===
                JSON.stringify(semanticRefs[i].knowledge)
            ) {
                return true;
            }
        }
    }

    return false;
}
