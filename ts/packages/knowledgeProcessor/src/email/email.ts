// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, dateTime, readJsonFile } from "typeagent";
import {
    Action,
    ConcreteEntity,
    KnowledgeResponse,
} from "../conversation/knowledgeSchema.js";
import { Email, EmailAddress } from "./emailSchema.js";
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
    ConversationSettings,
    createConversation,
} from "../conversation/conversation.js";
import { TypeChatLanguageModel } from "typechat";
import { isValidChunkSize, splitLargeTextIntoChunks } from "../textChunker.js";

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
            type: ["person", "email"],
        };
        entities.push(entity);
        if (emailAddress.address) {
            entity.facets = [];
            entity.facets.push({
                name: "email_alias",
                value: emailAddress.address,
            });
        }
    }
    if (emailAddress.address) {
        entities.push({
            name: emailAddress.address,
            type: ["email_alias"],
        });
    }

    return entities;
}

export function emailToString(
    email: Email,
    includeBody: boolean = true,
): string {
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
    if (email.subject) {
        text += makeHeader("Subject", email.subject);
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
    if (includeBody && email.body) {
        text += "\n";
        text += email.body;
    }
    return text;
}

export function emailToTextBlock(email: Email): TextBlock<string> {
    const value = emailToString(email);
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
    email: Email,
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

enum EmailVerbs {
    send = "send",
    receive = "receive",
}

function createEmailActions(
    sender: EmailAddress,
    recipient: EmailAddress,
    buffer?: Action[] | undefined,
): Action[] {
    const actions = buffer ?? [];
    addAction(EmailVerbs.send, sender, recipient);
    addAction(EmailVerbs.receive, recipient, sender);
    return actions;

    function addAction(
        verb: string,
        sender: EmailAddress,
        recipient: EmailAddress,
    ) {
        if (sender.displayName) {
            addActions(verb, sender.displayName, recipient, actions);
        }
        if (sender.address) {
            addActions(verb, sender.address, recipient, actions);
        }
    }

    function addActions(
        verb: string,
        sender: string,
        recipient: EmailAddress,
        actions: Action[],
    ) {
        if (recipient.displayName) {
            actions.push(createAction(verb, sender, recipient.displayName));
        }
        if (recipient.address) {
            actions.push(createAction(verb, sender, recipient.address));
        }
    }

    function createAction(verb: string, from: string, to: string): Action {
        return {
            verbs: [verb],
            verbTense: "past",
            subjectEntityName: from,
            objectEntityName: "email",
            indirectObjectEntityName: to,
        };
    }
}

export function emailToActions(email: Email): Action[] {
    const actions: Action[] = [];
    addActions(email.from, email.to, actions);
    addActions(email.from, email.cc, actions);
    addActions(email.from, email.bcc, actions);

    return actions;

    function addActions(
        sender: EmailAddress,
        recipients: EmailAddress[] | undefined,
        buffer: Action[],
    ) {
        if (recipients) {
            recipients.forEach((r) => createEmailActions(sender, r, buffer));
        }
    }
}

function emailToKnowledge(email: Email): KnowledgeResponse {
    return {
        entities: emailToEntities(email),
        topics: email.subject ? [email.subject] : [],
        actions: emailToActions(email),
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

/**
 * Create email memory at the given root path
 * @param name
 * @param rootPath
 * @param settings
 * @returns
 */
export async function createEmailMemory(
    model: TypeChatLanguageModel,
    name: string,
    rootPath: string,
    settings: ConversationSettings,
) {
    const storePath = path.join(rootPath, name);
    const emailConversation = await createConversation(settings, storePath);
    const actions = await emailConversation.getActionIndex();
    actions.verbTermMap.put("say", EmailVerbs.send);
    actions.verbTermMap.put("discuss", EmailVerbs.send);
    actions.verbTermMap.put("talk", EmailVerbs.send);
    actions.verbTermMap.put("get", EmailVerbs.receive);

    const cm = await createConversationManager(
        name,
        rootPath,
        false,
        emailConversation,
    );
    cm.topicMerger.settings.mergeWindowSize = 1;
    cm.topicMerger.settings.trackRecent = false;
    return cm;
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

export function emailToMessage(email: Email): ConversationMessage {
    return {
        text: emailToTextBlock(email),
        knowledge: emailToKnowledge(email),
        timestamp: dateTime.stringToDate(email.sentOn),
    };
}

export function emailToMessages(
    email: Email,
    maxCharsPerChunk?: number | undefined,
): ConversationMessage[] {
    if (!isValidChunkSize(maxCharsPerChunk)) {
        return [emailToMessage(email)];
    }

    const messages: ConversationMessage[] = [];
    const text = emailToString(email);
    for (const chunk of splitLargeTextIntoChunks(text, maxCharsPerChunk!)) {
        const emailChunk: Email = { ...email };
        emailChunk.body = chunk;
        messages.push(emailToMessage(emailChunk));
    }

    return messages;
}

function makeHeader(name: string, text: string | undefined): string {
    if (text) {
        return `${name}: ${text}\n`;
    }
    return "";
}
