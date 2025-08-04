// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as ms from "memory-storage";
import { conversation as kpLib } from "knowledge-processor";
import { email as email } from "knowledge-processor";
import { Message, MessageMetadata } from "./memory.js";
import path from "path";
import { importEmlFile } from "./emailImport.js";

export class EmailMeta extends MessageMetadata {
    public cc?: email.EmailAddress[] | undefined;
    public bcc?: email.EmailAddress[] | undefined;
    public subject?: string | undefined;
    public sentOn?: string | undefined;
    public receivedOn?: string | undefined;
    public importance?: string | undefined;

    constructor(
        public from: email.EmailAddress,
        public to: email.EmailAddress[] | undefined = undefined,
    ) {
        super();
    }

    public override get source() {
        return email.emailAddressToString(this.from);
    }

    public get dest() {
        return this.to
            ? this.to.map((addr) => email.emailAddressToString(addr))
            : undefined;
    }

    public getKnowledge(): kpLib.KnowledgeResponse {
        return email.emailToKnowledge(this, false, false);
    }

    public copyFrom(meta: email.EmailHeader) {
        this.bcc = meta.bcc;
        this.cc = meta.cc;
        this.from = meta.from;
        this.importance = meta.importance;
        this.receivedOn = meta.receivedOn;
        this.sentOn = meta.sentOn;
        this.subject = meta.subject;
        this.to = meta.to;
    }
}

export class EmailMessage extends Message<EmailMeta> {
    constructor(
        metadata: EmailMeta,
        emailBody: string | string[],
        tags: string[] | kp.MessageTag[] = [],
        knowledge?: kpLib.KnowledgeResponse | undefined,
        deletionInfo?: kp.DeletionInfo | undefined,
        isNew: boolean = true,
    ) {
        if (isNew) {
            emailBody = emailToTextChunks(emailBody, metadata.subject);
        }
        super(
            metadata,
            emailBody,
            tags,
            metadata.sentOn,
            knowledge,
            deletionInfo,
        );
    }
}

function importEmailMeta(header: email.EmailHeader): EmailMeta {
    header.bcc;
    const meta = new EmailMeta(header.from);
    meta.copyFrom(header);
    return meta;
}

export function importEmailMessage(email: email.Email): EmailMessage {
    const meta = importEmailMeta(email);
    return new EmailMessage(meta, email.body);
}

export async function loadEmailMessageFromFile(
    filePath: string,
): Promise<EmailMessage | undefined> {
    const emailData =
        path.extname(filePath) === "eml"
            ? await importEmlFile(filePath)
            : ms.readJsonFile<email.Email>(filePath);

    return emailData ? importEmailMessage(emailData) : undefined;
}

export async function loadEmailMessagesFromDir(
    dirPath: string,
): Promise<EmailMessage[]> {
    const filePaths = ms.getFilePathsInDir(dirPath);
    let emails: EmailMessage[] = [];
    for (const filePath of filePaths) {
        const email = await loadEmailMessageFromFile(filePath);
        if (email) {
            emails.push(email);
        }
    }
    return emails;
}

export class EmailMessageSerializer implements kp.JsonSerializer<EmailMessage> {
    public serialize(value: EmailMessage): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): EmailMessage {
        const jMsg: EmailMessage = JSON.parse(json);
        const jMeta: EmailMeta = jMsg.metadata;
        const meta = new EmailMeta(jMeta.from);
        meta.copyFrom(jMeta);
        return new EmailMessage(
            meta,
            jMsg.textChunks,
            jMsg.tags,
            jMsg.knowledge,
            jMsg.deletionInfo,
            false,
        );
    }
}

function emailToTextChunks(
    emailBody: string | string[],
    subject?: string,
): string | string[] {
    if (Array.isArray(emailBody)) {
        emailBody[0] = joinSubjectAndBody(emailBody[0], subject);
        return emailBody;
    } else {
        return joinSubjectAndBody(emailBody, subject);
    }
}

function joinSubjectAndBody(emailBody: string, subject?: string): string {
    if (subject) {
        return `Subject: ${subject}\n\n` + emailBody;
    }
    return emailBody;
}
