// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { email as email } from "knowledge-processor";

export class EmailHeader
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
    ) {
        this.from = from;
    }

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
}

export class EmailMessage implements kp.IMessage {
    public metadata: EmailHeader;
    public textChunks: string[];
    public timestamp: string | undefined;

    constructor(
        metadata: EmailHeader,
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
