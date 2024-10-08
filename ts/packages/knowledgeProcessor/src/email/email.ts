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
} from "../conversation/conversationManager.js";
import { TopicMerger } from "../conversation/topics.js";

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

export function emailAliasToEntity(alias: string): ConcreteEntity {
    return {
        name: alias,
        type: ["email_alias"],
    };
}

export function emailDisplayNameToEntity(name: string): ConcreteEntity {
    return {
        name,
        type: ["person", "email"],
    };
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

function createEmailActions(
    sender: EmailAddress,
    recipient: EmailAddress,
    buffer?: Action[] | undefined,
): Action[] {
    const actions = buffer ?? [];
    addAction("send", sender, recipient);
    addAction("receive", recipient, sender);
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

export async function loadEmail(filePath: string): Promise<Email | undefined> {
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
        (filePath) => loadEmail(filePath),
        progress,
    );
    return removeUndefined(emails);
}

export function createEmailTopicMerger(): TopicMerger {
    return {
        next(updateSequence, updateIndex) {
            return Promise.resolve(undefined);
        },
        mergeWindow() {
            return Promise.resolve(undefined);
        },
    };
}

/**
 * Add an email message to an email conversation
 * @param cm
 * @param emails
 */
export async function addEmailToConversation(
    cm: ConversationManager,
    emails: Email | Email[],
): Promise<void> {
    if (Array.isArray(emails)) {
        const messages: ConversationMessage[] = emails.map<ConversationMessage>(
            (email) => {
                return {
                    text: emailToTextBlock(email),
                    knowledge: emailToKnowledge(email),
                    timestamp: dateTime.stringToDate(email.sentOn),
                };
            },
        );
        await cm.addMessageBatch(messages);
    } else {
        const email = emails;
        const block = emailToTextBlock(email);
        const knowledge = emailToKnowledge(email);
        await cm.addMessage(
            block,
            knowledge,
            dateTime.stringToDate(email.sentOn),
        );
    }
}

function makeHeader(name: string, text: string | undefined): string {
    if (text) {
        return `${name}: ${text}\n`;
    }
    return "";
}
