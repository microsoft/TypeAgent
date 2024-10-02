// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { asyncArray, readJsonFile } from "typeagent";
import { entitiesFromObject } from "../conversation/entities.js";
import { ConcreteEntity } from "../conversation/knowledgeSchema.js";
import { Email, EmailAddress } from "./emailSchema.js";
import fs from "fs";
import path from "path";
import { removeUndefined } from "../setOperations.js";

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
    if (includeBody && email.body) {
        text += "\n";
        text += email.body;
    }
    return text;
}

export function emailToEntities(email: Email): ConcreteEntity[] | undefined {
    const emailNs = "email";
    return entitiesFromObject(emailNs, email);
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

function makeHeader(name: string, text: string | undefined): string {
    if (text) {
        return `${name}: ${text}\n`;
    }
    return "";
}
