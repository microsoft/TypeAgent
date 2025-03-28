// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChatModel } from "aiclient";
import { StorageProvider } from "../storageProvider.js";
import {
    ConversationSettings,
    createConversation,
} from "../conversation/conversation.js";
import {
    ConversationManager,
    ConversationMessage,
    createConversationManager,
} from "../conversation/conversationManager.js";
import path from "path";
import { createTypeChat, isDirectoryPath, promptLib } from "typeagent";
import { createEntitySearchOptions } from "../conversation/entities.js";
import { Image } from "./imageSchema.js";
import {
    ConcreteEntity,
    KnowledgeResponse,
} from "../conversation/knowledgeSchema.js";
import fs from "node:fs";
import ExifReader from "exifreader";
import { createJsonTranslator, PromptSection } from "typechat";
import {
    addImagePromptContent,
    CachedImageWithDetails,
    getDateTakenFuzzy,
    getMimeType,
    ImagePromptDetails,
    isImageFileType,
    parseDateString,
} from "common-utils";
import { KnowledgeExtractor } from "../conversation/knowledge.js";
import { AddressOutput } from "@azure-rest/maps-search";
import { createTypeScriptJsonValidator } from "typechat/ts";

/**
 * Creates an image memory
 */
export async function createImageMemory(
    model: ChatModel,
    answerModel: ChatModel,
    name: string,
    rootPath: string,
    settings: ConversationSettings,
    storageProvider?: StorageProvider,
) {
    const storePath = path.join(rootPath, name);
    //settings.initializer ??= setupEmailConversation;
    const imageConversation = await createConversation(
        settings,
        storePath,
        undefined,
        undefined,
        storageProvider,
    );
    // const userProfile = await readJsonFile<any>(
    //     path.join(rootPath, "emailUserProfile.json"),
    // );
    const cm = await createConversationManager(
        {
            model,
            answerModel,
            initializer: (c) => setupImageConversationManager(c, undefined),
        },
        name,
        rootPath,
        false,
        imageConversation,
    );
    return cm;
}

async function setupImageConversationManager(
    cm: ConversationManager,
    userProfile: any,
): Promise<void> {
    cm.topicMerger.settings.mergeWindowSize = 1;
    cm.topicMerger.settings.trackRecent = false;

    const entityIndex = await cm.conversation.getEntityIndex();
    entityIndex.noiseTerms.put("photo");
    entityIndex.noiseTerms.put("image");

    cm.searchProcessor.actions.requestInstructions =
        "The following is a user request about images in their picture library.\n" +
        "\n" +
        "When generating the filter, ignore 'photo', 'image' and 'screenshot' as noise words\n";

    cm.searchProcessor.answers.settings.hints =
        "messages are *images* with infomration such as title, caption, EXIF tags. " +
        "To answer questions correctly, use the image information to correctly answer the user's question." +
        "If you are not sure, return NoAnswer.";
    cm.searchProcessor.settings.defaultEntitySearchOptions =
        createEntitySearchOptions(true);
    // cm.searchProcessor.settings.defaultEntitySearchOptions.nameSearchOptions!.maxMatches = 25;
}

/**
 * Add an image to a conversation
 * @param cm
 * @param emails
 */
export async function addImageToConversation(
    cm: ConversationManager,
    images: Image | Image[],
    maxCharsPerChunk: number,
    extractor: KnowledgeExtractor,
): Promise<void> {
    const messages: ConversationMessage[] = [];
    if (Array.isArray(images)) {
        for (const image of images) {
            messages.push(await imageToMessage(image, extractor));
        }
    } else {
        messages.push(await imageToMessage(images, extractor));
    }
    await cm.addMessageBatch(messages);
}

/**
 * Convert an image to a conversation message
 * Includes an knowledge that can be automatically extracted from the image
 * @param image
 * @returns
 */
