// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    UnderstandingClaim,
    UnderstandingModule,
    UnderstandingCitation,
} from "@typeagent/memory-service";

export const previewResourceUri = "ui://typeagent-memory/preview-v1.html";
export const previewMetaKey = "typeagent.memory.preview";

export interface MemoryPreview {
    schemaVersion: 1;
    snapshotId: string;
    corpusId: string;
    expiresAt: string;
    title: string;
    status: string;
    summary?: UnderstandingClaim;
    sections: { title: string; claims: UnderstandingClaim[] }[];
    unknowns: string[];
    warnings: string[];
    sources: {
        id: string;
        title: string;
        kind: UnderstandingCitation["kind"];
    }[];
    sourceCount: number;
    modules: UnderstandingModule[];
    omittedSections: number;
}
