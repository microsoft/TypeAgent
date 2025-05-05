// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as ms from "memory-storage";
import { conversation as kpLib } from "knowledge-processor";
import { email as email } from "knowledge-processor";
import { MemoryMessage, MessageMetadata } from "./memory.js";

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
        return email.emailToKnowledge(this);
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

export class EmailMessage extends MemoryMessage<EmailMeta> {
    constructor(
        metadata: EmailMeta,
        emailBody: string | string[],
        public tags: string[] = [],
        public deletionInfo?: kp.DeletionInfo | undefined,
    ) {
        let textChunks: string[];
        if (Array.isArray(emailBody)) {
            textChunks = emailBody;
        } else {
            textChunks = [emailBody];
        }
        super(
            metadata,
            textChunks,
            tags,
            metadata.sentOn,
            undefined,
            deletionInfo,
        );
    }
}

/*
export class EmailMeta
    implements email.EmailHeader, kp.IMessageMetadata, kp.IKnowledgeSource
{
    public cc?: email.EmailAddress[] | undefined;
    public bcc?: email.EmailAddress[] | undefined;
    public subject?: string | undefined;
    public sentOn?: string | undefined;
    public receivedOn?: string | undefined;
    public importance?: string | undefined;

    constructor(
        public from: email.EmailAddress,
        public to: email.EmailAddress[] | undefined = undefined,
    ) {}

    public get source() {
        return email.emailAddressToString(this.from);
    }

    public get dest() {
        return this.to
            ? this.to.map((addr) => email.emailAddressToString(addr))
            : undefined;
    }

    public getKnowledge(): kpLib.KnowledgeResponse {
        return email.emailToKnowledge(this);
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

export class EmailMessage implements kp.IMessage {
    public metadata: EmailMeta;
    public textChunks: string[];
    public timestamp: string | undefined;

    constructor(
        metadata: EmailMeta,
        emailBody: string | string[],
        public tags: string[] = [],
        public deletionInfo?: kp.DeletionInfo | undefined,
    ) {
        this.metadata = metadata;
        if (Array.isArray(emailBody)) {
            this.textChunks = emailBody;
        } else {
            this.textChunks = [emailBody];
        }
        this.timestamp = metadata.sentOn;
    }

    public getKnowledge() {
        return this.metadata.getKnowledge();
    }
}
*/

function importEmailMeta(header: email.EmailHeader): EmailMeta {
    const meta = new EmailMeta(header.from);
    meta.copyFrom(header);
    return meta;
}

function importEmailMessage(email: email.Email): EmailMessage {
    const meta = importEmailMeta(email);
    return new EmailMessage(meta, email.body);
}

export function loadEmailMessageFromFile(
    filePath: string,
): EmailMessage | undefined {
    const emailData = ms.readJsonFile<email.Email>(filePath);
    return emailData ? importEmailMessage(emailData) : undefined;
}

export function loadEmailMessagesFromDir(dirPath: string): EmailMessage[] {
    const filePaths = ms.getFilePathsInDir(dirPath);
    let emails: EmailMessage[] = [];
    for (const filePath of filePaths) {
        const email = loadEmailMessageFromFile(filePath);
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
            jMsg.deletionInfo,
        );
    }
}