export async function imageToMessage(
    image: Image,
    extractor: KnowledgeExtractor,
): Promise<ConversationMessage> {
    const kr: KnowledgeResponse | undefined = await extractor.extract(
        JSON.stringify(image),
    );

    const knowledge = getKnowledgeForImage(image, extractor);
    kr!.actions = kr!.actions.concat(knowledge.actions);
    kr!.entities = kr!.entities.concat(knowledge.entities);
    kr!.inverseActions = kr!.inverseActions.concat(knowledge.inverseActions);
    kr!.topics = kr!.topics.concat(knowledge.topics);

    // TODO: add actions for all extracted entities being photographed/contained by image
    if (kr?.entities) {
        for (let i = 0; i < kr?.entities.length; i++) {
            // each extracted entity "is in" the image
            // and all such entities are "contained by" the image
            kr.actions.push({
                verbs: ["is in"],
                verbTense: "present",
                subjectEntityName: "none",
                objectEntityName: kr.entities[i].name,
                indirectObjectEntityName: knowledge.entities[0].name, // the image name
                params: [],
                subjectEntityFacet: undefined,
            });

            kr.actions.push({
                verbs: ["contains"],
                verbTense: "present",
                subjectEntityName: "none",
                objectEntityName: knowledge.entities[0].name,
                indirectObjectEntityName: kr.entities[i].name, // the image name
                params: [],
                subjectEntityFacet: undefined,
            });

            // retVal.actions.push({
            //     verbs: [ "taken", "pictured", "photographed" ],
            //     verbTense: "past",
            //     subjectEntityName: imageEntity.name,
            //     objectEntityName
            // })
            // "actions": [
            //     {
            //         "verbs": ["hike"],
            //         "verbTense": "present",
            //         "subjectEntityName": "none",
            //         "objectEntityName": "hiking trail",
            //         "indirectObjectEntityName": "none"
            //     }
            // ],
        }
    }

    return {
        header: `${image.fileName} - ${image.title}`,
        text: image.caption,
        knowledge: kr,
        timestamp: parseDateString(image.dateTaken),
        sender: "", // TODO: logged in user for now?
    };
}

