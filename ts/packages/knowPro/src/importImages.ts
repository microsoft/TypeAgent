// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    IConversation,
    IConversationData,
    IKnowledgeSource,
    IMessage,
    SemanticRef,
} from "./dataFormat.js";
import { conversation as kpLib, image } from "knowledge-processor";
import {
    ConversationIndex,
    addActionToIndex,
    addEntityToIndex,
    addTopicToIndex,
    ConversationIndexingResult,
    createKnowledgeModel,
} from "./conversationIndex.js";
import { Result } from "typechat";
import { TermToRelatedTermsIndex } from "./relatedTermsIndex.js";
import { TimestampToTextRangeIndex } from "./timestampIndex.js";
import {
    ITermsToRelatedTermsIndexData,
    ITimestampToTextRangeIndex,
} from "./secondaryIndexes.js";
import { addPropertiesToIndex, PropertyIndex } from "./propertyIndex.js";
import fs from "node:fs";
import path from "node:path";
import { isImageFileType } from "common-utils";
import { ChatModel } from "aiclient";
import { AddressOutput } from "@azure-rest/maps-search";
import { ConcreteEntity } from "../../knowledgeProcessor/dist/conversation/knowledgeSchema.js";
import { IPropertyToSemanticRefIndex } from "./secondaryIndexes.js";
import { Topic } from "../../knowledgeProcessor/dist/conversation/topicSchema.js";
import { IConversationThreadData } from "./conversationThread.js";
import { createPodcastSettings, PodcastSettings } from "./import.js";
import { isDirectoryPath } from "typeagent";

export interface ImageCollectionData extends IConversationData<Image> {
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
    threadData?: IConversationThreadData;
}

export interface ImageCollectionData extends IConversationData<Image> {
    relatedTermsIndexData?: ITermsToRelatedTermsIndexData | undefined;
}

