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
import { createTypeChat, promptLib, readJsonFile } from "typeagent";
import { createEntitySearchOptions } from "../conversation/entities.js";
import { Image } from "./imageSchema.js";
import { KnowledgeResponse } from "../conversation/knowledgeSchema.js";
import fs from "node:fs";
import ExifReader from "exifreader";
import { PromptSection } from "typechat";
import { addImagePromptContent, CachedImageWithDetails, getMimeType, parseDateString } from "common-utils";

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
    const emailConversation = await createConversation(
        settings,
        storePath,
        undefined,
        undefined,
        storageProvider,
    );
    const userProfile = await readJsonFile<any>(
        path.join(rootPath, "emailUserProfile.json"),
    );
    const cm = await createConversationManager(
        {
            model,
            answerModel,
            initializer: (c) => setupImageConversationManager(c, userProfile),
        },
        name,
        rootPath,
        false,
        emailConversation,
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
        "The following is a user request about the messages in their email inbox. The email inbox belongs to:\n" +
        JSON.stringify(userProfile, undefined, 2) +
        "\n" +
        "When generating the filter, ignore 'email', 'inbox' and 'message' as noise words\n";
    //"User specific first person pronouns are rewritten to use user's name, but general ones are not.";

    cm.searchProcessor.answers.settings.hints =
        "messages are *emails* with email headers such as To, From, Cc, Subject. etc. " +
        "To answer questions correctly, use the headers to determine who the email is from and who it was sent to. " +
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
): Promise<void> {
    const messages: ConversationMessage[] = [];
    if (Array.isArray(images)) {
        for (const image of images) {
            messages.push(imageToMessage(image));
        }
    } else {
        messages.push(imageToMessage(images));
    }
    await cm.addMessageBatch(messages);
}

/**
 * Convert an image to a conversation message
 * Includes an knowledge that can be automatically extracted from the image
 * @param image
 * @returns
 */
export function imageToMessage(image: Image): ConversationMessage {
    // const sender = email.from.displayName;
    // return {
    //     header: emailHeadersToString(email),
    //     text: emailToTextBlock(email, false),
    //     knowledge: emailToKnowledge(email),
    //     timestamp: dateTime.stringToDate(email.sentOn),
    //     sender,
    // };

    // TODO:    get image caption
    //          EXIF data
    //          Create "taken by" knowledge

    return {
        header: image.fileName,
        text: image.caption,
        knowledge: getKnowledgeForImage(image),
        timestamp: parseDateString(image.dateTaken),
        sender: "", // TODO: logged in user for now?
    };
}

export function getKnowledgeForImage(image: Image): KnowledgeResponse {
    //throw new Error("// TODO: implement");
    return {
       entities: [],
       actions: [],
       inverseActions: [],
       topics: [] 
    };
}

const imageCaptionGeneratingSchema = 
`// An interface that describes an image in detail
export interface generateCaption {
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

export async function loadImage(fileName: string, model: ChatModel): Promise<Image> {

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
        prompt.push(promptLib.dateTimePromptSection()); // Always include the current date and time. Makes the bot much smarter
        prompt.push(content);

        const chatResponse = await caption.translate(
            "Caption supplied images in no less than 150 words without making any assumptions, remain factual.",
            prompt, 
        );


        if (chatResponse.success) {
            return {
                caption: chatResponse.data.caption,
                width: chatResponse.data.width,
                height: chatResponse.data.height,
                fileName: chatResponse.data.fileName,
                dateTaken: chatResponse.data.dateTaken,
                metaData: properties
            };    
        } else {
            throw new Error(`Unable to load ${fileName}`);
        }
    }
    catch {
        throw new Error(`Unable to load ${fileName}`);
    }
}