export function getKnowledgeForImage(
    image: Image,
    extractor: KnowledgeExtractor,
): KnowledgeResponse {
    const imageEntity: ConcreteEntity = {
        name: image.fileName,
        type: ["file", "image"],
        facets: [{ name: "File Name", value: image.fileName }],
    };

    // EXIF data are facets of this image
    for (let i = 0; i < image?.exifData.length; i++) {
        if (
            image?.exifData[i] !== undefined &&
            image?.exifData[i][1] !== undefined
        ) {
            imageEntity.facets!.push({
                name: image?.exifData[i][0],
                value: image?.exifData[i][1],
            });
        }
    }

    // create the return value
    const retVal: KnowledgeResponse = {
        entities: [imageEntity],
        actions: [],
        inverseActions: [],
        topics: [],
    };

    // if we have POI those are also entities
    if (image.nearbyPOI) {
        for (let i = 0; i < image.nearbyPOI.length; i++) {
            const poiEntity: ConcreteEntity = {
                name: image.nearbyPOI[i].name!,
                type: [...image.nearbyPOI[i].categories!, "PointOfInterest"],
                facets: [
                    {
                        name: "address",
                        value: image.nearbyPOI[i].freeFormAddress ?? "",
                    },
                    {
                        name: "position",
                        value:
                            JSON.stringify(image.nearbyPOI[i].position) ?? "",
                    },
                    {
                        name: "longitude",
                        value:
                            image.nearbyPOI[
                                i
                            ].position?.longitude?.toString() ?? "",
                    },
                    {
                        name: "latitude",
                        value:
                            image.nearbyPOI[i].position?.latitude?.toString() ??
                            "",
                    },
                ],
            };

            retVal.entities.push(poiEntity);
        }
    }

    // reverse lookup addresses are also entities
    if (image.reverseGeocode) {
        for (let i = 0; i < image.reverseGeocode.length; i++) {
            // only put in high confidence items or the first one
            if (
                (i == 0 || image.reverseGeocode[i].confidence == "High") &&
                image.reverseGeocode[i].address !== undefined
            ) {
                const addrOutput: AddressOutput =
                    image.reverseGeocode[i].address!;
                const addrEntity: ConcreteEntity = {
                    name:
                        image.reverseGeocode[i].address!.formattedAddress ?? "",
                    type: ["address"],
                    facets: [
                        {
                            name: "addressLine",
                            value: addrOutput.addressLine ?? "",
                        },
                        { name: "locality", value: addrOutput.locality ?? "" },
                        {
                            name: "neighborhood",
                            value: addrOutput.neighborhood ?? "",
                        },
                        {
                            name: "adminDistricts",
                            value:
                                JSON.stringify(addrOutput.adminDistricts) ?? "",
                        },
                        {
                            name: "postalCode",
                            value: addrOutput.postalCode ?? "",
                        },
                        {
                            name: "countryName",
                            value: addrOutput.countryRegion?.name ?? "",
                        },
                        {
                            name: "countryISO",
                            value: addrOutput.countryRegion?.ISO ?? "",
                        },
                        {
                            name: "intersection",
                            value:
                                JSON.stringify(addrOutput.intersection) ?? "",
                        },
                    ],
                };

                // make the address an entity
                retVal.entities.push(addrEntity);

                // now make an entity for all of the different parts of teh address
                if (addrOutput.addressLine) {
                    retVal.entities.push({
                        name: addrOutput.locality ?? "",
                        type: ["locality", "place"],
                    });
                }
                if (addrOutput.neighborhood) {
                    retVal.entities.push({
                        name: addrOutput.neighborhood ?? "",
                        type: ["neighborhood", "place"],
                    });
                }
                if (addrOutput.adminDistricts) {
                    for (let i = 0; i < addrOutput.adminDistricts.length; i++) {
                        retVal.entities.push({
                            name: addrOutput.adminDistricts[i].name ?? "",
                            type: ["district", "place"],
                            facets: [
                                {
                                    name: "shortName",
                                    value:
                                        addrOutput.adminDistricts[i]
                                            .shortName ?? "",
                                },
                            ],
                        });
                    }
                }
                if (addrOutput.postalCode) {
                    retVal.entities.push({
                        name: addrOutput.postalCode ?? "",
                        type: ["postalCode", "place"],
                    });
                }
                if (addrOutput.countryRegion) {
                    retVal.entities.push({
                        name: addrOutput.countryRegion.name ?? "",
                        type: ["country", "place"],
                        facets: [
                            {
                                name: "ISO",
                                value: addrOutput.countryRegion.ISO ?? "",
                            },
                        ],
                    });
                }
                if (addrOutput.intersection) {
                    retVal.entities.push({
                        name: addrOutput.intersection.displayName ?? "",
                        type: ["intersection", "place"],
                    });
                }
            }
        }
    }

    // actions
    // retVal.actions.push({
    //     verbs: [ "taken", "pictured", "photographed" ],
    //     verbTense: "past",
    //     subjectEntityName: imageEntity.name,
    //     objectEntityName
    // })

    return retVal;
}

const imageCaptionGeneratingSchema = `
// An interface that describes an image in detail
export interface generateCaption {
    // A short, descriptive title for this image
    title: string;
    // A detailed image description
    caption: string;
    // The image file name
    fileName: string;
    // The image width in pixels
    width: number;
    // The image height in pixels
    height: number;
    // The date the image was taken
    dateTaken: string
}`;

