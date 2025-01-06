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
import { readJsonFile } from "typeagent";
import { createEntitySearchOptions } from "../conversation/entities.js";
import { Image } from "./imageSchema.js";
import { KnowledgeResponse } from "../conversation/knowledgeSchema.js";

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
        timestamp: image.dateTaken,
        sender: "", // TODO: logged in user for now?
    };
}

export function getKnowledgeForImage(iamge: Image): KnowledgeResponse {
    throw new Error("// TODO: implement");
}

export function loadImage(fileName: string): Image {
    throw new Error("// TODO: implement");
}
