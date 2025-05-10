// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, dateTime, readJsonFile } from "typeagent";
import {
    Action,
    ConcreteEntity,
    KnowledgeResponse,
} from "../conversation/knowledgeSchema.js";
import { Email, EmailAddress, EmailHeader } from "./emailSchema.js";
import fs from "fs";
import path from "path";
import { removeUndefined } from "../setOperations.js";
import { TextBlock, TextBlockType } from "../text.js";
import {
    ConversationManager,
    ConversationMessage,
    createConversationManager,
} from "../conversation/conversationManager.js";
import {
    Conversation,
    ConversationSettings,
    createConversation,
} from "../conversation/conversation.js";
import { isValidChunkSize, splitLargeTextIntoChunks } from "../textChunker.js";
import { ChatModel } from "aiclient";
import { KnownEntityTypes } from "../conversation/knowledge.js";
import { StorageProvider } from "../storageProvider.js";
import { createEntitySearchOptions } from "../conversation/entities.js";

/**
 * Convert an email to a conversation message
 * Includes an knowledge that can be automatically extracted from the message
 * @param email
 * @returns
 */
export function emailToMessage(email: Email): ConversationMessage {
    const sender = email.from.displayName;
    return {
        header: emailHeadersToString(email),
        text: emailToTextBlock(email, false),
        knowledge: emailToKnowledge(email),
        timestamp: dateTime.stringToDate(email.sentOn),
        sender,
    };
}

/**
 * Convert an email to multiple conversation messages.
 * Large emails are broken into sub-messages.
 * @param email
 * @param maxCharsPerChunk
 * @returns
 */
export function emailToMessages(
    email: Email,
    maxCharsPerChunk?: number | undefined,
): ConversationMessage[] {
    if (!isValidChunkSize(maxCharsPerChunk)) {
        return [emailToMessage(email)];
    }

    const messages: ConversationMessage[] = [];
    const text = email.body;
    for (const chunk of splitLargeTextIntoChunks(text, maxCharsPerChunk!)) {
        const emailChunk: Email = { ...email };
        emailChunk.body = chunk;
        messages.push(emailToMessage(emailChunk));
    }

    return messages;
}

export function emailAddressToString(address: EmailAddress): string {
    if (address.displayName) {
        return address.address
            ? `"${address.displayName}" <${address.address}>`
            : address.displayName;
    }
    return address.address ?? "";
}

export function emailAddressListToString(
    addresses: EmailAddress[] | undefined,
): string {
    if (addresses === undefined || addresses.length === 0) {
        return "";
    }
    return addresses
        ? addresses.map((a) => emailAddressToString(a)).join(", ")
        : "";
}

export function emailAddressToEntities(
    emailAddress: EmailAddress,
): ConcreteEntity[] {
    const entities: ConcreteEntity[] = [];
    if (emailAddress.displayName) {
        const entity: ConcreteEntity = {
            name: emailAddress.displayName,
            type: [KnownEntityTypes.Person],
        };
        entities.push(entity);
        if (emailAddress.address) {
            entity.facets = [];
            entity.facets.push({
                name: "email_address",
                value: emailAddress.address,
            });
        }
    }
    if (emailAddress.address) {
        entities.push({
            name: emailAddress.address,
            type: [
                KnownEntityTypes.Email_Address,
                KnownEntityTypes.Email_Alias,
            ],
        });
    }

    return entities;
}

export function emailHeadersToString(email: Email): string {
    let text = "";
    if (email.from) {
        text += makeHeader("From", emailAddressToString(email.from));
    }
    if (email.to) {
        text += makeHeader("To", emailAddressListToString(email.to));
    }
    if (email.cc) {
        text += makeHeader("Cc", emailAddressListToString(email.cc));
    }
    if (email.bcc) {
        text += makeHeader("Bcc", emailAddressListToString(email.bcc));
    }
    if (email.sentOn) {
        text += makeHeader("Sent", email.sentOn.toString());
    }
    if (email.receivedOn) {
        text += makeHeader("Received", email.receivedOn.toString());
    }
    if (email.importance) {
        text += makeHeader("Importance", email.importance);
    }
    if (email.subject) {
        text += makeHeader("Subject", email.subject);
    }
    return text;
}