const imageDetailExtractionSchema = `
export type Quantity = {
    amount: number;
    units: string;
};

export type Value = string | number | boolean | Quantity;

export type Facet = {
    name: string;
    // Very concise values.
    value: Value;
};

// Specific, tangible people, places, institutions or things only
export type ConcreteEntity = {
    // the name of the entity or thing such as "Bach", "Great Gatsby", "frog" or "piano"
    name: string;
    // the types of the entity such as "speaker", "person", "artist", "animal", "object", "instrument", "school", "room", "museum", "food" etc.
    // An entity can have multiple types; entity types should be single words
    type: string[];
    // A specific, inherent, defining, or non-immediate facet of the entity such as "blue", "old", "famous", "sister", "aunt_of", "weight: 4 kg"
    // trivial actions or state changes are not facets
    // facets are concise "properties"
    facets?: Facet[];
};

export type ActionParam = {
    name: string;
    value: Value;
};

export type VerbTense = "past" | "present" | "future";

export type Action = {
    // Each verb is typically a word
    verbs: string[];
    verbTense: VerbTense;
    subjectEntityName: string | "none";
    objectEntityName: string | "none";
    indirectObjectEntityName: string | "none";
    params?: (string | ActionParam)[];
    // If the action implies this additional facet or property of the subjectEntity, such as hobbies, activities, interests, personality
    subjectEntityFacet?: Facet | undefined;
};

// Detailed and comprehensive knowledge response
export type KnowledgeResponse = {
    entities: ConcreteEntity[];
    // The 'subjectEntityName' and 'objectEntityName' must correspond to the 'name' of an entity listed in the 'entities' array.
    actions: Action[];
    // Some actions can ALSO be expressed in a reverse way... e.g. (A give to B) --> (B receive from A) and vice versa
    // If so, also return the reverse form of the action, full filled out
    inverseActions: Action[];
    // Detailed, descriptive topics and keyword.
    topics: string[];
};

// An interface that describes an image in detail
export interface imageDetailExtractionSchema {
    // A short, descriptive title for this image
    title: string;
    // Alternative text for this image
    altText: string;
    // A very detailed and factual image caption of no less than 200 words.  
    // Ignore image orientation.
    // Include descriptive adjectives like color, motion, etc.
    caption: string;
    // Knowledge extracted from the image including all visible (or implied) entities, actions, and topics
    knowledge: KnowledgeResponse;
};
`;

// An interface that describes an image in detail
export interface generateCaption {
    // A short, descriptive title for this image
    title: string;
    // Alternative text for this image
    altText: string;
    // A detailed image description of no less than 175 words.
    caption: string;
    // The image file name
    fileName: string;
    // The image width in pixels
    width: number;
    // The image height in pixels
    height: number;
    // The date the image was taken
    dateTaken: string;
}

// An interface that describes an image in detail
export interface imageDetailExtractionSchema {
    // A short, descriptive title for this image
    title: string;
    // Alternative text for this image
    altText: string;
    // A very detailed and factual image caption of no less than 200 words.
    // Ignore image orientation.
    // Include descriptive adjectives like color, motion, etc.
    caption: string;
    // Knowledge extracted from the image including all visible (or implied) entities, actions, and topics
    knowledge: KnowledgeResponse;
}

/**
 *
 * @param fileName The image file to load
 * @param model The language model being used to describe the image.
 * @param loadCachedDetails A flag indicating if cached image descriptions should be loaded if available.
 * @param cacheFolder The folder to find cached image data. If not supplied defaults to the image folder.
 * @returns The described image.
 */
