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
import { ConversationManager } from "../conversation/conversationManager.js";
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

export function emailAddressToEntity(
    role: string,
    emailAddress: EmailAddress,
): ConcreteEntity | undefined {
    if (!(emailAddress.address && emailAddress.displayName)) {
        return undefined;
    }
    const entity: ConcreteEntity = {
        name: "",
        type: ["email", "email_address"],
        facets: [{ name: "role", value: role }],
    };
    if (emailAddress.address && emailAddress.displayName) {
        entity.name = emailAddress.displayName;
        entity.facets!.push({
            name: "email_alias",
            value: emailAddress.address,
        });
    } else if (emailAddress.address) {
        entity.name = emailAddress.address;
    } else {
        entity.name = emailAddress.displayName;
    }
    return entity;
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

export function emailToEntities(email: Email): ConcreteEntity[] {
    const entities: ConcreteEntity[] = [];
    const recipient = "recipient";
    push(emailAddressToEntity("sender", email.from));
    if (email.to) {
        push(email.to.map((e) => emailAddressToEntity(recipient, e)));
    }
    if (email.cc) {
        push(email.cc.map((e) => emailAddressToEntity(recipient, e)));
    }
    if (email.bcc) {
        push(email.bcc.map((e) => emailAddressToEntity(recipient, e)));
    }
    return entities;

    type EntityType = ConcreteEntity | undefined;
    function push(newEntities: EntityType | EntityType[]) {
        if (Array.isArray(newEntities)) {
            entities.push(...removeUndefined(newEntities));
        } else if (newEntities) {
            entities.push(newEntities);
        }
    }
}

function emailToAction(
    verb: string,
    sender: EmailAddress | string,
    recipient: EmailAddress,
): Action {
    const action: Action = {
        verbs: [verb],
        verbTense: "past",
        subjectEntityName:
            typeof sender === "string" ? sender : emailAddressToString(sender),
        objectEntityName: "email",
        indirectObjectEntityName: emailAddressToString(recipient),
    };
    return action;
}

export function emailToActions(email: Email): Action[] {
    const actions: Action[] = [];
    const sender = emailAddressToString(email.from);

    addActions(actions, sender, email.to);
    addActions(actions, sender, email.cc);
    addActions(actions, sender, email.bcc);

    return actions;

    function addActions(
        actions: Action[],
        sender: string,
        recipients: EmailAddress[] | undefined,
    ) {
        if (recipients) {
            for (const recipient of recipients) {
                actions.push(emailToAction("send", sender, recipient));
            }
        }
    }
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
 * @param email
 */
export async function addEmailToConversation(
    cm: ConversationManager,
    email: Email,
): Promise<void> {
    const block = emailToTextBlock(email);
    const knowledge: KnowledgeResponse = {
        entities: emailToEntities(email),
        topics: email.subject ? [email.subject] : [],
        actions: emailToActions(email),
        inverseActions: [],
    };
    await cm.addMessage(block, knowledge, dateTime.stringToDate(email.sentOn));
}

function makeHeader(name: string, text: string | undefined): string {
    if (text) {
        return `${name}: ${text}\n`;
    }
    return "";
}