export function emailToString(
    email: Email,
    includeBody: boolean = true,
): string {
    let text = emailHeadersToString(email);
    if (includeBody && email.body) {
        text += "\n\n";
        text += email.body;
    }
    return text;
}

export function emailToTextBlock(
    email: Email,
    includeHeader: boolean = true,
): TextBlock<string> {
    const value = includeHeader ? emailToString(email) : email.body;
    const block: TextBlock<string> = {
        type: TextBlockType.Raw,
        value,
    };
    if (email.sourcePath) {
        block.sourceIds = [email.sourcePath];
    }
    return block;
}

export function emailToEntities(
    email: EmailHeader,
    buffer?: ConcreteEntity[] | undefined,
): ConcreteEntity[] {
    const entities = buffer ?? [];
    pushAddresses(email.from, entities);
    pushAddresses(email.to, entities);
    pushAddresses(email.cc, entities);
    pushAddresses(email.bcc, entities);
    entities.push({
        name: "email",
        type: ["message"],
    });
    return entities;

    function pushAddresses(
        addresses: EmailAddress[] | EmailAddress | undefined,
        entities: ConcreteEntity[],
    ) {
        if (!addresses) {
            return;
        }
        if (Array.isArray(addresses)) {
            for (const address of addresses) {
                entities.push(...emailAddressToEntities(address));
            }
        } else {
            entities.push(...emailAddressToEntities(addresses));
        }
    }
}

export enum EmailVerbs {
    send = "send",
    receive = "receive",
}

export function isEmailVerb(verbs: string[]): boolean {
    if (verbs.length === 1) {
        return verbs[0] === EmailVerbs.receive || verbs[0] === EmailVerbs.send;
    }
    return false;
}

function createEmailActions(
    sender: EmailAddress,
    recipient: EmailAddress,
    useIndirect: boolean,
    buffer?: Action[] | undefined,
): Action[] {
    const actions = buffer ?? [];
    addAction(EmailVerbs.send, sender, recipient, useIndirect);
    addAction(EmailVerbs.receive, recipient, sender, useIndirect);
    return actions;

    function addAction(
        verb: string,
        sender: EmailAddress,
        recipient: EmailAddress,
        useIndirect: boolean,
    ) {
        if (sender.displayName) {
            addActions(
                verb,
                sender.displayName,
                recipient,
                actions,
                useIndirect,
            );
        }
        if (sender.address) {
            addActions(verb, sender.address, recipient, actions, useIndirect);
        }
    }

    function addActions(
        verb: string,
        sender: string,
        recipient: EmailAddress,
        actions: Action[],
        useIndirect: boolean,
    ) {
        if (recipient.displayName) {
            actions.push(
                createAction(verb, sender, recipient.displayName, useIndirect),
            );
        }
        if (recipient.address) {
            actions.push(
                createAction(verb, sender, recipient.address, useIndirect),
            );
        }
    }

    function createAction(
        verb: string,
        from: string,
        to: string,
        useIndirect: boolean,
    ): Action {
        return useIndirect
            ? {
                  verbs: [verb],
                  verbTense: "past",
                  subjectEntityName: from,
                  objectEntityName: "email",
                  indirectObjectEntityName: to,
              }
            : {
                  verbs: [verb],
                  verbTense: "past",
                  subjectEntityName: from,
                  objectEntityName: to,
                  indirectObjectEntityName: "none",
              };
    }
}

export function emailToActions(
    email: EmailHeader,
    useIndirect: boolean,
): Action[] {
    const actions: Action[] = [];
    addActions(email.from, email.to, useIndirect, actions);
    addActions(email.from, email.cc, useIndirect, actions);
    addActions(email.from, email.bcc, useIndirect, actions);

    return actions;

    function addActions(
        sender: EmailAddress,
        recipients: EmailAddress[] | undefined,
        useIndirect: boolean,
        buffer: Action[],
    ) {
        if (recipients) {
            recipients.forEach((r) =>
                createEmailActions(sender, r, useIndirect, buffer),
            );
        }
    }
}