export async function loadImage(
    fileName: string,
    model: ChatModel,
    loadCachedDetails: boolean = true,
    cacheFolder: string | undefined = undefined,
): Promise<Image | undefined> {
    if (cacheFolder === undefined) {
        cacheFolder = path.dirname(fileName);
    }

    const cachedFileName: string = path.join(
        cacheFolder,
        fileName + ".kr.json",
    );
    if (loadCachedDetails && fs.existsSync(cachedFileName)) {
        return JSON.parse(fs.readFileSync(cachedFileName, "utf8"));
    }

    const buffer: Buffer = fs.readFileSync(fileName);

    // load EXIF properties
    const tags: ExifReader.Tags = ExifReader.load(buffer);
    const properties: string[][] = [];
    for (const tag of Object.keys(tags)) {
        if (tags[tag]) {
            properties.push([tag, tags[tag].description]);
        }
    }
    const mimeType = getMimeType(path.extname(fileName));
    const loadedImage: CachedImageWithDetails = new CachedImageWithDetails(
        tags,
        fileName,
        `data:image/${mimeType};base64,${buffer.toString("base64")}`,
    );

    // create a caption for the image
    const caption = createTypeChat<generateCaption>(
        model,
        imageCaptionGeneratingSchema,
        "generateCaption",
        `You are photography expert.`,
        [],
        4096,
        30,
    );

    try {
        const prompt: PromptSection[] = [];
        const content: ImagePromptDetails = await addImagePromptContent(
            "user",
            loadedImage,
            true,
            false,
            false,
            true,
            true,
        );
        prompt.push(promptLib.dateTimePromptSection()); // Always include the current date and time. Makes the bot much smarter
        prompt.push(content.promptSection!);

        const chatResponse = await caption.translate(
            "Caption supplied images in no less than 200 words without making any assumptions, remain factual.",
            prompt,
        );

        if (chatResponse.success) {
            const retVal = {
                title: chatResponse.data.title,
                altText: chatResponse.data.altText,
                caption: chatResponse.data.caption,
                width: -1,
                height: -1,
                fileName: fileName,
                dateTaken: "",
                exifData: properties,
                nearbyPOI: content.nearbyPOI,
                reverseGeocode: content.reverseGeocode,
            };

            // cache this information for possible reuse later
            fs.writeFileSync(cachedFileName, JSON.stringify(retVal));

            // return the image description
            return retVal;
        } else {
            const err = `Unable to load ${fileName}. '${chatResponse.message}'`;
            console.error("\t" + err);
            //throw new Error(err);
            return undefined;
        }
    } catch {
        return undefined;
    }
}

/**
 * Loads the image and then uses the LLM and other APIs to get POI, KnowledgeResponse, address, etc.
 *
 * @param fileName The image file to load
 * @param cachePath The path where the image knowledge response is to be cached
 * @param model The language model being used to describe the image.
 * @param loadCachedDetails A flag indicating if cached image descriptions should be loaded if available.
 * @returns The described image.
 */
