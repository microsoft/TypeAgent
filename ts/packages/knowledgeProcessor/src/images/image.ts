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
import { createTypeChat, isDirectoryPath } from "typeagent";
import { createEntitySearchOptions } from "../conversation/entities.js";
import { Image } from "./imageSchema.js";
import { KnowledgeResponse } from "../conversation/knowledgeSchema.js";
import fs from "node:fs";
import ExifReader from "exifreader";
import { PromptSection } from "typechat";
import { addImagePromptContent, CachedImageWithDetails, getDateTakenFuzzy, getMimeType, isImageFileType, parseDateString } from "common-utils";
import { KnowledgeExtractor } from "../conversation/knowledge.js";

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
    extractor: KnowledgeExtractor
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
export async function imageToMessage(image: Image, extractor: KnowledgeExtractor): Promise<ConversationMessage> {

    const kr: KnowledgeResponse | undefined = await extractor.extract(JSON.stringify(image));

    // const knowledge = getKnowledgeForImage(image, extractor);
    // kr?.actions.push(...knowledge.actions);
    // kr?.entities.push(...knowledge.entities);
    // kr?.inverseActions.push(...knowledge.inverseActions);
    // kr?.topics.push(...knowledge.topics);

    return {
        header: `${image.fileName} - ${image.title}` ,
        text: image.caption,
        knowledge: kr,
        timestamp: parseDateString(image.dateTaken),
        sender: "", // TODO: logged in user for now?
    };
}

export function getKnowledgeForImage(image: Image, extractor: KnowledgeExtractor): KnowledgeResponse {

    // TODO: optimize
    return {
       entities: [ { name: image.fileName, type: ["file", "image"]} ],
       actions: [],
       inverseActions: [],
       topics: [] 
    };
}

const imageCaptionGeneratingSchema = 
`// An interface that describes an image in detail
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
}

export async function loadImage(fileName: string, model: ChatModel): Promise<Image | undefined> {

    const buffer: Buffer = fs.readFileSync(fileName);

    // load EXIF properties
    const tags: ExifReader.Tags = ExifReader.load(buffer);
    const properties: string[][] = [];
    for (const tag of Object.keys(tags)) {
        if (tags[tag]) {
            properties.push([tag, tags[tag].value]);
        }
    }
    const mimeType = getMimeType(path.extname(fileName));
    const loadedImage: CachedImageWithDetails = new CachedImageWithDetails(tags, fileName, `data:image/${mimeType};base64,${buffer.toString("base64")}`);

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
        const content: PromptSection = await addImagePromptContent("user", loadedImage, true, true, true, true, true);
        //prompt.push(promptLib.dateTimePromptSection()); // Always include the current date and time. Makes the bot much smarter
        prompt.push(content);

        const chatResponse = await caption.translate(
        //    "Caption supplied images in no less than 250 words without making any assumptions, remain factual. Incorporate supplied EXIF and location data to make a better description and to give context to when and where the image was taken.",
        "Caption supplied images in no less than 150 words without making any assumptions, remain factual.",
            prompt, 
        );


        if (chatResponse.success) {
            return {
                title: chatResponse.data.title,
                caption: chatResponse.data.caption,
                width: chatResponse.data.width,
                height: chatResponse.data.height,
                fileName: chatResponse.data.fileName,
                dateTaken: chatResponse.data.dateTaken,
                metaData: properties
            };    
        } else {
            const err = `Unable to load ${fileName}. '${chatResponse.message}'`;
            console.error("\t" + err)
            throw new Error(err);
        }
    }
    catch {
        return undefined;
    }
}

interface imageFileAndDate {
    fileName: string,
    dateTaken: Date
}

/**
 * Builds a histogram of image counts per bucket of time
 * @param filePath The path of the folder to build a histogram for
 */
export function buildImageCountHistogram(filePath: string, recursive: boolean = true, bucketSizeInSeconds: number = 300) {

    // paramter checking
    if (!fs.existsSync(filePath)) {
        throw new Error(`The supplied path '${filePath}' does not exist`);
    } else if (!isDirectoryPath(filePath)) {
        throw new Error(`The supplied path must be a directory.`);
    }

    // get all of the images files and the dates they were taken
    const allImageFiles: imageFileAndDate[] = [];
    const files: fs.Dirent[] = fs.readdirSync(filePath, { recursive, encoding: null, withFileTypes: true });
    files.map((file) => {

        if (file.isFile()) {
            if (isImageFileType(path.extname(file.name))) {
                allImageFiles.push({
                    fileName: path.join(file.path, file.name),
                    dateTaken: getDateTakenFuzzy(path.join(file.path, file.name)),
                })
            }
        }
    });

    // now sort the images by date/time
    allImageFiles.sort((a: imageFileAndDate, b: imageFileAndDate) => {

        if (a.dateTaken === undefined && b.dateTaken === undefined) {
            return 0;
        } else if (a.dateTaken === undefined && b.dateTaken !== undefined) {
            return -1
        } else if (a.dateTaken !== undefined && b.dateTaken === undefined) {
            return 1;
        } else {
            return a.dateTaken!.getTime() - b.dateTaken!.getTime();
        }        
    });

    // now bucketize
    const histogram: number[] = [];
    const startDate: number = allImageFiles[0].dateTaken.getTime() / 1000;
    const endDate: number = allImageFiles[allImageFiles.length - 1].dateTaken.getTime() / 1000;

    // how many buckets do we need?
    const buckets: number = Math.ceil((endDate - startDate) / bucketSizeInSeconds);
    
    // now count how many images are in each bucket
    for(let i = 0; i < allImageFiles.length; i++) {
        const currentBucketLimit = (histogram.length + 1) * bucketSizeInSeconds + startDate;

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

    fs.writeFileSync("histogram.json", JSON.stringify({ startDate, endDate, bucketSizeInSeconds, histogram }))
}
