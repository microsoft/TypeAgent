// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface EmailHeader {
    from: EmailAddress;
    to: EmailAddress[] | undefined;
    cc?: EmailAddress[] | undefined;
    bcc?: EmailAddress[] | undefined;
    subject?: string | undefined;
    sentOn?: string | undefined;
    receivedOn?: string | undefined;
    importance?: string | undefined;
    sourcePath?: string | undefined;
    threadId?: string | undefined;
}

export interface Email extends EmailHeader {
    body: string;
}

export type EmailAddress = {
    address?: string | undefined;
    displayName?: string | undefined;
};
