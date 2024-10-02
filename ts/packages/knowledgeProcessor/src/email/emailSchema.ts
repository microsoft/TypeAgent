// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Email = {
    type: "email";
    from: EmailAddress;
    to: EmailAddress[] | undefined;
    cc?: EmailAddress[] | undefined;
    bcc?: EmailAddress[] | undefined;
    subject?: string | undefined;
    sentOn?: Date | undefined;
    receivedOn?: Date | undefined;
    importance?: string | undefined;
    sourcePath?: string | undefined;
    body: string;
};

export type EmailAddress = {
    type: "address";
    address?: string | undefined;
    displayName?: string | undefined;
};