export function emailToKnowledge(
    email: EmailHeader,
    includeSubject: boolean = true,
    useIndirectObject: boolean = true,
): KnowledgeResponse {
    return {
        entities: emailToEntities(email),
        topics: includeSubject && email.subject ? [email.subject] : [],
        actions: emailToActions(email, useIndirectObject),
        inverseActions: [],
    };
}

/**
 * Load a JSON file containing an Email object
 * @param filePath
 * @returns
 */
export async function loadEmailFile(
    filePath: string,
): Promise<Email | undefined> {
    return readJsonFile<Email>(filePath);
}

export async function loadEmailFolder(
    folderPath: string,
    concurrency: number,
    progress?: asyncArray.ProcessProgress<string, Email | undefined>,
): Promise<Email[]> {
    const fileNames = await fs.promises.readdir(folderPath);
    const filePaths = fileNames.map((f) => path.join(folderPath, f));
    const emails = await asyncArray.mapAsync(
        filePaths,
        concurrency,
        (filePath) => loadEmailFile(filePath),
        progress,
    );
    return removeUndefined(emails);
}

export interface EmailMemorySettings extends ConversationSettings {
    mailBoxOwner?: EmailAddress | undefined;
}
/**
 * Create email memory at the given root path
 * @param name
 * @param rootPath
 * @param settings
 * @returns
 */
export async function createEmailMemory(
    model: ChatModel,
    answerModel: ChatModel,
    name: string,
    rootPath: string,
    settings: EmailMemorySettings,
    storageProvider?: StorageProvider,
) {
    const storePath = path.join(rootPath, name);
    settings.initializer ??= setupEmailConversation;
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
            initializer: (c) => setupEmailConversationManager(c, userProfile),
        },
        name,
        rootPath,
        false,
        emailConversation,
    );
    return cm;
}

async function setupEmailConversationManager(
    cm: ConversationManager,
    userProfile: any,
): Promise<void> {
    cm.topicMerger.settings.mergeWindowSize = 1;
    cm.topicMerger.settings.trackRecent = false;

    const entityIndex = await cm.conversation.getEntityIndex();
    entityIndex.noiseTerms.put("email");
    entityIndex.noiseTerms.put("message");

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

async function setupEmailConversation(
    emailConversation: Conversation,
): Promise<void> {
    const actions = await emailConversation.getActionIndex();
    actions.verbTermMap.put("say", EmailVerbs.send);
    actions.verbTermMap.put("discuss", EmailVerbs.send);
    actions.verbTermMap.put("talk", EmailVerbs.send);
    actions.verbTermMap.put("get", EmailVerbs.receive);
}

/**
 * Add an email message to an email conversation
 * @param cm
 * @param emails
 */
export async function addEmailToConversation(
    cm: ConversationManager,
    emails: Email | Email[],
    maxCharsPerChunk: number,
): Promise<void> {
    const messages: ConversationMessage[] = [];
    if (Array.isArray(emails)) {
        for (const email of emails) {
            messages.push(...emailToMessages(email, maxCharsPerChunk));
        }
    } else {
        messages.push(...emailToMessages(emails, maxCharsPerChunk));
    }
    await cm.addMessageBatch(messages);
}

export async function addEmailFileToConversation(
    cm: ConversationManager,
    sourcePath: string,
    maxCharsPerChunk: number,
): Promise<boolean> {
    if (fs.existsSync(sourcePath)) {
        const email = await loadEmailFile(sourcePath);
        if (email) {
            await addEmailToConversation(cm, email, maxCharsPerChunk);
        }
        return true;
    }
    return false;
}

function makeHeader(name: string, text: string | undefined): string {
    if (text) {
        return `${name}: ${text}\n`;
    }
    return "";
}
