// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface GraphEntity {
    id: string;
    localId: string;
    type: "Event" | "Msg";
    subject: string;
    participants: string[] | undefined;
    lastModifiedDateTime: string;
}