export async function loadImageWithKnowledge(
    fileName: string,
    cachePath: string,
    model: ChatModel,
    loadCachedDetails: boolean = true,
): Promise<Image | undefined> {
    const cachedFileName: string = path.join(
        cachePath,
        path.basename(fileName) + ".kr.json",
    );
    if (loadCachedDetails && fs.existsSync(cachedFileName)) {
        return JSON.parse(fs.readFileSync(cachedFileName, "utf8"));
    }

    const buffer: Buffer = fs.readFileSync(fileName);

    // load EXIF properties
    const tags: ExifReader.Tags = ExifReader.load(buffer);
    const properties: string[][] = [];
    for (const tag of Object.keys(tags)) {
        if (tags[tag]) {
            properties.push([tag, tags[tag].description]);
        }
    }
    const mimeType = getMimeType(path.extname(fileName));
    const loadedImage: CachedImageWithDetails = new CachedImageWithDetails(
        tags,
        fileName,
        `data:image/${mimeType};base64,${buffer.toString("base64")}`,
    );

    const validator =
        createTypeScriptJsonValidator<imageDetailExtractionSchema>(
            imageDetailExtractionSchema,
            "imageDetailExtractionSchema",
        );
    const translator = createJsonTranslator<imageDetailExtractionSchema>(
        model,
        validator,
    );

    translator.createRequestPrompt = createRequestPrompt;
    function createRequestPrompt(request: string) {
        return (
            `You are a service that translates images into JSON objects of type "imageDetailExtractionSchema" according to the following TypeScript definitions::\n` +
            `\`\`\`\n${imageDetailExtractionSchema}\`\`\`\n`
            //            `The following are messages in a conversation:\n` +
            //            `"""\n${request}\n"""\n` +
            //            `The following is the user request translated into a JSON object with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }

    // create a caption for the image
    // const caption = createTypeChat<imageDetailExtractionSchema>(
    //     model,
    //     imageCaptionGeneratingSchema,
    //     "imageDetailExtractionSchema",
    //     createRequestPrompt(),//`You are photography expert.`,
    //     [],
    //     4096,
    //     30,
    // );

    try {
        const content: ImagePromptDetails = await addImagePromptContent(
            "user",
            loadedImage,
            false,
            false,
            false,
            false,
            false,
        );
        //prompt.push(promptLib.dateTimePromptSection()); // Always include the current date and time. Makes the bot much smarter
        //prompt.push(content.promptSection!);

        // const chatResponse = await caption.translate(
        //     "Caption supplied images in no less than 175 words without making any assumptions, remain factual.",
        //     prompt,
        // );

        const chatResponse = await translator.translate("", [
            content.promptSection!,
        ]);

        if (chatResponse.success) {
            const retVal = {
                title: chatResponse.data.title,
                altText: chatResponse.data.altText,
                caption: chatResponse.data.caption,
                exifData: properties,
                nearbyPOI: content.nearbyPOI,
                reverseGeocode: content.reverseGeocode,
                knowledge: chatResponse.data.knowledge,
                width: -1,
                height: -1,
                fileName: fileName,
                dateTaken: "",
            };

            // cache this information for possible reuse later
            fs.writeFileSync(cachedFileName, JSON.stringify(retVal));

            // return the image description
            return retVal;
        } else {
            const err = `Unable to load ${fileName}. '${chatResponse.message}'`;
            console.error("\t" + err);
            //throw new Error(err);
            return undefined;
        }
    } catch {
        return undefined;
    }
}

interface imageFileAndDate {
    fileName: string;
    dateTaken: Date;
}

/**
 * Builds a histogram of image counts per bucket of time
 * @param filePath The path of the folder to build a histogram for
 */
export function buildImageCountHistogram(
    filePath: string,
    recursive: boolean = true,
    bucketSizeInSeconds: number = 300,
) {
    // paramter checking
    if (!fs.existsSync(filePath)) {
        throw new Error(`The supplied path '${filePath}' does not exist`);
    } else if (!isDirectoryPath(filePath)) {
        throw new Error(`The supplied path must be a directory.`);
    }

    // get all of the images files and the dates they were taken
    const allImageFiles: imageFileAndDate[] = [];
    const files: fs.Dirent[] = fs.readdirSync(filePath, {
        recursive,
        encoding: null,
        withFileTypes: true,
    });
    files.map((file) => {
        if (file.isFile()) {
            if (isImageFileType(path.extname(file.name))) {
                allImageFiles.push({
                    fileName: path.join(file.path, file.name),
                    dateTaken: getDateTakenFuzzy(
                        path.join(file.path, file.name),
                    ),
                });
            }
        }
    });

    // now sort the images by date/time
    allImageFiles.sort((a: imageFileAndDate, b: imageFileAndDate) => {
        if (a.dateTaken === undefined && b.dateTaken === undefined) {
            return 0;
        } else if (a.dateTaken === undefined && b.dateTaken !== undefined) {
            return -1;
        } else if (a.dateTaken !== undefined && b.dateTaken === undefined) {
            return 1;
        } else {
            return a.dateTaken!.getTime() - b.dateTaken!.getTime();
        }
    });

    // now bucketize
    const histogram: number[] = [];
    const startDate: number = allImageFiles[0].dateTaken.getTime() / 1000;
    const endDate: number =
        allImageFiles[allImageFiles.length - 1].dateTaken.getTime() / 1000;

    // how many buckets do we need?
    const buckets: number = Math.ceil(
        (endDate - startDate) / bucketSizeInSeconds,
    );

    // now count how many images are in each bucket
    for (let i = 0; i < allImageFiles.length; i++) {
        const currentBucketLimit =
            (histogram.length + 1) * bucketSizeInSeconds + startDate;

        if (allImageFiles[i].dateTaken.getTime() <= currentBucketLimit) {
            histogram[histogram.length]++;
        } else {
            // we've gotten to a new bucket
            histogram.push(0);
        }
    }

    if (histogram.length != buckets) {
        throw Error("Bucket calculation mismatch!");
    }

    fs.writeFileSync(
        "histogram.json",
        JSON.stringify({ startDate, endDate, bucketSizeInSeconds, histogram }),
    );
}