export class Image implements IMessage<ImageMeta> {
    public timestamp: string | undefined;
    constructor(
        public textChunks: string[],
        public metadata: ImageMeta,
        public tags: string[] = [],
    ) {
        this.timestamp = metadata.img.dateTaken;
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
        let topics: Topic[] = [];
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
                            const e: ConcreteEntity = {
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

        // add knowledge respone items from ImageMeta to knowledge
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

export class ImageCollection implements IConversation<ImageMeta> {
    public settings: PodcastSettings;
    constructor(
        public nameTag: string,
        public messages: Image[],
        public tags: string[] = [],
        public semanticRefs: SemanticRef[] = [],
        public semanticRefIndex: ConversationIndex | undefined = undefined,
        public termToRelatedTermsIndex:
            | TermToRelatedTermsIndex
            | undefined = undefined,
        public timestampIndex:
            | ITimestampToTextRangeIndex
            | undefined = undefined,
        public propertyToSemanticRefIndex:
            | IPropertyToSemanticRefIndex
            | undefined = undefined,
    ) {
        this.settings = createPodcastSettings();
    }

    public addMetadataToIndex() {
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];
            const knowlegeResponse = msg.metadata.getKnowledge();
            if (this.semanticRefIndex !== undefined) {
                for (const entity of knowlegeResponse.entities) {
                    addEntityToIndex(
                        entity,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                        0,
                        true,
                    );
                }
                for (const action of knowlegeResponse.actions) {
                    addActionToIndex(
                        action,
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
                for (const topic of knowlegeResponse.topics) {
                    addTopicToIndex(
                        { text: topic },
                        this.semanticRefs,
                        this.semanticRefIndex,
                        i,
                    );
                }
            }
        }
    }

    public async buildIndex(
        progressCallback?: (
            text: string,
            knowledgeResult: Result<kpLib.KnowledgeResponse>,
        ) => boolean,
    ): Promise<ConversationIndexingResult> {
        //const result = await buildConversationIndex(this, progressCallback);
        this.semanticRefIndex = new ConversationIndex();
        if (this.semanticRefs === undefined) {
            this.semanticRefs = [];
        }

        this.addMetadataToIndex();

        let indexingResult: ConversationIndexingResult = {
            index: this.semanticRefIndex,
            failedMessages: [],
        };
        return indexingResult;
    }

    public async buildRelatedTermsIndex(
        batchSize: number = 8,
        progressCallback?: (batch: string[], batchStartAt: number) => boolean,
    ): Promise<void> {
        if (this.semanticRefIndex) {
            this.termToRelatedTermsIndex = new TermToRelatedTermsIndex(
                this.settings.relatedTermIndexSettings,
            );
            const allTerms = this.semanticRefIndex?.getTerms();
            await this.termToRelatedTermsIndex.buildEmbeddingsIndex(
                allTerms,
                batchSize,
                progressCallback,
            );
        }
    }

    public serialize(): ImageCollectionData {
        return {
            nameTag: this.nameTag,
            messages: this.messages,
            tags: this.tags,
            semanticRefs: this.semanticRefs,
            semanticIndexData: this.semanticRefIndex?.serialize(),
            relatedTermsIndexData: this.termToRelatedTermsIndex?.serialize(),
        };
    }

    public deserialize(data: ImageCollectionData): void {
        if (data.semanticIndexData) {
            this.semanticRefIndex = new ConversationIndex(
                data.semanticIndexData,
            );
        }
        if (data.relatedTermsIndexData) {
            this.termToRelatedTermsIndex = new TermToRelatedTermsIndex(
                this.settings.relatedTermIndexSettings,
            );
            this.termToRelatedTermsIndex.deserialize(
                data.relatedTermsIndexData,
            );
        }
        this.buildSecondaryIndexes();
    }

    private buildSecondaryIndexes() {
        //this.buildParticipantAliases();
        this.buildPropertyIndex();
        this.buildTimestampIndex();
    }

    private buildPropertyIndex() {
        if (this.semanticRefs && this.semanticRefs.length > 0) {
            this.propertyToSemanticRefIndex = new PropertyIndex();
            addPropertiesToIndex(
                this.semanticRefs,
                this.propertyToSemanticRefIndex,
            );
        }
    }

    private buildTimestampIndex(): void {
        this.timestampIndex = new TimestampToTextRangeIndex(this.messages);
    }
}

/**
 * Indexes the supplied image or images in the supplied folder.
 *
 * @param imagePath - The path to the image file or a folder containing images
 * @param recursive - A flag indicating if the search should include subfolders
 * @returns - The imported images as an image collection.
 */
export async function importImages(
    imagePath: string,
    recursive: boolean = true,
    callback?: (text: string, count: number, max: number) => void,
): Promise<ImageCollection> {
    let isDir = isDirectoryPath(imagePath);

    if (!fs.existsSync(imagePath)) {
        throw Error(
            `The supplied file or folder '${imagePath}' does not exist.`,
        );
    }

    // create a model used to extract data from the images
    const chatModel = createKnowledgeModel();

    let images: Image[] = [];
    if (isDir) {
        images = await indexImages(imagePath, recursive, chatModel, callback);
    } else {
        const img = await indexImage(imagePath, chatModel);
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
 * @param recursive - A flag indicating whether or not subfolders are imported.
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported images from the supplied folder.
 */
async function indexImages(
    sourcePath: string,
    recursive: boolean,
    chatModel: ChatModel,
    callback?: (text: string, count: number, max: number) => void,
): Promise<Image[]> {
    // load files from the supplied directory
    const fileNames = await fs.promises.readdir(sourcePath, {
        recursive: true,
    });

    // index each image
    const retVal: Image[] = [];
    for (let i = 0; i < fileNames.length; i++) {
        const fullFilePath: string = path.join(sourcePath, fileNames[i]);
        //console.log(`${fullFilePath} [${i+1} of ${fileNames.length}] (estimated time remaining: ${clock.elapsedSeconds / (i + 1) * (fileNames.length - i)})`);
        const img = await indexImage(fullFilePath, chatModel);

        if (callback) {
            callback(fileNames[i], i, fileNames.length);
        }

        if (img !== undefined) {
            retVal.push(img);
        }
    }

    return retVal;
}

/**
 * Imports the supplied image file (if it's an image)
 *
 * @param fileName - The file to import
 * @param chatModel - The model used to extract data from the image.
 * @returns - The imported image.
 */
async function indexImage(
    fileName: string,
    chatModel: ChatModel,
): Promise<Image | undefined> {
    if (!fs.existsSync(fileName)) {
        console.log(`Could not find part of the file path '${fileName}'`);
        return;
    } else if (!isImageFileType(path.extname(fileName))) {
        console.log(`Skipping '${fileName}', not a known image file.`);
        return;
    }

    const img: image.Image | undefined = await image.loadImageWithKnowledge(
        fileName,
        chatModel,
    );

    if (img !== undefined) {
        return new Image([img.fileName], new ImageMeta(fileName, img!));
    }

    return undefined;
}
